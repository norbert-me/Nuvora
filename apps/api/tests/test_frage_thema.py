"""Das Thema an der Frage — es darf beim Speichern nicht verschwinden.

Der Fall aus dem Betrieb: der Fragen-Editor im Quiz bekam seine Felder aus
`_set_to_dict` (folders.py), und darin fehlte `topic_id`. Also zeigte er
„Kein Thema", obwohl eins gesetzt war, und schickte beim Speichern auch keins
mit. `update_question` setzte daraufhin jedes nicht genannte Feld auf seinen
Default — ein Klick auf „Speichern" loeschte die Themenzuordnung still.

Still ist das Teure daran: die Frage sieht danach unveraendert aus, faellt aber
aus der Themen-Ansicht, aus „schwache Themen" und aus jeder Bruecke zum
Lernpfad heraus. Deshalb beide Haelften hier festgehalten:

  * das Quiz nennt das Thema (sonst kann die Oberflaeche es gar nicht kennen),
  * ein PUT ohne `topic_id` laesst es stehen — mit `topic_id: null` faellt es
    weiter ausdruecklich weg.

Lauf:  cd apps/api && pytest tests/test_frage_thema.py
"""
import pytest

from app.models import User, Topic, Question, QuestionSet, QuestionSetItem
from app.routers import questions as Q
from app.routers import folders as F


async def _welt(s):
    u = User(email="a@b.de", password_hash="x", name="L")
    s.add(u)
    await s.flush()
    thema = Topic(name="Dreiecke", owner_id=u.id, position=0)
    s.add(thema)
    await s.flush()
    frage = Question(text="Wie gross ist gamma?", question_type="mc",
                     choices={"A": "60", "B": "70"}, correct_answer="A",
                     owner_id=u.id, topic_id=thema.id)
    s.add(frage)
    await s.flush()
    quiz = QuestionSet(name="Test", owner_id=u.id)
    s.add(quiz)
    await s.flush()
    s.add(QuestionSetItem(question_set_id=quiz.id, question_id=frage.id, position=0))
    await s.commit()
    return u, thema, frage, quiz


@pytest.mark.asyncio
async def test_quiz_nennt_das_thema_der_frage(s):
    """Ohne dieses Feld kann der Editor im Quiz das Thema nicht anzeigen — und
    was er nicht kennt, schickt er auch nicht zurueck."""
    u, thema, frage, quiz = await _welt(s)
    daten = await F._load_set(s, quiz.id)
    assert daten["questions"][0]["topic_id"] == thema.id


@pytest.mark.asyncio
async def test_speichern_ohne_thema_im_rumpf_laesst_das_thema_stehen(s):
    """Der eigentliche Schaden: ein PUT, das `topic_id` nicht nennt, darf die
    Zuordnung nicht loeschen."""
    u, thema, frage, quiz = await _welt(s)
    body = Q.QuestionCreate.model_validate({
        "text": "Wie gross ist gamma?",
        "choices": {"A": "60", "B": "70"},
        "correct_answer": "A",
    })
    await Q.update_question(frage.id, body, user=u, db=s)

    frisch = await s.get(Question, frage.id)
    assert frisch.topic_id == thema.id, "Speichern hat das Thema geloescht"


@pytest.mark.asyncio
async def test_thema_ausdruecklich_entfernen_geht_weiter(s):
    """Die Gegenrichtung: wer `topic_id: null` schickt, meint es auch so."""
    u, thema, frage, quiz = await _welt(s)
    body = Q.QuestionCreate.model_validate({
        "text": "Wie gross ist gamma?",
        "choices": {"A": "60", "B": "70"},
        "correct_answer": "A",
        "topic_id": None,
    })
    await Q.update_question(frage.id, body, user=u, db=s)

    frisch = await s.get(Question, frage.id)
    assert frisch.topic_id is None


# ─── Fragen, die in keinem Quiz mehr stecken ───
#
# Sie sind ueber den Editor nicht erreichbar (dorthin kommt man nur ueber ein
# Quiz), stehen aber in der Themen-Ansicht — neben ihrem Zwilling aus dem Quiz
# sieht das aus wie eine doppelte Zeile. Aufgeraeumt wird deshalb ausdruecklich,
# und mit einer Ausnahme, die wichtiger ist als eine leere Liste.


