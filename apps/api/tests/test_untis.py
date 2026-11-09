"""Regressionstest der WebUntis-Anbindung (app/untis.py).

Geprueft wird das, was ohne Netz pruefbar ist und wo es wehtut, wenn es kippt:
die Umrechnung Untis -> Nuvora und die Uebersetzung der Fehlschlaege. Der
Netzabruf selbst wird nicht nachgebaut — er gehoert in den Systemtest.
"""
import json

import pytest

from app import untis as U

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
    assert raster == {"0,1": {"titel": "M 7a", "raum": "", "anzahl": 3, "klassen": [], "faecher": []}}


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


# ─── Der Import legt Kurse an, wenn es sie noch nicht gibt ───
#
# Untis kennt Fach und Klasse, Nuvora beim ersten Import nichts davon. Ohne
# diesen Weg muesste die Lehrkraft fuenfzehn Kurse von Hand anlegen und sie im
# Dialog wieder heraussuchen. Zwei Dinge duerfen dabei nie kippen: je NAME
# genau ein Kurs (das Wochenraster nennt Mathe 7.5 viermal), und ein
# vorhandener wird benutzt statt verdoppelt — sonst liegen die Noten nach dem
# zweiten Import in zwei Kursen.

@pytest.mark.asyncio
async def test_import_legt_jeden_kurs_genau_einmal_an(s):
    from sqlalchemy import select

    from app.models import Kurs, User, UserModule
    from app.routers import kalender as K

    u = User(email="untis@b.de", password_hash="x", name="L")
    s.add(u)
    await s.flush()
    s.add(UserModule(user_id=u.id, module_key="kalender"))
    s.add(Kurs(owner_id=u.id, name="Lernzeit 7.5"))
    await s.commit()

    slot = lambda wd, p, name: K.UntisSlotIn(weekday=wd, period=p, title="M 7.5",
                                             kurs_neu=name, fach="Mathe")
    d = await K.untis_uebernehmen(K.UntisUebernahmeIn(slots=[
        slot(0, 1, "Mathe 7.5"), slot(2, 3, "Mathe 7.5"),   # derselbe Kurs, zwei Stunden
        slot(1, 2, "Lernzeit 7.5"),                          # den gibt es schon
    ]), user=u, db=s)
    assert d["kurse"] == 1, "nur Mathe 7.5 ist neu"
    assert d["slots"] == 3

    kurse = (await s.execute(select(Kurs).where(Kurs.owner_id == u.id))).scalars().all()
    assert sorted(k.name for k in kurse) == ["Lernzeit 7.5", "Mathe 7.5"]
    mathe = [k for k in kurse if k.name == "Mathe 7.5"][0]
    assert mathe.fach == "Mathe", "das Fach kommt aus Untis mit (einen Jahrgang traegt der Kurs nicht)"

    slots = (await s.execute(select(K.TimetableSlot).where(K.TimetableSlot.owner_id == u.id))).scalars().all()
    assert {sl.kurs_id for sl in slots} == {mathe.id, [k for k in kurse if k.name == "Lernzeit 7.5"][0].id}


@pytest.mark.asyncio
async def test_zweiter_import_legt_nichts_doppelt_an(s):
    from sqlalchemy import select

    from app.models import Kurs, User, UserModule
    from app.routers import kalender as K

    u = User(email="untis2@b.de", password_hash="x", name="L")
    s.add(u)
    await s.flush()
    s.add(UserModule(user_id=u.id, module_key="kalender"))
    await s.commit()

    eingabe = K.UntisUebernahmeIn(slots=[K.UntisSlotIn(weekday=0, period=1, title="M 7.5",
                                                       kurs_neu="Mathe 7.5", fach="Mathe")])
    await K.untis_uebernehmen(eingabe, user=u, db=s)
    d = await K.untis_uebernehmen(eingabe, user=u, db=s)
    assert d["kurse"] == 0
    kurse = (await s.execute(select(Kurs).where(Kurs.owner_id == u.id))).scalars().all()
    assert len(kurse) == 1


# ─── Vertretungen aus dem Abo ───

def _woche(n, titel, start="08:00"):
    from datetime import date, timedelta
    return {"datum": (date(2026, 9, 7) + timedelta(weeks=n)).isoformat(), "start": start, "titel": titel}


