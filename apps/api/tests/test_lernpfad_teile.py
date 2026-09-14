"""Teilaufgaben an der Zuweisung: „Nr. 4" heißt für dieses Kind „Nr. 4 a, b".

Sie stehen im selben JSON wie die Zuweisung (`assignments`), weil sie zu ihr
gehören und nicht zur Aufgabe — dieselbe Aufgabe kann beim Nachbarn ganz
drankommen. Der Server prüft die Form nicht: `assignments` ist bewusst freies
JSON (siehe models.LearningLadder), und ein Feld mehr darf dort nicht
scheitern. Genau das hält dieser Test fest.
"""
import pytest

from app.models import LearningPath, User
from app.routers import lernpfad as lp


@pytest.mark.asyncio
async def test_teilaufgaben_ueberleben_den_roundtrip(s):
    u = User(email="t@x.de", password_hash="x", email_verified=True)
    s.add(u)
    await s.flush()
    pfad = LearningPath(name="Brüche", owner_id=u.id)
    s.add(pfad)
    await s.commit()

    zuweisung = [{"student_id": 7, "exercise_ids": [3, 9], "teile": {"3": "a, b"}}]
    neu = await lp.add_ladder(pfad.id, lp.LadderIn(assignments=zuweisung), user=u, db=s)
    assert neu.assignments[0]["teile"] == {"3": "a, b"}, "unveraendert gespeichert"

    # Und beim Aendern bleibt es erhalten.
    geaendert = await lp.update_ladder(
        neu.id, lp.LadderIn(assignments=[{"student_id": 7, "exercise_ids": [3, 9],
                                          "teile": {"3": "a", "9": "1-3"}}]), user=u, db=s)
    assert geaendert.assignments[0]["teile"] == {"3": "a", "9": "1-3"}
    assert geaendert.assignments[0]["exercise_ids"] == [3, 9], "die Zuweisung bleibt daneben"


@pytest.mark.asyncio
async def test_sammel_loeschen_fasst_nur_eigene_an(s):
    """Beim Aufräumen fallen hunderte Löschungen an. Einzeln geschickt rennen
    sie in die Bremse des Proxys (30/s) — deshalb gibt es einen Sammel-Weg.
    Fremde ids fallen darin STILL heraus: eine geratene Nummer darf weder eine
    fremde Aufgabe treffen noch die ganze Anfrage kippen."""
    from app.models import Exercise
    from app.routers.lernpfad import IdListe, delete_exercises

    ich = User(email="ich2@x.de", password_hash="x", email_verified=True)
    fremd = User(email="fremd2@x.de", password_hash="x", email_verified=True)
    s.add_all([ich, fremd])
    await s.flush()
    meine = [Exercise(owner_id=ich.id, kategorie="Basis") for _ in range(3)]
    deine = Exercise(owner_id=fremd.id, kategorie="Basis")
    s.add_all([*meine, deine])
    await s.commit()

    aus = await delete_exercises(IdListe(ids=[m.id for m in meine] + [deine.id, 999999]),
                                 user=ich, db=s)
    assert aus["geloescht"] == 3, "nur die eigenen, und kein Fehler wegen der fremden"
    for m in meine:
        await s.refresh(m)
        assert m.deleted_at is not None, "weich geloescht — 30 Tage Papierkorb"
    await s.refresh(deine)
    assert deine.deleted_at is None, "die fremde steht unberuehrt da"


@pytest.mark.asyncio
async def test_sammel_loeschen_hat_eine_obergrenze(s):
    """Eine Anfrage raeumt einen Ordner auf, nicht ein Konto."""
    from fastapi import HTTPException

    from app.routers.lernpfad import MAX_LOESCHEN, IdListe, delete_exercises

    u = User(email="grenze@x.de", password_hash="x", email_verified=True)
    s.add(u)
    await s.commit()
    with pytest.raises(HTTPException) as fehler:
        await delete_exercises(IdListe(ids=list(range(MAX_LOESCHEN + 1))), user=u, db=s)
    assert fehler.value.status_code == 400
