"""Das Format der Sicherung: Werte kodieren/dekodieren und an das heutige Schema anpassen.

Ein Blatt (importiert keinen Router): die Sicherung (`routers/backup.py`) und die Wiederherstellung
einzelner Module (`routers/wiederherstellung.py`) brauchen dasselbe, und ein Router darf den anderen
nicht importieren.
"""
import base64
from datetime import date, datetime

from .spalten import fuellwert


def kodiere(v):
    if isinstance(v, bytes):
        return {"__b64__": base64.b64encode(v).decode("ascii")}
    if isinstance(v, datetime):
        return {"__dt__": v.isoformat()}
    if isinstance(v, date):
        return {"__d__": v.isoformat()}
    return v




def dekodiere(v):
    if isinstance(v, dict) and len(v) == 1:
        if "__b64__" in v:
            return base64.b64decode(v["__b64__"])
        if "__dt__" in v:
            return datetime.fromisoformat(v["__dt__"])
        if "__d__" in v:
            return date.fromisoformat(v["__d__"])
    return v




def passend_machen(tabelle, zeilen: list[dict]) -> tuple[list[dict], list[str]]:
    """Zeilen aus der Datei an das heutige Schema anpassen — und sagen, was.

    Eine Sicherung ist ein Stand von damals, das Zielschema ist von heute.
    Zwei Abweichungen sind harmlos und wurden trotzdem zum Abbruch:

      * **NULL in einer NOT-NULL-Spalte.** Entstanden in der Produktionsdatenbank
        durch ein `ADD COLUMN` ohne DEFAULT (siehe `_ensure_columns` in
        main.py). Die laufende Datenbank ist inzwischen repariert — in den
        Dateien von davor steckt die NULL weiter drin. Gefüllt wird mit dem
        Default des Modells, also mit dem, was die ORM beim Schreiben gesetzt
        hätte.
      * **Eine Spalte, die es nicht mehr gibt.** Sonst scheitert das Einspielen
        einer älteren Sicherung an einem Feld, das niemand mehr liest.

    Beides wird **gezählt und gemeldet**, nicht stillschweigend gemacht: wer
    zurückspielt, muss erfahren, dass die Daten dabei angefasst wurden.
    """
    spalten = {c.name: c for c in tabelle.c}
    hinweise: dict[str, int] = {}
    fertig = []
    for zeile in zeilen:
        neu = {}
        for k, v in zeile.items():
            col = spalten.get(k)
            if col is None:
                hinweise[f"{tabelle.name}.{k} verworfen (Spalte gibt es nicht mehr)"] = \
                    hinweise.get(f"{tabelle.name}.{k} verworfen (Spalte gibt es nicht mehr)", 0) + 1
                continue
            if v is None and not col.nullable and not col.primary_key:
                ersatz = fuellwert(col)
                if ersatz is not None:
                    schluessel = f"{tabelle.name}.{k} war NULL, gefüllt"
                    hinweise[schluessel] = hinweise.get(schluessel, 0) + 1
                    v = ersatz
            neu[k] = v
        fertig.append(neu)
    return fertig, [f"{text} ({n})" for text, n in sorted(hinweise.items())]
