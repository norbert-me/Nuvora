"""Abschaltbare Teile eines Moduls (app/routers/modules.py).

Ein Modul ist nicht immer alles oder nichts: SEGEL ist das Konzept einer
einzelnen Schule, und wer es nicht kennt, hat im Sitzplan einen Schalter und
ein Kuerzel am Platz, die ihm nichts sagen. Das ganze Modul Orga dafuer
abzuschalten waere zu grob — dann waeren Anwesenheit und Ausleihe mit weg.

Die Regeln, die dieser Test festhaelt:
  1. Welche Optionen es gibt, steht im CODE (REGISTRY) — die DB haelt nur die
     Abweichung. Fehlt ein Schluessel, gilt die Voreinstellung.
  2. Was in der DB steht, aber nicht mehr deklariert ist, faellt heraus statt
     als Geist weiterzuleben.
  3. Es sind ANZEIGE-Optionen, keine Schranke.
"""
from app.routers.modules import REGISTRY, _BY_KEY, _optionen_an


def test_orga_hat_segel_als_abschaltbaren_teil():
    orga = _BY_KEY["orga"]
    assert [o.key for o in orga.optionen] == ["segel"]
    # An, bis jemand es abschaltet: der Bestand soll sich nicht veraendern.
    assert orga.optionen[0].an is True


def test_ohne_gespeichertes_gilt_die_voreinstellung():
    assert _optionen_an(_BY_KEY["orga"], None) == {"segel": True}
    assert _optionen_an(_BY_KEY["orga"], {}) == {"segel": True}


def test_gespeichertes_gewinnt():
    assert _optionen_an(_BY_KEY["orga"], {"segel": False}) == {"segel": False}


def test_unbekannter_schluessel_faellt_heraus():
    # Rest aus einer Fassung, in der es die Option gab.
    assert _optionen_an(_BY_KEY["orga"], {"segel": False, "alt": True}) == {"segel": False}


def test_nicht_boolesches_gilt_als_nicht_gesetzt():
    # Ein "false" als Zeichenkette waere sonst wahr — genau falschherum.
    assert _optionen_an(_BY_KEY["orga"], {"segel": "false"}) == {"segel": True}


def test_module_ohne_optionen_liefern_leer():
    ohne = [m for m in REGISTRY if not m.optionen]
    assert ohne, "irgendein Modul sollte unteilbar sein"
    assert _optionen_an(ohne[0], {"segel": False}) == {}