@pytest.mark.asyncio
async def test_verwaiste_frage_wird_gefunden_und_geloescht(s):
    u, thema, frage, quiz = await _welt(s)
    from app.models import Session as CvSession, SchoolClass

    waise = Question(text="Reste einer geloeschten Reihe", question_type="mc",
                     choices={"A": "x"}, correct_answer="A", owner_id=u.id)
    s.add(waise)
    await s.commit()

    stand = await Q.verwaiste_fragen(user=u, db=s)
    assert stand["anzahl"] == 1 and stand["loeschbar"] == 1
    assert stand["fragen"][0]["id"] == waise.id

    weg = await Q.verwaiste_fragen_loeschen(user=u, db=s)
    assert weg["geloescht"] == 1
    assert await s.get(Question, waise.id) is None
    # Die Frage im Quiz bleibt selbstverstaendlich stehen.
    assert await s.get(Question, frage.id) is not None


@pytest.mark.asyncio
async def test_zwilling_aus_der_sammlung_wird_mitgeliefert(s):
    """Der Partner beantwortet die eigentliche Aufraeumfrage.

    „Diese Waise gibt es schon im Quiz X" ist der Grund, sie loeschen zu
    koennen. Also muss die Antwort den Zwilling nennen — mit seiner Sammlung,
    aber ausserhalb von `fragen`: geloescht wird er nie.
    """
    u, thema, frage, quiz = await _welt(s)

    waise = Question(text="  WIE gross ist   gamma?\n", question_type="mc",
                     choices={"A": "60", "B": "70"}, correct_answer="A", owner_id=u.id)
    fremd = Question(text="Ganz andere Frage", question_type="mc",
                     choices={"A": "x"}, correct_answer="A", owner_id=u.id)
    s.add_all([waise, fremd])
    await s.commit()

    stand = await Q.verwaiste_fragen(user=u, db=s)
    assert stand["anzahl"] == 2  # Partner zaehlen nicht mit
    assert {f["id"] for f in stand["fragen"]} == {waise.id, fremd.id}

    partner = stand["partner"]
    assert [p["id"] for p in partner] == [frage.id]
    assert partner[0]["sammlungen"] == [{"id": quiz.id, "name": "Test"}]
    # Grob genug: Gross-/Kleinschreibung und Leerraum trennen die beiden nicht.
    assert partner[0]["text"] == "Wie gross ist gamma?"

    # Und der Partner bleibt beim Aufraeumen selbstverstaendlich stehen.
    weg = await Q.verwaiste_fragen_loeschen(user=u, db=s)
    assert weg["geloescht"] == 2
    assert await s.get(Question, frage.id) is not None


@pytest.mark.asyncio
async def test_frage_mit_ergebnissen_bleibt_stehen(s):
    """Die Ausnahme: an Scans haengen die Auswertungen gehaltener Sitzungen.
    Eine Frage dafuer zu loeschen, waere ein stiller Datenverlust — und der
    Bericht sagt, dass sie stehen blieb."""
    u, thema, frage, quiz = await _welt(s)
    from app.models import Session as CvSession, SchoolClass, Scan

    cls = SchoolClass(name="7a", owner_id=u.id)
    s.add(cls)
    await s.flush()
    waise = Question(text="War mal in einem Quiz", question_type="mc",
                     choices={"A": "x"}, correct_answer="A", owner_id=u.id)
    s.add(waise)
    await s.flush()
    sitzung = CvSession(question_set_id=quiz.id, class_id=cls.id, owner_id=u.id)
    s.add(sitzung)
    await s.flush()
    s.add(Scan(session_id=sitzung.id, question_id=waise.id, student_id=1, answer="A"))
    await s.commit()

    stand = await Q.verwaiste_fragen(user=u, db=s)
    assert stand["anzahl"] == 1 and stand["loeschbar"] == 0
    assert stand["fragen"][0]["hat_ergebnisse"] is True

    weg = await Q.verwaiste_fragen_loeschen(user=u, db=s)
    assert weg["geloescht"] == 0 and weg["behalten"] == 1
    assert await s.get(Question, waise.id) is not None


