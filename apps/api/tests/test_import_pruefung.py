"""Import-Endpunkte: der zweite Weg in dieselbe Tabelle hat dieselben Regeln.

Eine Importdatei kommt aus einem aelteren Nuvora-Stand oder ist von Hand
bearbeitet. Frueher gingen ihre Werte roh in die Datenbank (eine Note 99 kam
durch und sprengte danach jeden gewichteten Schnitt) oder rissen den Aufruf in
einen HTTP 500 mit Traceback — die Lehrkraft erfuhr nie, welches Feld schuld war.

Je Endpunkt zwei Faelle: der Normalfall darf nicht kaputtgehen, und eine kaputte
Datei muss 400 mit Feldnamen geben, niemals 500.
"""
import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.models import (CalendarEntry, Folder, GradeEntry, GradeSection, Method,
                        QuestionSet, SchoolClass, Session as TestSession, Student,
                        TimetableSlot, User, UserModule)
from app.routers import export_import as EXP
from app.routers import kalender as KAL
from app.routers import methoden as MET
from app.routers import noten as NOT
from app.routers import sessions as SES


async def _lehrkraft(s, mail="l@d.de", module=("auswertung", "kalender", "unterrichtsplanung", "cardvote")):
    u = User(email=mail, password_hash="x", name="L")
    s.add(u)
    await s.flush()
    for m in module:
        s.add(UserModule(user_id=u.id, module_key=m))
    await s.commit()
    return u


async def _klasse(s, u, name="7a", namen=("Ada", "Bob")):
    c = SchoolClass(name=name, owner_id=u.id)
    s.add(c)
    await s.flush()
    for i, n in enumerate(namen, start=1):
        s.add(Student(card_id=i, name=n, class_id=c.id))
    await s.commit()
    return c


def _fehler(exc) -> str:
    """HTTPException muss 400 sein und die Meldung darf nicht leer sein."""
    assert isinstance(exc, HTTPException), f"kein HTTPException sondern {type(exc)}"
    assert exc.status_code == 400, f"Status {exc.status_code} statt 400"
    return str(exc.detail)


# ─── Noten: die Datei mit den Noten ───

def _notendatei(**patch):
    datei = {
        "type": "nuvora_noten", "version": 1, "term": "1",
        "sections": [{"name": "Klassenarbeiten", "weight": 50, "position": 0,
                      "categories": [{"name": "KA 1", "position": 0}]}],
        "entries": [{"card_id": 1, "s": 0, "c": 0, "kind": "grade", "value": 2.3,
                     "tendency": 0, "note": "", "date": "2026-03-01T10:00:00"}],
        "overrides": [{"card_id": 2, "s": 0, "value": 3.0}],
        "dividers": [{"s": 0, "c": 0}],
    }
    datei.update(patch)
    return datei


@pytest.mark.asyncio
async def test_noten_import_normalfall_bleibt_heil(s):
    u = await _lehrkraft(s)
    c = await _klasse(s, u)
    res = await NOT.import_noten(c.id, _notendatei(), user=u, db=s)
    assert res["imported"] == 1
    sec = (await s.execute(select(GradeSection))).scalar_one()
    assert sec.name == "Klassenarbeiten" and sec.weight == 50
    e = (await s.execute(select(GradeEntry))).scalar_one()
    assert e.value == 2.3 and e.kind == "grade"
    assert e.date.year == 2026 and e.date.month == 3


@pytest.mark.asyncio
async def test_noten_import_weist_unmoegliche_note_ab(s):
    """Der Kern der Sache: 1,0–6,0 gilt beim Tippen — und muss beim Import gelten.
    Frueher landete die 99 roh in GradeEntry und verdarb jeden Schnitt."""
    u = await _lehrkraft(s)
    c = await _klasse(s, u)
    with pytest.raises(HTTPException) as ei:
        await NOT.import_noten(c.id, _notendatei(entries=[{"card_id": 1, "s": 0, "c": 0, "value": 99}]), user=u, db=s)
    msg = _fehler(ei.value)
    assert "value" in msg and "6,0" in msg
    # Und nichts davon steht in der Datenbank.
    assert (await s.execute(select(GradeEntry))).scalars().all() == []


