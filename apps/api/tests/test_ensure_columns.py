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
from contextlib import contextmanager
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

# ─── Fremdschlüssel: was ALTER TABLE nicht mitbringt ───
#
# `create_all` legt Spalten MIT ihrem Fremdschlüssel an — in jedem Test also
# inklusive `ON DELETE CASCADE`/`SET NULL`. Die wanted-Liste legte sie lange als
# nacktes `INTEGER` nach. In einer gewachsenen Produktionsdatenbank existiert der
# Constraint deshalb nicht, im Test immer. Genau daran hängen zwei Zusagen:
# Konto löschen (`owner_id CASCADE`, Art. 17) und Thema löschen
# (`questions.topic_id SET NULL`, Regel 3).


def _fk_spalten() -> list:
    """(Tabelle, Spalte, Zieltabelle, ondelete) für jeden wanted-Eintrag, dessen
    Modell-Spalte einen Fremdschlüssel mit ondelete trägt."""
    from app.models import Base
    treffer = []
    for tabelle, spalte, _ in _wanted():
        t = Base.metadata.tables.get(tabelle)
        if t is None or spalte not in t.c:
            continue
        for fk in t.c[spalte].foreign_keys:
            if fk.ondelete:
                treffer.append((tabelle, spalte, fk.column.table.name, fk.ondelete.upper()))
    return treffer


def _fks(conn, tabelle: str) -> dict:
    """{Spalte: (Zieltabelle, ondelete)} — der Inspector verliert `ondelete` auf
    SQLite bei inline `REFERENCES`, deshalb dort über PRAGMA."""
    if conn.dialect.name == "sqlite":
        return {
            z[3]: (z[2], (z[6] or "NO ACTION").upper())
            for z in conn.exec_driver_sql(f"PRAGMA foreign_key_list({tabelle})").fetchall()
        }
    return {
        fk["constrained_columns"][0]:
            (fk["referred_table"], (fk.get("options") or {}).get("ondelete", "NO ACTION").upper())
        for fk in inspect(conn).get_foreign_keys(tabelle)
        if len(fk["constrained_columns"]) == 1
    }


@contextmanager
def _db_ohne_spalte(tabelle: str, spalte: str):
    """Die Ausgangslage aus Produktion: das ganze Schema steht, nur `spalte` kam
    erst nach dem Deploy ins Modell und existiert auf `tabelle` noch nicht.
    Alles andere an der Tabelle (Indexspalten!) bleibt, sonst prüft der Test
    einen Zustand, den es nie gab."""
    from sqlalchemy import MetaData, Table
    from app.models import Base
    md = MetaData()
    stumpf = Table(tabelle, md,
                   *[c._copy() for c in Base.metadata.tables[tabelle].c if c.name != spalte])
    engine = create_engine("sqlite://")
    with engine.begin() as conn:
        Base.metadata.create_all(
            conn, tables=[t for n, t in Base.metadata.tables.items() if n != tabelle])
        stumpf.create(conn)
        yield conn
    engine.dispose()


def test_nachgezogene_spalte_bringt_ihren_fremdschluessel_mit():
    """Der teure Fall: Spalte fehlt, _ensure_columns legt sie an — und zwar mit
    demselben ON DELETE, das create_all erzeugt hätte. Sonst bleibt nach einer
    Kontolöschung Inhalt mit toter owner_id stehen, und ein gelöschtes Thema
    lebt in `questions.topic_id` weiter."""
    ensure = _lade("_ensure_columns")
    fehlend = []
    for tabelle, spalte, ziel, ondelete in _fk_spalten():
        with _db_ohne_spalte(tabelle, spalte) as conn:
            ensure(conn)
            ist = _fks(conn, tabelle).get(spalte)
        if ist != (ziel, ondelete):
            fehlend.append(f"{tabelle}.{spalte} -> {ziel} ON DELETE {ondelete} (ist: {ist})")
    assert not fehlend, (f"{len(fehlend)} nachgezogene Spalten ohne ihren Fremdschlüssel:\n  "
                         + "\n  ".join(fehlend))


