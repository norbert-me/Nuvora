"""Ein Quiz sieht auf beiden Wegen aus dem Haus gleich aus.

Es gibt zwei Ausgaenge fuer dasselbe Abbild: die **Datei**
(`export_import.export_question_set`) und der **Marktplatz**
(`marketplace._snapshot_from_items`). Beide schrieben es frueher selbst, und
die zweite Fassung stand mit der Begruendung daneben, sie lasse „niveau"
bewusst weg — im Bestand tat sie das laengst nicht mehr.

Dieser Test haelt fest, was ohne ihn nur Absicht war: gleiche Schluessel,
gleiche Werte. Er ist der Grund, aus dem die Zusammenfuehrung nach
`app/austauschformat.py` nachpruefbar und nicht nur plausibel ist. Wer dem
Format ein Feld hinzufuegt, sieht hier sofort, ob es auf beiden Wegen mitkommt.
"""
import pytest

from app.models import Question, QuestionSet, QuestionSetItem, User
from app.routers import export_import as EX, marketplace as MP


async def _quiz(s):
    u = User(email="a@b.de", password_hash="x", name="L")
    s.add(u)
    await s.flush()
    qs = QuestionSet(owner_id=u.id, name="Bruchrechnen", shuffle_questions=True,
                     shuffle_answers=False, niveau_aktiv=True, minuspunkte=True)
    s.add(qs)
    await s.flush()
    q = Question(owner_id=u.id, text="Was ist 1/2 + 1/2?",
                 choices={"A": "1", "B": "2", "C": "1/4", "D": "0"},
                 correct_answer="A", image_layout="above", num_choices=4)
    s.add(q)
    await s.flush()
    it = QuestionSetItem(question_set_id=qs.id, question_id=q.id, position=0, niveau="E")
    s.add(it)
    await s.commit()
    it.question = q
    return u, qs, [it]


@pytest.mark.asyncio
async def test_datei_und_marktplatz_liefern_dasselbe_abbild(s):
    u, qs, items = await _quiz(s)
    aus_datei = await EX.export_question_set(qs.id, user=u, db=s)
    aus_markt = MP._snapshot_from_items(qs, items)
    assert aus_datei == aus_markt, "Ein Quiz darf nicht je nach Ausgang anders aussehen"


@pytest.mark.asyncio
async def test_abbild_traegt_die_wertungsregeln(s):
    """`niveau_aktiv`, `minuspunkte` und das `niveau` je Frage muessen mit.

    Ohne sie waere das uebernommene Quiz anders bewertet als das Original —
    derselbe Test, andere Noten (CLAUDE.md, E/G-Differenzierung).
    """
    u, qs, items = await _quiz(s)
    abbild = await EX.export_question_set(qs.id, user=u, db=s)
    assert abbild["type"] == "cardvote_questionset" and abbild["version"] == 1
    assert abbild["niveau_aktiv"] is True and abbild["minuspunkte"] is True
    assert abbild["questions"][0]["niveau"] == "E"
