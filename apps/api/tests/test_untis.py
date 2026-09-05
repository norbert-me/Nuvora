"""Regressionstest der WebUntis-Anbindung (app/untis.py).

Geprueft wird das, was ohne Netz pruefbar ist und wo es wehtut, wenn es kippt:
die Umrechnung Untis -> Nuvora und die Uebersetzung der Fehlschlaege. Der
Netzabruf selbst wird nicht nachgebaut — er gehoert in den Systemtest.
"""
import pytest

from app.untis import (GRUENDE, UntisFehler, _CODES, _datum, _server_url, _stunde_nr,
                       _stunde_aus_api, _zeit, ausfaelle, zu_wochenraster)

ZEITEN = ["08:00", "08:50", "09:55", "10:45", "11:50", "12:35"]


def _stunde(datum, start, titel, faellt_aus=False):
    return {"datum": datum, "start": start, "ende": "", "titel": titel, "klassen": [],
            "faecher": [], "raum": "", "faellt_aus": faellt_aus, "vertretung": False}


# ─── Adresse aus dem, was Lehrkraefte wirklich eintippen ───

def test_server_url_aus_ganzer_browseradresse():
    # Der haeufige Fall: die Adresse aus der Adresszeile kopiert, samt Raute-Teil.
    url = _server_url("https://ajax.webuntis.com/WebUntis/?school=hs-nord#/basic/login", "")
    assert url == "https://ajax.webuntis.com/WebUntis/jsonrpc.do?school=hs-nord"


def test_server_url_aus_host_und_kennung():
    assert _server_url("ajax.webuntis.com", "hs-nord").endswith("jsonrpc.do?school=hs-nord")


def test_server_url_kennung_wird_kodiert():
    # Leerzeichen in der Kennung duerfen die Adresse nicht zerreissen.
    assert "school=HS%20Nord" in _server_url("ajax.webuntis.com", "HS Nord")


def test_server_url_ausdrueckliche_kennung_gewinnt():
    url = _server_url("https://ajax.webuntis.com/WebUntis/?school=alt", "neu")
    assert url.endswith("school=neu")


def test_server_url_ohne_kennung_meldet_kennung_und_nicht_server():
    # Der Grund muss stimmen: die Oberflaeche zeigt daran, WAS nachzutragen ist.
    with pytest.raises(UntisFehler) as e:
        _server_url("ajax.webuntis.com", "")
    assert e.value.grund == "schule"


def test_server_url_ohne_server():
    with pytest.raises(UntisFehler) as e:
        _server_url("", "hs-nord")
    assert e.value.grund == "server"


# ─── Zahlenformate von Untis ───

def test_zeit_und_datum():
    assert _zeit(805) == "08:05"       # Untis laesst die fuehrende Null weg
    assert _zeit(1345) == "13:45"
    assert _zeit(2599) == ""           # unmoegliche Uhrzeit -> leer, nicht "25:99"
    assert _datum(20260827).isoformat() == "2026-08-27"
    assert _datum("kaputt") is None


def test_stunde_aus_api_loest_ids_auf():
    stamm = {"faecher": {9: "M"}, "klassen": {3: "7a"}, "raeume": {1: "R1.01"}}
    roh = {"date": 20260831, "startTime": 800, "endTime": 845,
           "su": [{"id": 9}], "kl": [{"id": 3}], "ro": [{"id": 1}], "code": "cancelled"}
    s = _stunde_aus_api(roh, stamm)
    assert s["datum"] == "2026-08-31" and s["start"] == "08:00"
    assert s["titel"] == "M 7a" and s["raum"] == "R1.01"
    assert s["faellt_aus"] is True and s["vertretung"] is False


def test_stunde_aus_api_ohne_stammdaten_faellt_auf_lstext_zurueck():
    # Manche Schulen geben nur den Stundenplan frei, keine Stammdaten. Dann
    # steht dort lieber der Freitext als eine Zahl.
    s = _stunde_aus_api({"date": 20260831, "startTime": 800, "lstext": "Vertretung"},
                        {"faecher": {}, "klassen": {}, "raeume": {}})
    assert s["titel"] == "Vertretung"


# ─── Untis-Stunde -> Nuvora-Stundennummer ───