@pytest.mark.asyncio
async def test_noten_import_weist_note_als_wort_ab(s):
    u = await _lehrkraft(s)
    c = await _klasse(s, u)
    with pytest.raises(HTTPException) as ei:
        await NOT.import_noten(c.id, _notendatei(entries=[{"card_id": 1, "s": 0, "c": 0, "value": "drei"}]), user=u, db=s)
    assert "value" in _fehler(ei.value)


@pytest.mark.asyncio
async def test_noten_import_weist_gewicht_als_wort_ab(s):
    """int(sec.get("weight")) warf frueher einen ValueError — HTTP 500."""
    u = await _lehrkraft(s)
    c = await _klasse(s, u)
    kaputt = _notendatei()
    kaputt["sections"][0]["weight"] = "viel"
    with pytest.raises(HTTPException) as ei:
        await NOT.import_noten(c.id, kaputt, user=u, db=s)
    assert "weight" in _fehler(ei.value)


@pytest.mark.asyncio
async def test_noten_import_weist_gewicht_ueber_hundert_ab(s):
    u = await _lehrkraft(s)
    c = await _klasse(s, u)
    kaputt = _notendatei()
    kaputt["sections"][0]["weight"] = 900
    with pytest.raises(HTTPException) as ei:
        await NOT.import_noten(c.id, kaputt, user=u, db=s)
    assert "0 und 100" in _fehler(ei.value)


@pytest.mark.asyncio
async def test_noten_import_ueberlebt_liste_als_spaltenindex(s):
    """(s, c) wurde als Tupel-Schluessel benutzt: eine Liste darin ist unhashbar
    und riss den Import in einen TypeError, also HTTP 500."""
    u = await _lehrkraft(s)
    c = await _klasse(s, u)
    with pytest.raises(HTTPException) as ei:
        await NOT.import_noten(c.id, _notendatei(entries=[{"card_id": 1, "s": [0, 1], "c": 0, "value": 2.0}]), user=u, db=s)
    assert "s" in _fehler(ei.value)


@pytest.mark.asyncio
async def test_noten_import_weist_unmoegliche_bereichsnote_ab(s):
    u = await _lehrkraft(s)
    c = await _klasse(s, u)
    with pytest.raises(HTTPException) as ei:
        await NOT.import_noten(c.id, _notendatei(overrides=[{"card_id": 2, "s": 0, "value": 0.2}]), user=u, db=s)
    assert "overrides" in _fehler(ei.value)


@pytest.mark.asyncio
async def test_noten_import_bleibt_bei_alten_dateien_nachsichtig(s):
    """Ruecksicht auf frueher exportierte Dateien: fehlende Felder duerfen weiter
    fehlen (Gewicht, Tendenz, Datum, ganze Abschnitte ohne Spalten)."""
    u = await _lehrkraft(s)
    c = await _klasse(s, u)
    alt = {"type": "nuvora_noten", "sections": [{"name": "Sonstige"}],
           "entries": [{"card_id": 1, "s": 0, "c": 0, "value": 2.0, "date": "kein Datum"}]}
    res = await NOT.import_noten(c.id, alt, user=u, db=s)
    assert res["imported"] == 1
    sec = (await s.execute(select(GradeSection))).scalar_one()
    assert sec.weight == 0
    # Die Spalte fehlte -> der Eintrag findet keine Zelle und wird uebergangen,
    # statt den ganzen Lauf abzubrechen.
    assert (await s.execute(select(GradeEntry))).scalars().all() == []


@pytest.mark.asyncio
async def test_noten_import_prueft_das_dateiformat(s):
    u = await _lehrkraft(s)
    c = await _klasse(s, u)
    with pytest.raises(HTTPException) as ei:
        await NOT.import_noten(c.id, {"type": "irgendwas"}, user=u, db=s)
    assert ei.value.status_code == 400


# ─── Kalender: Stundenplan und Termine ───

def _kalenderdatei(**patch):
    datei = {
        "type": "nuvora_kalender", "version": 1,
        "timetable": {"periods": 6, "times": [], "slots": [{"weekday": 0, "period": 1, "class": "7a", "title": "M"}]},
        "breaks": [{"start_date": "2026-10-01T00:00:00", "end_date": "2026-10-14T00:00:00", "label": "Herbst"}],
        "entries": [{"date": "2026-09-03T12:00:00", "period": 2, "title": "Bruchrechnen", "notes": "", "class": "7a", "topic": ""}],
    }
    datei.update(patch)
    return datei