def test_abweichungen_findet_vertretung_und_zusatzstunde():
    stunden = [_woche(0, "M 7.5"), _woche(1, "M 7.5"), _woche(2, "E 9.2"), _woche(3, "M 7.5"),
               _woche(2, "D 8.1", start="09:45")]
    treffer = {(s["datum"], s["titel"]) for s in U.abweichungen(stunden)}
    assert treffer == {("2026-09-21", "E 9.2"), ("2026-09-21", "D 8.1")}


def test_abweichungen_regulaeres_bleibt_draussen():
    stunden = [_woche(n, "M 7.5") for n in range(4)]
    assert U.abweichungen(stunden) == []


def test_abweichungen_fragt_den_eigenen_plan_bei_duennem_feed():
    # Nur eine Woche im Feed: kein Muster. Der eigene Plan sagt, was regulaer ist.
    stunden = [_woche(0, "M 7.5"), _woche(0, "D 8.1", start="09:45")]
    plan = lambda d, start: ["M 7.5"] if start == "08:00" else []
    assert [s["titel"] for s in U.abweichungen(stunden, plan)] == ["D 8.1"]


def test_abweichungen_gleichstand_ist_kein_muster():
    # Zwei Wochen, zwei Titel: keiner ist „der regulaere“ — ohne eigenen Plan
    # werden beide gezeigt statt einer geraten.
    stunden = [_woche(0, "M 7.5"), _woche(1, "E 9.2")]
    assert len(U.abweichungen(stunden)) == 2


def test_ics_text_rechnet_utc_um():
    from datetime import date
    text = ("BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART:20260921T060000Z\nDTEND:20260921T064500Z\n"
            "SUMMARY:M 7.5\nEND:VEVENT\nEND:VCALENDAR\n")
    s = U.stunden_aus_ics_text(text, date(2026, 9, 1), date(2026, 9, 30))
    assert s[0]["start"] == "08:00" and s[0]["datum"] == "2026-09-21"


@pytest.mark.asyncio
async def test_import_ohne_zuordnung_ueberschreibt_keinen_kurs(s):
    """Reiner Text aus Untis darf eine Stunde mit Kurs nicht entkoppeln."""
    from sqlalchemy import select

    from app.models import Kurs, User, UserModule
    from app.routers import kalender as K

    u = User(email="untis3@b.de", password_hash="x", name="L")
    s.add(u)
    await s.flush()
    s.add(UserModule(user_id=u.id, module_key="kalender"))
    k = Kurs(owner_id=u.id, name="6.4 Informatik")
    s.add(k)
    await s.commit()
    await K.upsert_slot(K.SlotIn(weekday=0, period=1, title="", kurs_id=k.id), user=u, db=s)

    d = await K.untis_uebernehmen(K.UntisUebernahmeIn(slots=[
        K.UntisSlotIn(weekday=0, period=1, title="INF 6.4"),   # ohne Kurs
        K.UntisSlotIn(weekday=1, period=1, title="M 8.3"),     # leerer Platz: wird gesetzt
    ]), user=u, db=s)
    assert d["bewahrt"] == 1 and d["slots"] == 1
    slots = (await s.execute(select(K.TimetableSlot).where(
        K.TimetableSlot.owner_id == u.id, K.TimetableSlot.weekday == 0))).scalars().all()
    assert [x.kurs_id for x in slots] == [k.id]


# ─── Vertretungen per Anmeldung holen: Titel, Stand, Entdoppeln ───

class _FakeSitzung:
    def __init__(self, *a, **k):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def stundenplan(self, von, bis):
        from datetime import date, timedelta
        d = (date.today() + timedelta(days=1)).isoformat()
        return [
            {"datum": d, "start": "08:00", "ende": "08:50", "titel": "M 8.3", "raum": "A1",
             "info": "Aufgaben im Buch", "orig": "D", "faellt_aus": False, "vertretung": True},
            {"datum": d, "start": "09:00", "ende": "09:50", "titel": "E 7a", "raum": "",
             "info": "", "orig": "", "faellt_aus": True, "vertretung": False},
            {"datum": d, "start": "10:00", "ende": "10:50", "titel": "Frei", "raum": "",
             "info": "", "orig": "", "faellt_aus": False, "vertretung": False},
        ]