@pytest.mark.asyncio
async def test_quiz_loeschen_nimmt_seine_eigenen_fragen_mit(s):
    """Die Ursache der Reste: ein geloeschtes Quiz liess seine Fragen liegen.

    Danach waren sie nirgends mehr erreichbar (an eine Frage kommt man nur
    ueber ein Quiz) und standen doch weiter in der Themen-Ansicht — neben dem
    Zwilling aus einem anderen Quiz sah das aus wie eine doppelte Zeile.

    Drei Faelle in einem Test, weil nur ihr Zusammenspiel die Regel ergibt:
    allein-am-Quiz faellt weg, auch-woanders bleibt, mit-Ergebnissen bleibt.
    """
    u, thema, frage, quiz = await _welt(s)
    from app.models import Session as CvSession, SchoolClass, Scan

    cls = SchoolClass(name="7a", owner_id=u.id)
    s.add(cls)
    nur_hier = Question(text="nur in diesem Quiz", question_type="mc",
                        choices={"A": "x"}, correct_answer="A", owner_id=u.id)
    geteilt = Question(text="auch woanders", question_type="mc",
                       choices={"A": "x"}, correct_answer="A", owner_id=u.id)
    gescannt = Question(text="hat Ergebnisse", question_type="mc",
                        choices={"A": "x"}, correct_answer="A", owner_id=u.id)
    s.add_all([nur_hier, geteilt, gescannt])
    await s.flush()

    zweites = QuestionSet(name="Zweites Quiz", owner_id=u.id)
    s.add(zweites)
    await s.flush()
    s.add_all([
        QuestionSetItem(question_set_id=quiz.id, question_id=nur_hier.id, position=1),
        QuestionSetItem(question_set_id=quiz.id, question_id=geteilt.id, position=2),
        QuestionSetItem(question_set_id=quiz.id, question_id=gescannt.id, position=3),
        QuestionSetItem(question_set_id=zweites.id, question_id=geteilt.id, position=0),
    ])
    # Die Sitzung haengt am ZWEITEN Quiz: `sessions.question_set_id` hat kein
    # ON DELETE, ein Quiz mit gehaltener Sitzung laesst sich ohnehin nicht
    # loeschen. Geprueft wird hier der Schutz der Frage, nicht diese Sperre.
    sitzung = CvSession(question_set_id=zweites.id, class_id=cls.id, owner_id=u.id)
    s.add(sitzung)
    await s.flush()
    s.add(Scan(session_id=sitzung.id, question_id=gescannt.id, student_id=1, answer="A"))
    await s.commit()

    await F.delete_question_set(quiz.id, user=u, db=s)

    # Weich: die Frage liegt im Papierkorb, nicht im Nichts. Ein geloeschtes
    # Quiz nimmt oft Fragen mit, die man doch noch braucht.
    await s.refresh(nur_hier)
    assert nur_hier.deleted_at is not None, "Waise blieb sichtbar liegen"
    await s.refresh(geteilt)
    assert geteilt.deleted_at is None, "Frage aus einem anderen Quiz mitgerissen"
    await s.refresh(gescannt)
    assert gescannt.deleted_at is None, "Frage mit Ergebnissen geloescht"


@pytest.mark.asyncio
async def test_fragen_an_ein_quiz_anhaengen(s):
    """Zuweisen statt loeschen: der Weg fuer die 400 Fragen, die nur ihr Quiz
    verloren haben.

    Additiv, nicht ersetzend — `PUT /question-sets/{id}` verlangt die ganze
    Liste, und zwei gleichzeitige Zuweisungen wuerden sich gegenseitig
    ueberschreiben. Eine Frage, die schon drin ist, wird still uebergangen,
    sonst scheitert eine Zuweisung von 40 an der einen, die schon drinsteht.
    """
    u, thema, frage, quiz = await _welt(s)
    waise = Question(text="ohne Quiz", question_type="mc", choices={"A": "x"},
                     correct_answer="A", owner_id=u.id)
    s.add(waise)
    await s.commit()

    daten = await F.fragen_anhaengen(
        quiz.id, F.FragenAnhaengen(question_ids=[waise.id, frage.id]), user=u, db=s)

    ids = [q["id"] for q in daten["questions"]]
    assert ids == [frage.id, waise.id], "angehaengt wird ans Ende, ohne Dublette"
    stand = await Q.verwaiste_fragen(user=u, db=s)
    assert stand["anzahl"] == 0


# ─── Papierkorb ───
#
# Fragen und Themen wurden hart geloescht: ein Fehlklick, und die Frage war mit
# Bild, Antworten und Formeln weg. Beide gehen jetzt denselben Weg wie alles
# andere Geloeschte — 30 Tage im Papierkorb (routers/trash.py).


