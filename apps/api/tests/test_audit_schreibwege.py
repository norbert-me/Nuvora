"""Audit-Befunde September 2026: Schreibwege, fremde IDs, oeffentliche Wege.

Jeder Test haelt eine Entscheidung fest, die vorher falsch war.
"""
import io

import pytest
from fastapi import HTTPException

from app.models import (Folder, Kurs, LearningLadder, LearningPath, Question,
                        QuestionSet, QuestionSetItem, SchoolClass, Session, Student, User,
                        UserModule)


async def _konto(s, mail, *module):
    u = User(email=mail, password_hash="x", name="L")
    s.add(u)
    await s.flush()
    for m in module:
        s.add(UserModule(user_id=u.id, module_key=m))
    await s.commit()
    return u


# ── Besitzlose Zeilen: lesen ja, schreiben nein ─────────────────────────────
@pytest.mark.asyncio
async def test_besitzlose_sitzung_und_frage_sind_nur_lesbar(s):
    from app.routers import questions as Q, sessions as S

    u = await _konto(s, "schreib@t.de", "cardvote")
    sess = Session(name="alt", owner_id=None)
    frage = Question(text="alt", choices={"A": "", "B": "", "C": "", "D": ""}, owner_id=None)
    s.add_all([sess, frage])
    await s.commit()

    assert (await S.get_session(sess.id, user=u, db=s))["id"] == sess.id
    with pytest.raises(HTTPException) as e:
        await S.finish_session(sess.id, user=u, db=s)
    assert e.value.status_code == 403
    with pytest.raises(HTTPException) as e:
        await Q.update_question(frage.id, Q.QuestionCreate(text="neu"), user=u, db=s)
    assert e.value.status_code == 403


@pytest.mark.asyncio
async def test_quiz_loeschen_verlangt_eigenen_besitz_und_nimmt_nur_eigene_fragen(s):
    from app.routers import folders as F

    u = await _konto(s, "quiz-a@t.de", "cardvote")
    fremd = await _konto(s, "quiz-b@t.de", "cardvote")

    # Besitzloses Quiz in besitzlosem Ordner: nicht loeschbar.
    ordner = Folder(name="alt", owner_id=None)
    s.add(ordner)
    await s.flush()
    alt = QuestionSet(name="alt", folder_id=ordner.id, owner_id=None)
    s.add(alt)
    await s.commit()
    with pytest.raises(HTTPException) as e:
        await F.delete_question_set(alt.id, user=u, db=s)
    assert e.value.status_code == 403

    # Eigenes Quiz mit einer fremden Frage: die fremde bleibt unberuehrt.
    qs = QuestionSet(name="meins", owner_id=u.id)
    f_eigen = Question(text="e", choices={}, owner_id=u.id)
    f_fremd = Question(text="f", choices={}, owner_id=fremd.id)
    s.add_all([qs, f_eigen, f_fremd])
    await s.flush()
    s.add_all([QuestionSetItem(question_set_id=qs.id, question_id=f_eigen.id, position=0),
               QuestionSetItem(question_set_id=qs.id, question_id=f_fremd.id, position=1)])
    await s.commit()
    await F.delete_question_set(qs.id, user=u, db=s)
    await s.refresh(f_eigen)
    await s.refresh(f_fremd)
    assert f_eigen.deleted_at is not None
    assert f_fremd.deleted_at is None


@pytest.mark.asyncio
async def test_quiz_im_eigenen_ordner_bekommt_beim_speichern_seinen_besitzer(s):
    from app.routers import folders as F

    u = await _konto(s, "quiz-c@t.de", "cardvote")
    ordner = Folder(name="meins", owner_id=u.id)
    s.add(ordner)
    await s.flush()
    qs = QuestionSet(name="x", folder_id=ordner.id, owner_id=None)
    s.add(qs)
    await s.commit()
    await F.update_question_set(qs.id, F.QuestionSetCreate(name="y", folder_id=ordner.id),
                                user=u, db=s)
    await s.refresh(qs)
    assert qs.owner_id == u.id


@pytest.mark.asyncio
async def test_beispielquiz_hat_einen_besitzer(s):
    from sqlalchemy import select

    from app.seed import seed_new_account

    u = await _konto(s, "seed@t.de")
    await seed_new_account(s, u.id)
    qs = (await s.execute(select(QuestionSet).join(Folder, Folder.id == QuestionSet.folder_id)
                          .where(Folder.owner_id == u.id))).scalars().all()
    assert qs and all(q.owner_id == u.id for q in qs)


# ── Code-Detektiv: nur Raetsel der Sitzung, Token schuetzt den Namen ─────────
class _Req:
    client = type("C", (), {"host": "10.0.0.9"})()
    headers: dict = {}


