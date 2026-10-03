"""Rechenkern der Waage (Modul Waage) — Spiegel von apps/web/src/core/waage.js.

Ein Blatt ohne FastAPI und ohne Datenbank: der Router prueft damit Aufgaben
und Abgaben. Der Browser rechnet beim Tippen live; was zaehlt („geloest"),
rechnet der Server selbst nach, statt der Abgabe zu glauben. Wer hier eine
Regel aendert, aendert sie in core/waage.js mit.

Eine Gleichung a·x + b = c·x + d ist ein Stand {"l": {"x": a, "e": b},
"r": {"x": c, "e": d}}. Nur natuerliche Zahlen, Loesung eine positive ganze
Zahl — die Grenzen der Waage als Modell (kein negatives Gewicht, ein Paeckchen
wiegt eine Anzahl Gewichte).
"""
from typing import Optional

MAX_ZAHL = 60
MAX_SCHRITTE = 60
MAX_GLEICHUNGEN = 20


def _ganz(v) -> Optional[int]:
    if isinstance(v, bool):
        return None
    if isinstance(v, int):
        return v
    if isinstance(v, float) and v.is_integer():
        return int(v)
    return None


def stand_aus(roh, grenze: int = MAX_ZAHL * 20) -> Optional[dict]:
    """Einen Stand auf die erlaubte Form bringen — oder None."""
    if not isinstance(roh, dict):
        return None
    out = {}
    for seite in ("l", "r"):
        s = roh.get(seite)
        if not isinstance(s, dict):
            return None
        x, e = _ganz(s.get("x")), _ganz(s.get("e"))
        if x is None or e is None or not (0 <= x <= grenze) or not (0 <= e <= grenze):
            return None
        out[seite] = {"x": x, "e": e}
    return out


def loesung(s: dict) -> Optional[int]:
    dx = s["l"]["x"] - s["r"]["x"]
    de = s["r"]["e"] - s["l"]["e"]
    if dx == 0 or de % dx:
        return None
    x = de // dx
    return x if x > 0 else None


def gleichung_ok(roh) -> Optional[dict]:
    """Eine Aufgaben-Gleichung: Zahlen bis MAX_ZAHL, mindestens ein x, Loesung
    positiv und ganz. Sonst None."""
    s = stand_aus(roh, MAX_ZAHL)
    if not s or (s["l"]["x"] == 0 and s["r"]["x"] == 0) or loesung(s) is None:
        return None
    return s


def geloest(s: dict) -> bool:
    l, r = s["l"], s["r"]
    return (l["x"] == 1 and l["e"] == 0 and r["x"] == 0) or (r["x"] == 1 and r["e"] == 0 and l["x"] == 0)


def gewicht(seite: dict, x: int) -> int:
    return seite["x"] * x + seite["e"]


def pruefe_weg(start: dict, schritte) -> dict:
    """Einen Loesungsweg nachrechnen: jeder Stand natuerlichzahlig und im
    Gleichgewicht mit dem wahren x. Rueckgabe {schritte, gueltig, geloest} —
    `schritte` in bereinigter Form, ungueltige Wege werden NICHT verworfen
    (es ist die Arbeit eines Kindes), sie zaehlen nur nicht als geloest."""
    x = loesung(start)
    sauber, gueltig = [], x is not None
    for roh in (schritte if isinstance(schritte, list) else [])[:MAX_SCHRITTE]:
        s = stand_aus(roh)
        if not s:
            gueltig = False
            continue
        op = roh.get("op") if isinstance(roh.get("op"), str) else ""
        sauber.append({**s, "op": op[:20]})
        if x is None or gewicht(s["l"], x) != gewicht(s["r"], x):
            gueltig = False
    letzter = sauber[-1] if sauber else start
    return {"schritte": sauber, "gueltig": gueltig, "geloest": bool(gueltig and sauber and geloest(letzter))}