def test_nachziehen_bleibt_idempotent():
    """Läuft bei jedem Containerstart. Ein zweiter Lauf darf weder scheitern noch
    denselben Fremdschlüssel ein zweites Mal anlegen."""
    ensure = _lade("_ensure_columns")
    with _db_ohne_spalte("questions", "topic_id") as conn:
        ensure(conn)
        vorher = _fks(conn, "questions")
        ensure(conn)
        assert _fks(conn, "questions") == vorher
        assert len(inspect(conn).get_foreign_keys("questions")) == len(vorher)


class _FakePG:
    """Ein Postgres, das nur mitschreibt.

    Der Bestandsfall — Spalte da, Fremdschlüssel fehlt — lässt sich auf SQLite
    prinzipiell nicht nachstellen: SQLite kann einer bestehenden Tabelle keinen
    Constraint hinzufügen, deshalb überspringt `_ensure_columns` den Zweig dort.
    Ohne lokalen Postgres bleibt als Nachweis das erzeugte DDL.
    """
    class dialect:
        name = "postgresql"

    def __init__(self, tabellen, spalten, fks):
        self._t, self._s, self._f = tabellen, spalten, fks
        self.befehle = []

    def execute(self, stmt, *a, **kw):
        self.befehle.append(str(stmt))
        return None

    @contextmanager
    def begin_nested(self):
        yield self

    # was der Inspector von ihm will
    def get_table_names(self):
        return list(self._t)

    def get_columns(self, tabelle):
        return [{"name": n} for n in self._s.get(tabelle, [])]

    def get_foreign_keys(self, tabelle):
        return [{"constrained_columns": [c]} for c in self._f.get(tabelle, [])]


def test_postgres_ruestet_bestehende_spalte_nach(monkeypatch):
    """Die echte Produktionslage: `questions.topic_id` und `questions.owner_id`
    stehen seit Jahren da — nackt, von einem früheren ALTER TABLE. Beide müssen
    ihren Constraint bekommen, und zwar NOT VALID: Bestandsdaten können genau
    die Waisen enthalten, die der Constraint künftig verhindert; eine prüfende
    Variante würde daran scheitern und den Start abbrechen."""
    import sqlalchemy
    fake = _FakePG(
        tabellen=["questions", "users", "topics"],
        spalten={"questions": ["id", "owner_id", "topic_id"]},
        fks={},
    )
    monkeypatch.setattr(sqlalchemy, "inspect", lambda _: fake)
    _lade("_ensure_columns")(fake)

    ddl = [b for b in fake.befehle if "ADD CONSTRAINT" in b]
    assert any(
        "ALTER TABLE questions ADD CONSTRAINT fk_questions_owner_id FOREIGN KEY (owner_id) "
        "REFERENCES users(id) ON DELETE CASCADE NOT VALID" == b for b in ddl), ddl
    assert any(
        "ALTER TABLE questions ADD CONSTRAINT fk_questions_topic_id FOREIGN KEY (topic_id) "
        "REFERENCES topics(id) ON DELETE SET NULL NOT VALID" == b for b in ddl), ddl
    assert not any("ALTER TABLE questions ADD COLUMN" in b for b in fake.befehle), \
        "Die Spalten waren schon da — nur der Constraint fehlte"


def test_postgres_ruehrt_vorhandene_fremdschluessel_nicht_an(monkeypatch):
    """Idempotenz auf der echten Seite: beim zweiten Start meldet der Inspector
    die Constraints — dann darf kein weiteres ALTER kommen."""
    import sqlalchemy
    fake = _FakePG(
        tabellen=["questions", "users", "topics"],
        spalten={"questions": ["id", "owner_id", "topic_id"]},
        fks={"questions": ["owner_id", "topic_id"]},
    )
    monkeypatch.setattr(sqlalchemy, "inspect", lambda _: fake)
    _lade("_ensure_columns")(fake)
    assert not [b for b in fake.befehle if "ADD CONSTRAINT" in b]