@pytest.mark.asyncio
async def test_frage_landet_im_papierkorb_und_kommt_zurueck(s):
    from app.routers import trash as TR

    u, thema, frage, quiz = await _welt(s)
    await Q.delete_question(frage.id, user=u, db=s)

    await s.refresh(frage)
    assert frage.deleted_at is not None, "hart geloescht statt in den Papierkorb"
    # Aus dem Quiz ist sie weg, ihr Set-Eintrag bleibt aber liegen — sonst
    # stuende sie nach dem Zurueckholen nicht wieder an ihrem Platz.
    assert (await F._load_set(s, quiz.id))["questions"] == []
    assert (await Q.list_questions(user=u, db=s)) == []

    liste = await TR.list_trash(user=u, db=s)
    eintrag = [i for i in liste if i.kind == "question"]
    assert len(eintrag) == 1 and eintrag[0].id == frage.id
    assert eintrag[0].context == "Test", "das Quiz gehoert als Kontext daneben"

    await Q.restore_question(frage.id, user=u, db=s)
    assert len((await F._load_set(s, quiz.id))["questions"]) == 1


@pytest.mark.asyncio
async def test_thema_landet_im_papierkorb_samt_unterthemen(s):
    from app.routers import trash as TR
    from app.routers import topics as T

    u, thema, frage, quiz = await _welt(s)
    unter = Topic(name="Winkelsumme", owner_id=u.id, parent_id=thema.id, position=0)
    s.add(unter)
    await s.commit()

    await T.delete_topic(thema.id, user=u, db=s)

    assert [t.id for t in (await T.list_topics(user=u, db=s))] == []
    liste = await TR.list_trash(user=u, db=s)
    themen = [i for i in liste if i.kind == "topic"]
    assert len(themen) == 1, "das Unterthema gehoert nicht als eigener Eintrag hinein"
    assert themen[0].id == thema.id

    # Die Frage behaelt ihr Thema — sonst kaeme es leer zurueck.
    await s.refresh(frage)
    assert frage.topic_id == thema.id

    await T.restore_topic(thema.id, user=u, db=s)
    assert sorted(t.id for t in (await T.list_topics(user=u, db=s))) == sorted([thema.id, unter.id])


@pytest.mark.asyncio
async def test_voraussetzung_bleibt_beim_umbenennen_stehen(s):
    """`PUT /api/topics/{id}` setzt jedes nicht genannte Feld auf leer.

    Genau daran ist das Thema der Frage schon einmal verschwunden (siehe oben).
    Beim Thema faellt es noch leichter aus dem Blick: das Umbenennen aus der
    Liste schickt seinen eigenen kleinen Rumpf.
    """
    from app.routers import topics as T

    u, thema, frage, quiz = await _welt(s)
    await T.update_topic(thema.id, T.TopicIn(name="Dreiecke", notes="Notiz",
                                             voraussetzungen="Winkel messen"), user=u, db=s)
    await T.update_topic(thema.id, T.TopicIn(name="Dreiecke (7)", notes="Notiz",
                                             voraussetzungen="Winkel messen"), user=u, db=s)

    frisch = [t for t in (await T.list_topics(user=u, db=s)) if t.id == thema.id][0]
    assert frisch.name == "Dreiecke (7)"
    assert frisch.voraussetzungen == "Winkel messen"


@pytest.mark.asyncio
async def test_loeschen_ist_wiederholbar(s):
    """Der Fall aus dem Selbsttest: erst das Quiz loeschen (das legt seine
    alleinigen Fragen selbst in den Papierkorb), dann die Frage loeschen. Das
    zweite DELETE meinte denselben Zustand und bekam 404 — der Lauf wurde rot,
    obwohl alles richtig war. Loeschen muss wiederholbar sein."""
    u, thema, frage, quiz = await _welt(s)
    await Q.delete_question(frage.id, user=u, db=s)
    await s.refresh(frage)
    # SQLite gibt den Zeitstempel ohne Zeitzone zurueck — verglichen wird der
    # Wert, nicht seine Darstellung.
    zuvor = frage.deleted_at.replace(tzinfo=None)

    await Q.delete_question(frage.id, user=u, db=s)   # darf nicht werfen

    await s.refresh(frage)
    assert frage.deleted_at.replace(tzinfo=None) == zuvor, \
        "der zweite Aufruf hat den Zeitpunkt verschoben"