@pytest.mark.asyncio
async def test_vertretungen_holen_speichert_titel_und_zeigt_sie(s, monkeypatch):
    from datetime import date, timedelta

    from app import untis as U
    from app.models import User, UserModule
    from app.routers import kalender as K

    monkeypatch.setattr(U, "UntisSitzung", _FakeSitzung)
    u = User(email="untis4@b.de", password_hash="x", name="L",
             timetable_times=[{"start": "08:00", "end": "08:50"}, {"start": "09:00", "end": "09:50"},
                              {"start": "10:00", "end": "10:50"}])
    s.add(u)
    await s.flush()
    s.add(UserModule(user_id=u.id, module_key="kalender"))
    await s.commit()

    d = await K.untis_vertretungen_holen(K.UntisAbrufIn(passwort="geheim"), user=u, db=s)
    assert d["ok"] and d["anzahl"] == 3          # Vertretung, Entfall und die Stunde ohne eigenen Plan (Zusatz)
    assert "geheim" not in str(u.untis_stand), "das Passwort wird nie gespeichert"

    cal = K._untis_kalender(u)
    assert cal, "ein Stand allein macht den Untis-Kalender (auch ohne Abo-Link)"
    heute = date.today()
    zeilen = await K._untis_vertretungen(u, s, "", cal, heute, heute + timedelta(days=30))
    titel = sorted(z["title"] for z in zeilen)
    assert titel == ["Entfall: E 7a", "Vertretung: M 8.3 (statt D)", "Zusatz: Frei"]
    assert [z for z in zeilen if z["title"].startswith("Vertretung")][0]["description"] == "Aufgaben im Buch"


def test_stunde_ohne_namen_nennt_ihre_art():
    stamm = {"faecher": {}, "klassen": {}, "raeume": {}}
    assert _stunde_aus_api({"date": 20261111, "startTime": 1145, "activityType": "Veranstaltung"},
                           stamm)["titel"] == "Veranstaltung"
    assert _stunde_aus_api({"date": 20261111, "startTime": 1145, "lstype": "oh"},
                           stamm)["titel"] == "Sprechstunde"


# ─── Untis Mobile: Schluessel statt Passwort ───

def test_geheimnis_rundlauf_und_manipulation(monkeypatch):
    from app import geheimnis as G
    monkeypatch.setenv("TOKEN_SECRET", "abc" * 20)
    t = G.verschluesseln('{"key": "JBSWY3DPEHPK3PXP"}')
    assert "JBSWY" not in t, "der Klartext steht nicht im Ablageformat"
    assert G.entschluesseln(t) == '{"key": "JBSWY3DPEHPK3PXP"}'
    assert G.verschluesseln("x") != G.verschluesseln("x"), "jedes Mal ein anderer Nonce"
    assert G.entschluesseln(t[:-3] + "AAA") is None, "verändert -> kein Klartext"
    monkeypatch.setenv("TOKEN_SECRET", "andere" * 10)
    assert G.entschluesseln(t) is None, "anderer Server-Schlüssel -> getrennt statt Müll"
    assert G.entschluesseln("") is None and G.entschluesseln("v1.kaputt") is None