@pytest.mark.asyncio
async def test_code_detektiv_raetsel_und_spieler_token(s):
    from app.routers import codedetektiv as CD

    u = await _konto(s, "cd-audit@t.de", "code-detektiv")
    code = (await CD.create_session(CD.SessionCreate(puzzles=[{"id": "p1"}]), user=u, db=s))["code"]

    erst = await CD.join_session(code, CD.JoinIn(name="Mia"), request=_Req(), db=s)
    token = erst["player_token"]
    assert all("tok" not in p for p in erst["players"])
    # Derselbe Name ein zweites Mal: kein Token fuer den Zweiten.
    zweit = await CD.join_session(code, CD.JoinIn(name="Mia"), request=_Req(), db=s)
    assert "player_token" not in zweit

    with pytest.raises(HTTPException) as e:
        await CD.submit_result(code, CD.ResultIn(playerName="Mia", puzzleId="erfunden", solved=True),
                               request=_Req(), db=s)
    assert e.value.status_code == 400
    with pytest.raises(HTTPException) as e:
        await CD.submit_result(code, CD.ResultIn(playerName="Mia", puzzleId="p1", solved=True,
                                                 playerToken="falsch"), request=_Req(), db=s)
    assert e.value.status_code == 403
    st = await CD.submit_result(code, CD.ResultIn(playerName="Mia", puzzleId="p1", solved=True,
                                                  playerToken=token), request=_Req(), db=s)
    assert len(st["results"]) == 1


# ── Fremde IDs ──────────────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_fremder_kurs_im_sitzplan_wird_abgelehnt(s):
    from app.routers import sitzplan as SP

    u = await _konto(s, "sp-a@t.de", "orga")
    fremd = await _konto(s, "sp-b@t.de")
    kl = SchoolClass(name="7a", owner_id=u.id)
    k = Kurs(name="fremd", owner_id=fremd.id)
    s.add_all([kl, k])
    await s.commit()
    with pytest.raises(HTTPException) as e:
        await SP.put_plan(kl.id, SP.PlanIn(seats=[]), kurs_id=k.id, user=u, db=s)
    assert e.value.status_code == 404


@pytest.mark.asyncio
async def test_fremde_lernleiter_laesst_sich_nicht_einplanen(s):
    from app.routers import kalender as KAL

    u = await _konto(s, "kal-a@t.de", "kalender", "lernpfad")
    fremd = await _konto(s, "kal-b@t.de")
    pfad = LearningPath(name="fremd", owner_id=fremd.id)
    s.add(pfad)
    await s.flush()
    leiter = LearningLadder(path_id=pfad.id)
    s.add(leiter)
    await s.commit()

    class _B:
        lernpfad_ladder_id = leiter.id

    with pytest.raises(HTTPException) as e:
        await KAL._check_verknuepfungen(s, u, _B())
    assert e.value.status_code == 404


# ── Schueler-Zettel an einer besitzlosen Klasse ─────────────────────────────
@pytest.mark.asyncio
async def test_zettel_einer_besitzlosen_klasse_ist_tot(s):
    from app.routers import karten as KA

    kl = SchoolClass(name="alt", owner_id=None)
    s.add(kl)
    await s.flush()
    s.add(Student(card_id=1, name="K", class_id=kl.id, karten_token="altzettel"))
    await s.commit()
    with pytest.raises(HTTPException):
        await KA._student_by_token(s, "altzettel", modul="karten")


# ── Fragenbilder ─────────────────────────────────────────────────────────────
def test_fragenbild_nur_eigene_uploads():
    from pydantic import ValidationError

    from app.routers.questions import QuestionCreate

    QuestionCreate(text="x", image_url="/api/uploads/" + "a" * 32 + ".png")
    for boese in ("https://tracker.example/p.gif", "/api/uploads/../x.png",
                  "javascript:alert(1)", "/api/uploads/abc.png?x=1"):
        with pytest.raises(ValidationError):
            QuestionCreate(text="x", image_url=boese)
    with pytest.raises(ValidationError):
        QuestionCreate(text="x", choice_images={"A": "https://tracker.example/p.gif"})


def test_fragenbild_verliert_exif():
    from PIL import Image

    from app.routers.questions import _ohne_metadaten

    exif = Image.Exif()
    exif[0x010F] = "Geheimkamera"
    bild = Image.new("RGB", (8, 8), "red")
    puffer = io.BytesIO()
    bild.save(puffer, format="JPEG", exif=exif.tobytes())
    roh = puffer.getvalue()
    assert b"Geheimkamera" in roh
    sauber = _ohne_metadaten(roh, "jpg")
    assert b"Geheimkamera" not in sauber
    with Image.open(io.BytesIO(sauber)) as neu:
        assert neu.size == (8, 8)