@pytest.mark.asyncio
async def test_kalender_import_normalfall_bleibt_heil(s):
    u = await _lehrkraft(s)
    await _klasse(s, u)
    res = await KAL.import_kalender(_kalenderdatei(), user=u, db=s)
    assert res["imported"] == 1
    slot = (await s.execute(select(TimetableSlot))).scalar_one()
    assert slot.weekday == 0 and slot.period == 1 and slot.class_id is not None
    e = (await s.execute(select(CalendarEntry))).scalar_one()
    assert e.title == "Bruchrechnen" and e.period == 2


@pytest.mark.asyncio
async def test_kalender_import_weist_unmoeglichen_wochentag_ab(s):
    """0–6 gilt in upsert_slot — der Importweg darf nicht mehr duerfen."""
    u = await _lehrkraft(s)
    datei = _kalenderdatei()
    datei["timetable"]["slots"][0]["weekday"] = 9
    with pytest.raises(HTTPException) as ei:
        await KAL.import_kalender(datei, user=u, db=s)
    msg = _fehler(ei.value)
    assert "weekday" in msg and "Wochentag" in msg


@pytest.mark.asyncio
async def test_kalender_import_weist_stundenzahl_als_wort_ab(s):
    """int(tt["periods"]) warf frueher einen ValueError, und das
    except (KeyError, ValueError) darunter fing ohnehin keinen TypeError."""
    u = await _lehrkraft(s)
    datei = _kalenderdatei()
    datei["timetable"]["periods"] = "viele"
    with pytest.raises(HTTPException) as ei:
        await KAL.import_kalender(datei, user=u, db=s)
    assert "periods" in _fehler(ei.value)


@pytest.mark.asyncio
async def test_kalender_import_ueberlebt_liste_als_stunde(s):
    u = await _lehrkraft(s)
    datei = _kalenderdatei()
    datei["timetable"]["slots"][0]["period"] = [1, 2]
    with pytest.raises(HTTPException) as ei:
        await KAL.import_kalender(datei, user=u, db=s)
    assert "period" in _fehler(ei.value)


@pytest.mark.asyncio
async def test_kalender_import_bleibt_bei_alten_dateien_nachsichtig(s):
    """Alte Dateien hatten weder timetable noch breaks; ein Zeitraum ohne Ende
    wird uebergangen statt den Lauf abzubrechen."""
    u = await _lehrkraft(s)
    res = await KAL.import_kalender(
        {"type": "nuvora_kalender", "breaks": [{"start_date": "2026-10-01T00:00:00"}],
         "entries": [{"date": "2026-09-03T12:00:00", "title": "X"}]}, user=u, db=s)
    assert res["imported"] == 1


# ─── Methoden: Sammlung von Einstiegen ───

@pytest.mark.asyncio
async def test_methoden_import_normalfall_und_kaputte_dauer(s):
    u = await _lehrkraft(s)
    res = await MET.import_einstiege(
        {"type": "nuvora_einstiege", "items": [{"title": "Blitzlicht", "dauer": 5},
                                               {"title": "Ohne Dauer", "dauer": None}]}, user=u, db=s)
    assert res["imported"] == 2
    titel = sorted(m.title for m in (await s.execute(select(Method))).scalars().all())
    assert titel == ["Blitzlicht", "Ohne Dauer"]

    with pytest.raises(HTTPException) as ei:
        await MET.import_einstiege(
            {"type": "nuvora_einstiege", "items": [{"title": "X", "dauer": "lang"}]}, user=u, db=s)
    assert "dauer" in _fehler(ei.value)


@pytest.mark.asyncio
async def test_methoden_import_ueberlebt_items_als_text(s):
    u = await _lehrkraft(s)
    with pytest.raises(HTTPException) as ei:
        await MET.import_einstiege({"type": "nuvora_einstiege", "items": "keine Liste"}, user=u, db=s)
    assert "items" in _fehler(ei.value)


# ─── Klassen- und Fragen-Import (CardVote) ───

