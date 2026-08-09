"""Der 30-Tage-Aufräumjob muss jede weich gelöschte Art wirklich erreichen.

`PAPIERKORB_TABELLEN` in `main.py` ist eine von Hand gepflegte Liste — und genau
solche Listen veralten still: Wer eine neue Tabelle mit `deleted_at` anlegt,
merkt nichts davon, dass ihre Zeilen dort dann für immer liegen bleiben. Das ist
kein Schönheitsfehler, sondern ein Datenschutzversprechen: die 30-Tage-Frist
steht in der Datenschutzerklärung.

Der Test liest die Liste aus dem Quelltext (`main.py` lässt sich nicht
importieren — beim Import legt es `/app/uploads` an) und hält sie gegen die
Modell-Metadaten. Vorbild: `test_modul_keys_frontend.py`, `test_export_vollstaendig.py`.
"""
import ast
import pathlib

from app.models import Base

MAIN = pathlib.Path(__file__).resolve().parents[1] / "app" / "main.py"

# Tabellen mit deleted_at, die bewusst NICHT vom Aufräumjob angefasst werden.
# Jeder Eintrag braucht eine Begründung — leer heißt: es gibt keine.
NICHT_AUFRAEUMEN: dict[str, str] = {}


def _konstante(name: str):
    """Eine Modul-Konstante aus main.py lesen, ohne main.py zu importieren."""
    baum = ast.parse(MAIN.read_text())
    for knoten in baum.body:
        if isinstance(knoten, ast.Assign) and any(
            isinstance(z, ast.Name) and z.id == name for z in knoten.targets
        ):
            return ast.literal_eval(knoten.value)
    raise AssertionError(f"{name} nicht in main.py gefunden")


def test_jede_tabelle_mit_deleted_at_wird_aufgeraeumt():
    aufgeraeumt = {tbl for tbl, _wort in _konstante("PAPIERKORB_TABELLEN")}
    weich_geloescht = {
        name for name, tabelle in Base.metadata.tables.items() if "deleted_at" in tabelle.c
    }
    vergessen = weich_geloescht - aufgeraeumt - set(NICHT_AUFRAEUMEN)
    assert not vergessen, (
        "Diese Tabellen löschen weich, werden aber nie endgültig geleert — ihre Zeilen "
        "bleiben über die 30-Tage-Frist hinaus liegen: " + ", ".join(sorted(vergessen))
        + ". Eintrag in PAPIERKORB_TABELLEN (main.py) ergänzen."
    )


def test_aufraeumjob_nennt_keine_tabelle_die_es_nicht_gibt():
    """Ein Tippfehler im Tabellennamen fällt nie auf: das DELETE steht in einem
    `except Exception: pass`, der Job meldet also stumm Erfolg."""
    aufgeraeumt = {tbl for tbl, _wort in _konstante("PAPIERKORB_TABELLEN")}
    unbekannt = {
        t for t in aufgeraeumt
        if t not in Base.metadata.tables or "deleted_at" not in Base.metadata.tables[t].c
    }
    assert not unbekannt, (
        "PAPIERKORB_TABELLEN nennt Tabellen ohne deleted_at (oder ohne Modell): "
        + ", ".join(sorted(unbekannt))
    )
