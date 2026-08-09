"""Ohne Alembic ist `_ensure_columns` der einzige Migrationsmechanismus.

`create_all` legt fehlende *Tabellen* an, rührt bestehende aber nie an: Eine
Spalte, die später ins Modell kommt, entsteht auf einer produktiven Datenbank
ausschließlich durch die `wanted`-Liste in `main.py`. Fehlt dort ein Eintrag,
läuft alles bis zu dem Moment, in dem die erste Abfrage auf die Spalte trifft —
in Produktion, nicht hier.

Der Test führt den echten Mechanismus gegen SQLite aus: eine Tabelle wird
absichtlich ohne später hinzugekommene Spalten angelegt, danach muss
`_ensure_columns` sie ergänzt haben — inklusive der Postgres-Schreibweise
`TIMESTAMPTZ`, die SQLite als freien Typnamen durchwinkt.

`main.py` lässt sich nicht importieren (beim Import legt es `/app/uploads` an
und mountet StaticFiles), deshalb wird die Funktion aus dem Quelltext geschnitten
und ausgeführt. Sie bringt ihre Importe selbst mit, ist also eigenständig.
"""
import ast
import pathlib

import pytest
from sqlalchemy import create_engine, inspect, text

MAIN = pathlib.Path(__file__).resolve().parents[1] / "app" / "main.py"


def _lade(name: str):
    """Eine Funktion aus main.py holen, ohne main.py zu importieren."""
    quelle = MAIN.read_text()
    for knoten in ast.parse(quelle).body:
        if isinstance(knoten, ast.FunctionDef) and knoten.name == name:
            raum: dict = {}
            exec(compile(ast.Module([knoten], []), str(MAIN), "exec"), raum)
            return raum[name]
    raise AssertionError(f"{name} nicht in main.py gefunden")


def _wanted() -> list[tuple[str, str, str]]:
    """Die wanted-Liste aus dem Rumpf von _ensure_columns."""
    for knoten in ast.walk(ast.parse(MAIN.read_text())):
        if isinstance(knoten, ast.FunctionDef) and knoten.name == "_ensure_columns":
            for stmt in knoten.body:
                if isinstance(stmt, ast.Assign) and any(
                    isinstance(z, ast.Name) and z.id == "wanted" for z in stmt.targets
                ):
                    return [tuple(e) for e in ast.literal_eval(stmt.value)]
    raise AssertionError("wanted-Liste nicht gefunden")


@pytest.fixture
def conn():
    engine = create_engine("sqlite://")
    with engine.begin() as c:
        yield c
    engine.dispose()


def _spalten(conn, tabelle) -> set:
    return {c["name"] for c in inspect(conn).get_columns(tabelle)}


def test_spaeter_ergaenzte_spalte_entsteht_nachtraeglich(conn):
    """Der Fall aus Produktion: die Tabelle steht seit einem alten Deploy, die
    Spalten kamen erst danach ins Modell."""
    conn.execute(text("CREATE TABLE topics (id INTEGER PRIMARY KEY, name VARCHAR(200))"))
    assert "notes" not in _spalten(conn, "topics")

    _lade("_ensure_columns")(conn)

    fehlend = {c for t, c, _ in _wanted() if t == "topics"} - _spalten(conn, "topics")
    assert not fehlend, f"_ensure_columns hat diese Spalten nicht ergänzt: {sorted(fehlend)}"


def test_postgres_typen_scheitern_nicht_still(conn):
    """`deleted_at` wird als TIMESTAMPTZ angelegt. Ginge das DDL schief, liefe
    der Papierkorb ins Leere — der Fehler stünde nur im Startlog."""
    # owner_id gehört zur Tabelle seit jeher — _ensure_columns legt darauf einen Index.
    conn.execute(text(
        "CREATE TABLE school_classes (id INTEGER PRIMARY KEY, name VARCHAR(100), owner_id INTEGER)"
    ))
    _lade("_ensure_columns")(conn)
    assert "deleted_at" in _spalten(conn, "school_classes")


def test_zweiter_lauf_aendert_nichts(conn):
    """Der Start ruft das bei jedem Container-Neustart auf — es muss idempotent
    sein, sonst kracht der zweite Start am „column already exists“."""
    conn.execute(text("CREATE TABLE topics (id INTEGER PRIMARY KEY, name VARCHAR(200))"))
    ensure = _lade("_ensure_columns")
    ensure(conn)
    vorher = _spalten(conn, "topics")
    ensure(conn)
    assert _spalten(conn, "topics") == vorher


def test_wanted_nennt_nur_spalten_die_es_im_modell_gibt():
    """Die Gegenrichtung: ein Tippfehler in wanted legt eine Spalte an, die kein
    Modell kennt — sie fällt niemandem auf, weil nie jemand sie liest."""
    from app.models import Base
    unbekannt = [
        f"{t}.{c}" for t, c, _ in _wanted()
        if t in Base.metadata.tables and c not in Base.metadata.tables[t].c
    ]
    assert not unbekannt, "wanted nennt Spalten ohne Entsprechung im Modell: " + ", ".join(unbekannt)