@pytest.mark.asyncio
async def test_klassen_import_normalfall_und_fehlende_kartennummer(s):
    u = await _lehrkraft(s)
    res = await EXP.import_class({"type": "cardvote_class", "name": "8b",
                                  "students": [{"card_id": 1, "name": "Ada"}]}, user=u, db=s)
    assert res["name"] == "8b"
    assert (await s.execute(select(Student).where(Student.class_id == res["id"]))).scalars().all()[0].name == "Ada"

    with pytest.raises(HTTPException) as ei:
        await EXP.import_class({"type": "cardvote_class", "name": "8c",
                                "students": [{"name": "Ohne Nummer"}]}, user=u, db=s)
    assert "card_id" in _fehler(ei.value)


@pytest.mark.asyncio
async def test_klassen_import_weist_kartennummer_als_wort_ab(s):
    u = await _lehrkraft(s)
    with pytest.raises(HTTPException) as ei:
        await EXP.import_class({"type": "cardvote_class", "name": "8d",
                                "students": [{"card_id": "erste", "name": "Ada"}]}, user=u, db=s)
    assert "card_id" in _fehler(ei.value)


@pytest.mark.asyncio
async def test_fragenset_import_normalfall_und_fehlender_fragetext(s):
    u = await _lehrkraft(s)
    datei = {"type": "cardvote_questionset", "name": "Brueche", "niveau_aktiv": True,
             "questions": [{"text": "2+2?", "choices": {"A": "3", "B": "4"}, "correct_answer": "B",
                            "num_choices": 2, "niveau": "E"}]}
    res = await EXP.import_question_set(datei, user=u, db=s)
    qs = await s.get(QuestionSet, res["id"])
    assert qs.name == "Brueche" and qs.niveau_aktiv is True

    with pytest.raises(HTTPException) as ei:
        await EXP.import_question_set({"type": "cardvote_questionset", "name": "X",
                                       "questions": [{"choices": {}}]}, user=u, db=s)
    assert "text" in _fehler(ei.value)


@pytest.mark.asyncio
async def test_fragenset_import_bleibt_bei_alten_dateien_nachsichtig(s):
    """Aeltere Exporte kannten weder niveau_aktiv noch minuspunkte."""
    u = await _lehrkraft(s)
    res = await EXP.import_question_set(
        {"type": "cardvote_questionset", "name": "Alt", "questions": [{"text": "Frage"}]}, user=u, db=s)
    qs = await s.get(QuestionSet, res["id"])
    assert qs.niveau_aktiv is False and qs.minuspunkte is False


@pytest.mark.asyncio
async def test_ordner_import_legt_an_und_gehoert_der_lehrkraft(s):
    """Im Ordner-Import stand owner_id=user.id in einer Funktion ohne `user` —
    jeder Ordner-Import endete als NameError, also HTTP 500."""
    u = await _lehrkraft(s)
    datei = {"type": "cardvote_folder", "name": "Mathe",
             "question_sets": [{"name": "Set 1", "questions": [{"text": "Frage"}]}],
             "children": [{"name": "Unterordner", "question_sets": [], "children": []}]}
    res = await EXP.import_folder(datei, db=s, user=u)
    ordner = (await s.execute(select(Folder))).scalars().all()
    assert {f.name for f in ordner} == {"Mathe", "Unterordner"}
    assert all(f.owner_id == u.id for f in ordner)
    qs = (await s.execute(select(QuestionSet))).scalar_one()
    assert qs.owner_id == u.id and qs.folder_id == res["id"]


@pytest.mark.asyncio
async def test_ordner_import_weist_kaputte_struktur_ab(s):
    u = await _lehrkraft(s)
    with pytest.raises(HTTPException) as ei:
        await EXP.import_folder({"type": "cardvote_folder", "name": "M", "question_sets": "keins"}, db=s, user=u)
    assert "question_sets" in _fehler(ei.value)


@pytest.mark.asyncio
async def test_ordner_import_geht_nicht_in_fremde_ordner(s):
    u = await _lehrkraft(s)
    v = await _lehrkraft(s, "fremd@d.de")
    fremd = Folder(name="Fremd", owner_id=v.id)
    s.add(fremd)
    await s.commit()
    with pytest.raises(HTTPException) as ei:
        await EXP.import_folder({"type": "cardvote_folder", "name": "M"}, folder_id=fremd.id, db=s, user=u)
    assert ei.value.status_code == 404


