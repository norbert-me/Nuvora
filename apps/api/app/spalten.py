"""Was in eine NOT-NULL-Spalte gehoert, in der nichts steht.

Ein Blatt: importiert nur SQLAlchemy, keinen Router und nicht `main`. Genau
deshalb steht es hier und nicht in einem der beiden Aufrufer — gebraucht wird es
an zwei Stellen, und `main.py` importiert jeden Router (`backup.py` also auch).
Eine zweite Fassung waere die Stelle, an der die beiden auseinanderlaufen.

Die zwei Aufrufer:

  * `main.py` (`_ensure_columns`) — repariert die **laufende** Datenbank: eine
    Spalte, die ein alter Deploy per `ADD COLUMN` ohne DEFAULT nachgezogen hat,
    steht auf Bestandszeilen bis heute auf NULL.
  * `routers/backup.py` (`zurueckspielen`) — repariert die **Sicherung**: in
    Dateien, die vor dieser Reparatur entstanden sind, steckt die NULL weiter
    drin. Eine Sicherung, die sich nicht mehr einspielen laesst, ist keine.
"""
from __future__ import annotations

from sqlalchemy import types as t


def fuellwert(col):
    """Womit eine NOT-NULL-Spalte gefuellt wird, in der NULL steht — oder `None`.

    Quelle ist **ausschliesslich der Default des Modells**: genau das, was die
    ORM beim Schreiben eingesetzt haette. Kein Ersatz nach Typ. Der Unterschied
    ist nicht theoretisch — `users.password_hash` ist NOT NULL und hat keinen
    Default; ein „dann eben leerer Text" haette daraus ein Konto mit leerem
    Passwort-Hash gemacht, still und in den Daten stehend. Wo kein Default
    steht, gibt es keinen richtigen Wert, und dann wird gemeldet statt geraten.
    """
    vor = getattr(col.default, "arg", None)
    if vor is not None and not callable(vor):
        return vor
    return _aus_server_default(col)


def _aus_server_default(col):
    """Der server_default als Python-Wert — nur wenn er ein Literal ist.

    `server_default="0"` / `"''"` / `"false"` sind die Faelle, die in den
    Modellen vorkommen. Alles Ausgerechnete (`now()`, `nextval(...)`) bleibt
    `None`: was die Datenbank beim Einfuegen selbst gesetzt haette, laesst sich
    nachtraeglich nicht rekonstruieren, sondern nur erfinden.
    """
    roh = getattr(getattr(col, "server_default", None), "arg", None)
    text = getattr(roh, "text", roh)  # DefaultClause traegt den Text in `.text`
    if not isinstance(text, str):
        return None
    wort = text.strip().strip("'")
    if wort == "":
        return "" if isinstance(col.type, (t.String, t.Text)) else None
    if wort.lower() in ("true", "false"):
        return wort.lower() == "true"
    try:
        return int(wort)
    except ValueError:
        pass
    try:
        return float(wort)
    except ValueError:
        return None