def test_totp_rfc_wert():
    from app.untis_mobile import totp
    assert totp("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 59) == "287082"


def test_link_lesen():
    from app.untis_mobile import link_lesen
    z = link_lesen("untis://setschool?url=ges-hurth.webuntis.com&school=ges-hurth&user=VANO"
                   "&key=JBSWY3DPEHPK3PXP&schoolNumber=1")
    assert z["host"] == "ges-hurth.webuntis.com" and z["benutzer"] == "VANO"
    for kaputt in ("", "untis://setschool?url=x", "https://example.com/?key=1",
                   "untis://setschool?url=a.b.c&school=s&user=u&key=!!!!!!!!"):
        with pytest.raises(ValueError):
            link_lesen(kaputt)


def test_perioden_werden_zu_stunden():
    from app.untis_mobile import stunden_aus_perioden
    md = {"klassen": [{"id": 1, "name": "8.3"}], "subjects": [{"id": 2, "name": "M"}, {"id": 3, "name": "D"}],
          "rooms": [{"id": 4, "name": "A1"}], "teachers": [{"id": 5, "lastName": "Ich"}, {"id": 6, "lastName": "Muster"}],
          "timeGrid": {"days": [{"day": "MON", "units": [{"startTime": "08:10"}, {"startTime": "11:45"}]}]}}

    def p(start, ende, kennz, text=None, tid=5, torg=5):
        return {"startDateTime": start, "endDateTime": ende, "is": kennz, "text": text or {},
                "elements": [{"type": "CLASS", "id": 1, "orgId": 1}, {"type": "SUBJECT", "id": 2, "orgId": 3},
                             {"type": "ROOM", "id": 4, "orgId": 4}, {"type": "TEACHER", "id": tid, "orgId": torg}]}

    st = stunden_aus_perioden([
        p("2026-11-11T10:45Z", "2026-11-11T11:35Z", ["IRREGULAR"], {"substitution": "Aufgaben", "info": ""}, torg=6),
        p("2026-11-12T08:10", "2026-11-12T09:00", ["CANCELLED"]),
        p("2026-11-13T08:10", "2026-11-13T09:00", ["REGULAR"]),
    ], md)
    v, c, r = st
    assert v["datum"] == "2026-11-11" and v["start"] == "11:45", "UTC wird in Schulzeit umgerechnet, wo das Raster es bestätigt"
    assert v["titel"] == "M 8.3" and v["raum"] == "A1" and v["vertretung"] is True
    assert "D" in v["orig"] and "Muster" in v["orig"] and v["info"] == "Aufgaben"
    assert c["faellt_aus"] is True and c["start"] == "08:10", "Ortszeit mit Z wird nicht doppelt umgerechnet"
    assert r["vertretung"] is False and r["faellt_aus"] is False


@pytest.mark.asyncio
async def test_mobil_verbinden_holen_und_trennen(s, monkeypatch):
    from datetime import date, timedelta

    from app import untis as U, untis_mobile as M
    from app.models import User, UserModule
    from app.routers import kalender as K

    monkeypatch.setenv("TOKEN_SECRET", "x" * 40)
    tag = (date.today() + timedelta(days=1)).isoformat()

    class Fake:
        def __init__(self, z):
            self.z = z

        def pruefen(self):
            return {}

        def stundenplan(self, von, bis):
            return [{"datum": tag, "start": "08:00", "ende": "08:50", "titel": "M 8.3", "raum": "",
                     "info": "", "orig": "Muster", "faellt_aus": False, "vertretung": True}]

    monkeypatch.setattr(M, "MobileSitzung", Fake)
    u = User(email="untis5@b.de", password_hash="x", name="L")
    s.add(u)
    await s.flush()
    s.add(UserModule(user_id=u.id, module_key="kalender"))
    await s.commit()

    link = "untis://setschool?url=ges.webuntis.com&school=ges&user=VANO&key=JBSWY3DPEHPK3PXP"
    assert (await K.untis_mobil_setzen(K.UntisMobilIn(link=link), user=u, db=s))["ok"]
    assert "JBSWY3DPEHPK3PXP" not in (u.untis_mobil or ""), "der Schlüssel liegt nur verschlüsselt in der Datenbank"
    assert (await K.untis_konto(user=u))["mobil"] is True
    assert "JBSWY" not in json.dumps(await K.untis_konto(user=u)), "und kommt nie wieder heraus"

    d = await K.untis_vertretungen_holen(K.UntisAbrufIn(), user=u, db=s)    # ohne Passwort
    assert d["ok"] and d["anzahl"] == 1
    assert u.untis_stand["stunden"][0]["orig"] == "Muster"

    await K.untis_mobil_trennen(user=u, db=s)
    assert u.untis_mobil is None and u.untis_stand is None
    assert (await K.untis_vertretungen_holen(K.UntisAbrufIn(), user=u, db=s))["ok"] is False


def test_stand_wird_hoechstens_alle_30_minuten_geholt(monkeypatch):
    import time as _t

    from app.models import User
    from app.routers import kalender as K

    u = User(email="u@b.de", password_hash="x", name="L")
    u.id = 4711
    assert K._stand_faellig(u, _t.time()) is False, "ohne Zugang nie"
    u.untis_mobil = "v1.x"
    K._STAND_VERSUCH.pop(4711, None)
    assert K._stand_faellig(u, _t.time()) is True, "Zugang, noch nie geholt"
    K._STAND_VERSUCH[4711] = _t.time()
    assert K._stand_faellig(u, _t.time()) is False, "gerade erst versucht (auch nach Fehlschlag)"