# ─── Excel-Import: eine Datei, die keine Excel-Datei ist ───

class _Datei:
    """Minimaler UploadFile-Ersatz."""
    def __init__(self, daten: bytes):
        self._daten = daten

    async def read(self, n: int = -1) -> bytes:
        return self._daten if n < 0 else self._daten[:n]


@pytest.mark.asyncio
async def test_excel_import_weist_nicht_excel_dateien_ab(s):
    """load_workbook() ohne try: jede Nicht-xlsx-Datei endete als HTTP 500 mit
    openpyxl-Traceback."""
    u = await _lehrkraft(s)
    with pytest.raises(HTTPException) as ei:
        await EXP.import_class_xlsx(name="7a", file=_Datei(b"Karten-Nr;Name\n1;Ada\n"), user=u, db=s)
    assert _fehler(ei.value)
    with pytest.raises(HTTPException) as ei:
        await EXP.import_questions_xlsx(name="Set", file=_Datei(b"PK\x03\x04kaputt"), user=u, db=s)
    assert _fehler(ei.value)


@pytest.mark.asyncio
async def test_excel_import_normalfall_bleibt_heil(s):
    """Die Vorlage aus dem eigenen Haus muss weiter durchgehen."""
    from openpyxl import Workbook
    import io as _io
    u = await _lehrkraft(s)
    wb = Workbook()
    ws = wb.active
    ws.append(["Karten-Nr", "Name"])
    ws.append([1, "Ada"])
    ws.append([2, "Bob"])
    buf = _io.BytesIO()
    wb.save(buf)
    res = await EXP.import_class_xlsx(name="7c", file=_Datei(buf.getvalue()), user=u, db=s)
    assert res["count"] == 2


# ─── Session-Einstellungen: was die Auswertung spaeter liest ───

async def _session(s, u):
    sess = TestSession(name="T", owner_id=u.id, code="0001", status="active")
    s.add(sess)
    await s.commit()
    return sess


@pytest.mark.asyncio
async def test_loesungen_normalfall_und_liste(s):
    u = await _lehrkraft(s)
    sess = await _session(s, u)
    await SES.save_question_map(sess.id, {"7": "B", "8": "AC"}, user=u, db=s)
    assert (await s.get(TestSession, sess.id)).question_map == {"7": "B", "8": "AC"}

    with pytest.raises(HTTPException) as ei:
        await SES.save_question_map(sess.id, ["B", "A"], user=u, db=s)
    assert _fehler(ei.value)


@pytest.mark.asyncio
async def test_notenskala_muss_lesbar_bleiben(s):
    """grade_scale wird ueberall als {int(k): v} gelesen — ein Schluessel wie
    "eins" liess frueher erst den Export mit HTTP 500 auffliegen, weit weg vom
    Speichern."""
    u = await _lehrkraft(s)
    sess = await _session(s, u)
    gut = {"weights": {"7": 2}, "grade_scale": {"1": 87, "2": 73, "3": 59, "4": 45, "5": 20, "6": 0},
           "krank": ["3"], "anwesend": [], "times": {"7": 12.5}, "total_time": 300}
    await SES.save_eval_config(sess.id, gut, user=u, db=s)
    assert (await s.get(TestSession, sess.id)).eval_config["krank"] == ["3"]

    with pytest.raises(HTTPException) as ei:
        await SES.save_eval_config(sess.id, {"grade_scale": {"eins": 87}}, user=u, db=s)
    assert "grade_scale" in _fehler(ei.value)

    with pytest.raises(HTTPException) as ei:
        await SES.save_eval_config(sess.id, {"weights": {"7": "doppelt"}}, user=u, db=s)
    assert "weights" in _fehler(ei.value)


@pytest.mark.asyncio
async def test_eigene_felder_der_oberflaeche_bleiben_erlaubt(s):
    """Die Oberflaeche schickt die vorhandene Konfiguration mit zurueck — ein
    spaeter ergaenztes Feld darf hier nicht scheitern."""
    u = await _lehrkraft(s)
    sess = await _session(s, u)
    await SES.save_eval_config(sess.id, {"irgendwas_neues": {"a": 1}}, user=u, db=s)
    assert (await s.get(TestSession, sess.id)).eval_config == {"irgendwas_neues": {"a": 1}}
