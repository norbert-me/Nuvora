"""Fremde IDs im Request duerfen keine fremden Daten sichtbar machen.

Ein Sicherheits-Audit hat fuenf Wege gefunden, die alle demselben Muster
folgen: eine ID aus dem Request wird ungeprueft in eine EIGENE Zeile
geschrieben, und die spaetere Ausgabe prueft nur noch, ob diese Zeile einem
gehoert. Der Umweg ueber die eigene Zeile hebelt die Mandantentrennung aus,
ohne sie sichtbar zu verletzen.

Der bestehende `test_tenant_isolation.py` findet das nicht: er prueft den
direkten Zugriff auf eine fremde ID („fremde Klasse lesen"), nicht den Umweg.
Genau die Router, die er nicht abdeckt, hatten die Funde.

Zweite Fehlerklasse hier: eine unbekannte ID wurde zum Fremdschluesselfehler
und damit zu HTTP 500 — fuer die Lehrkraft sieht das aus, als sei der Server
kaputt.
"""
import pytest
from fastapi import HTTPException

from app.models import User, UserModule, SchoolClass, Student, Question, QuestionSet
from app.routers import folders as F
from app.routers import sessions as S
from app.routers import results as R
from app.routers import noten as N


async def _lehrkraft(db, mail):
    u = User(email=mail, password_hash="x", name=mail.split("@")[0])
    db.add(u)
    await db.flush()
    for key in ("cardvote", "auswertung", "karten"):
        db.add(UserModule(user_id=u.id, module_key=key))
    await db.commit()
    return u


async def _fremde_welt(db):
    """Eine zweite Lehrkraft mit Klasse, Schueler, Frage und Quiz."""
    fremd = await _lehrkraft(db, "fremd@schule.de")
    kl = SchoolClass(name="Fremde 7a", owner_id=fremd.id)
    db.add(kl)
    await db.flush()
    db.add(Student(card_id=1, name="Fremdes Kind", class_id=kl.id))
    frage = Question(text="Geheime Frage", question_type="mc",
                     choices={"A": "1", "B": "2"}, correct_answer="A", owner_id=fremd.id)
    db.add(frage)
    await db.flush()
    quiz = QuestionSet(name="Fremdes Quiz", owner_id=fremd.id)
    db.add(quiz)
    await db.commit()
    return fremd, kl, frage, quiz


@pytest.mark.asyncio
async def test_quiz_aus_fremden_fragen_wird_abgelehnt(db):
    """Ein Quiz aus fremden Fragen gab beim Lesen deren vollstaendigen Text
    samt richtiger Antwort heraus — das eigene Quiz zu lesen war ja erlaubt."""
    _, _, frage, _ = await _fremde_welt(db)
    ich = await _lehrkraft(db, "ich@schule.de")

    with pytest.raises(HTTPException) as ex:
        await F.create_question_set(
            F.QuestionSetCreate(name="Meins", question_ids=[frage.id]), user=ich, db=db)
    assert ex.value.status_code == 404
    assert "Frage" in ex.value.detail


@pytest.mark.asyncio
async def test_unbekannte_fragen_id_gibt_400er_statt_500(db):
    """Vorher: Fremdschluesselfehler → HTTP 500. Die Lehrkraft sah einen
    Serverfehler, obwohl nur eine ID nicht stimmte."""
    ich = await _lehrkraft(db, "ich@schule.de")
    with pytest.raises(HTTPException) as ex:
        await F.create_question_set(
            F.QuestionSetCreate(name="Meins", question_ids=[999999]), user=ich, db=db)
    assert ex.value.status_code == 404


@pytest.mark.asyncio
async def test_sitzung_auf_fremder_klasse_wird_abgelehnt(db):
    """Die Sitzung gehoerte danach legitim mir — und die Auswertung gab Namen
    und Kartennummern aller Kinder der fremden Klasse heraus."""
    _, kl, _, quiz = await _fremde_welt(db)
    ich = await _lehrkraft(db, "ich@schule.de")

    with pytest.raises(HTTPException) as ex:
        await S.create_session(S.SessionCreate(name="Test", class_id=kl.id), user=ich, db=db)
    assert ex.value.status_code == 404
    assert "Klasse" in ex.value.detail

    with pytest.raises(HTTPException) as ex:
        await S.create_session(S.SessionCreate(name="Test", question_set_id=quiz.id),
                               user=ich, db=db)
    assert ex.value.status_code == 404
    assert "Quiz" in ex.value.detail


@pytest.mark.asyncio
async def test_fragenstatistik_nur_zur_eigenen_frage(db):
    """Der Endpunkt gab zu JEDER fremden Frage Antwortverteilung und
    Trefferquote heraus — durchzaehlbar ueber die ID."""
    _, _, frage, _ = await _fremde_welt(db)
    ich = await _lehrkraft(db, "ich@schule.de")

    with pytest.raises(HTTPException) as ex:
        await R.get_question_stats(frage.id, user=ich, db=db)
    assert ex.value.status_code == 404


@pytest.mark.asyncio
async def test_noten_mit_fremdem_kurs_werden_abgelehnt(db):
    """kurs_id kam roh aus der Adresse. Betroffen waren Notenuebersicht,
    Jahresuebersicht, Zeugnis-PDF und Export — jeder Weg, der eine
    Namensliste ausgibt."""
    from app.models import Kurs
    fremd, _, _, _ = await _fremde_welt(db)
    fremder_kurs = Kurs(name="Fremder Kurs", owner_id=fremd.id)
    db.add(fremder_kurs)
    await db.flush()

    ich = await _lehrkraft(db, "ich@schule.de")
    meine = SchoolClass(name="Meine 8b", owner_id=ich.id)
    db.add(meine)
    await db.commit()

    with pytest.raises(HTTPException) as ex:
        await N._kurs_roster(db, ich, meine.id, kurs_id=fremder_kurs.id)
    assert ex.value.status_code == 404


@pytest.mark.asyncio
async def test_der_eigene_weg_bleibt_offen(db):
    """Gegenprobe: die Pruefungen duerfen den Normalfall nicht verhindern."""
    ich = await _lehrkraft(db, "ich@schule.de")
    meine = SchoolClass(name="Meine 8b", owner_id=ich.id)
    db.add(meine)
    frage = Question(text="Meine Frage", question_type="mc",
                     choices={"A": "1", "B": "2"}, correct_answer="A", owner_id=ich.id)
    db.add(frage)
    await db.flush()

    quiz = await F.create_question_set(
        F.QuestionSetCreate(name="Meins", question_ids=[frage.id]), user=ich, db=db)
    assert quiz["name"] == "Meins"

    sitzung = await S.create_session(
        S.SessionCreate(name="Test", class_id=meine.id), user=ich, db=db)
    assert sitzung.class_id == meine.id

    stats = await R.get_question_stats(frage.id, user=ich, db=db)
    assert stats is not None, "die eigene Frage muss abrufbar bleiben"