def test_stunde_nr_legt_auf_die_naechstliegende():
    assert _stunde_nr("08:00", ZEITEN) == 1
    assert _stunde_nr("08:52", ZEITEN) == 2      # zwei Minuten daneben zaehlt noch
    assert _stunde_nr("09:55", ZEITEN) == 3


def test_stunde_nr_weit_daneben_wird_weggelassen():
    # Eine Nachmittags-AG, fuer die es bei uns keine Stunde gibt: lieber
    # gar nicht einsortieren als falsch.
    assert _stunde_nr("16:30", ZEITEN) is None


# ─── Aus Tagen wird ein Wochenraster ───

def test_wochenraster_haeufigster_titel_gewinnt():
    """Die Kernregel: uebernommen wird, was sich WIEDERHOLT.

    Eine einzelne Vertretung darf den Stundenplan nicht einfaerben — sie kommt
    einmal vor, der regulaere Unterricht dreimal.
    """
    stunden = [_stunde("2026-08-31", "08:00", "M 7a"),
               _stunde("2026-09-07", "08:00", "M 7a"),
               _stunde("2026-09-14", "08:00", "Vertretung 9c"),
               _stunde("2026-09-21", "08:00", "M 7a")]
    raster = zu_wochenraster(stunden, ZEITEN)
    assert raster == {"0,1": {"titel": "M 7a", "raum": "", "anzahl": 3, "klassen": []}}


def test_wochenraster_ausfall_zaehlt_nicht_mit():
    # Eine ausgefallene Stunde ist kein Beleg dafuer, dass dort Unterricht ist.
    stunden = [_stunde("2026-08-31", "08:00", "M 7a", faellt_aus=True)]
    assert zu_wochenraster(stunden, ZEITEN) == {}


def test_wochenraster_ohne_zeitraster_bleibt_leer():
    # Ohne Nuvoras Uhrzeiten gibt es keine Stundennummer — und lieber nichts
    # als alles auf die erste Stunde geworfen.
    assert zu_wochenraster([_stunde("2026-08-31", "08:00", "M 7a")], []) == {}


def test_wochenraster_trennt_wochentage_und_stunden():
    stunden = [_stunde("2026-08-31", "08:00", "M 7a"),    # Montag, 1.
               _stunde("2026-09-01", "08:00", "D 7a"),    # Dienstag, 1.
               _stunde("2026-08-31", "08:50", "E 8b")]    # Montag, 2.
    raster = zu_wochenraster(stunden, ZEITEN)
    assert sorted(raster) == ["0,1", "0,2", "1,1"]
    assert raster["1,1"]["titel"] == "D 7a"


def test_ausfaelle_nur_die_ausgefallenen():
    stunden = [_stunde("2026-08-31", "08:00", "M 7a"),
               _stunde("2026-09-07", "08:00", "M 7a", faellt_aus=True)]
    assert ausfaelle(stunden, ZEITEN) == [
        {"datum": "2026-09-07", "stunde": 1, "titel": "M 7a"}]


# ─── Fehlschlaege muessen erklaerbar bleiben ───

def test_jeder_code_zeigt_auf_einen_bekannten_grund():
    """Die Oberflaeche zeigt zu jedem Grund einen Text samt Hinweis auf den
    ICS-Weg. Ein Grund ausserhalb von GRUENDE haette dort keinen."""
    for grund in _CODES.values():
        assert grund in GRUENDE


def test_fehler_behaelt_originaltext():
    # Eine uebersetzte Meldung ohne das Original ist nicht nachpruefbar.
    e = UntisFehler("kein_zugriff", "no right for getTimetable()")
    assert e.grund == "kein_zugriff" and "getTimetable" in e.text


def test_ics_zeit_in_utc_wird_umgerechnet():
    """WebUntis schreibt seine ICS-Zeiten oft in UTC ("…T060000Z").

    Roh gelesen waere das 06:00, und die Zuordnung zur Stundennummer traefe die
    falsche Stunde oder gar keine — der Import blieb dann leer, ohne Fehler.
    """
    from app.untis import _zeitpunkt
    assert _zeitpunkt("20260907T060000Z") == ("20260907", "08:00")   # Sommerzeit
    assert _zeitpunkt("20261207T070000Z") == ("20261207", "08:00")   # Winterzeit
    assert _zeitpunkt("20260907T080000") == ("20260907", "08:00")    # Ortszeit bleibt
    assert _zeitpunkt("20260907") == ("20260907", "")                # ganztaegig
