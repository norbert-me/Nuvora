"""„Was ist neu?" — welche Fassungen jemand nach einem Update zu sehen bekommt.

Die Regeln sind die ganze Logik: nur Neueres als der eigene Stand, nichts aus
der Zukunft (ein Abschnitt kann im CHANGELOG stehen, bevor die Fassung
ausgeliefert ist), und ein neues Konto bekommt keine Wand aus Historie.
"""
from app import changelog as C

TEXT = """# Änderungen

Vorspann, kein Abschnitt.

## 4.2.0 — 10.09.2026

**Kalender**

- Etwas ganz Neues.

## 4.1.8 — 05.09.2026

- Punkt A.
- Punkt B.

## 4.1.7 — 01.09.2026

- Aelteres.
"""


def test_abschnitte_neueste_zuerst():
    xs = C.abschnitte(TEXT)
    assert [a["version"] for a in xs] == ["4.2.0", "4.1.8", "4.1.7"]
    assert xs[1]["datum"] == "05.09.2026"
    assert "Punkt A." in xs[1]["inhalt"] and "Aelteres" not in xs[1]["inhalt"]


def test_nur_neueres_und_nichts_aus_der_zukunft():
    """4.2.0 steht schon in der Datei, laeuft aber noch nicht — nicht zeigen."""
    xs = C.seit(TEXT, "4.1.7", bis="4.1.8")
    assert [a["version"] for a in xs] == ["4.1.8"]


def test_wer_alles_gesehen_hat_bekommt_nichts():
    assert C.seit(TEXT, "4.1.8", bis="4.1.8") == []


def test_version_vergleich_zaehlt_nicht_alphabetisch():
    assert C.version_tupel("4.10.0") > C.version_tupel("4.9.9")
    assert C.version_tupel("v4.1.8") == (4, 1, 8)
