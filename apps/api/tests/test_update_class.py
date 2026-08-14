"""Regressionstest: Klasse speichern darf keine verknuepften Daten vernichten.

Hintergrund: update_class loeschte frueher alle Schueler und legte sie neu an.
Weil students ON DELETE CASCADE auf grade_entries (Noten) und card_reviews
(Karten) hat, hat schon ein harmloses Klassen-Speichern (z.B. nur die Farbe)
live Noten geloescht. Dieser Test haelt fest, dass das nicht wieder passiert:
Schueler werden ueber ihre stabile card_id zusammengefuehrt, die ID bleibt und
die Note ueberlebt.

Lauf:  cd apps/api && pip install -r requirements-dev.txt && pytest
"""
import pytest
import pytest_asyncio
from sqlalchemy import event, select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from app.models import (
    Base, User, SchoolClass, Student, GradeSection, GradeCategory, GradeEntry,
)
from app.routers import classes as C
from app.routers.classes import update_class, ClassCreate, StudentIn


@pytest_asyncio.fixture
async def session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")

    # SQLite erzwingt Fremdschluessel nur mit diesem PRAGMA — ohne ihn wuerde die
    # Kaskade gar nicht greifen und der Test koennte eine Regression uebersehen.
    @event.listens_for(engine.sync_engine, "connect")
    def _fk_on(dbapi_conn, _):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)() as s:
        yield s
    await engine.dispose()


async def _seed(s):
    user = User(email="a@b.de", password_hash="x", name="Lehrkraft")
    s.add(user)
    await s.flush()
    cls = SchoolClass(name="7a", owner_id=user.id, color="#2563eb")
    s.add(cls)
    await s.flush()
    stud = Student(card_id=1, name="Max", class_id=cls.id)
    s.add(stud)
    await s.flush()
    sec = GradeSection(owner_id=user.id, class_id=cls.id, term="1", name="Klassenarbeiten", weight=50)
    s.add(sec)
    await s.flush()
    cat = GradeCategory(owner_id=user.id, class_id=cls.id, section_id=sec.id, name="1. KA")
    s.add(cat)
    await s.flush()
    entry = GradeEntry(category_id=cat.id, student_id=stud.id, kind="grade", value=2.0)
    s.add(entry)
    await s.commit()
    return user, cls, stud.id, entry.id


@pytest.mark.asyncio
async def test_update_class_preserves_grades(session):
    user, cls, stud_id, entry_id = await _seed(session)

    # Klasse speichern wie aus dem Formular: gleicher Schueler (card_id 1),
    # nur Name/Farbe geaendert.
    body = ClassCreate(name="7a Mathe", color="#0a7d3e", students=[
        StudentIn(card_id=1, name="Max Mustermann", niveau="", foerder=None, notizen="", klassenlehrer=""),
    ])
    await update_class(cls.id, body, user, session)

    # Schueler-ID bleibt stabil …
    stud = (await session.execute(select(Student).where(Student.class_id == cls.id))).scalar_one()
    assert stud.id == stud_id, "Schueler-ID darf sich beim Speichern nicht aendern"
    assert stud.name == "Max Mustermann"

    # … und die Note existiert unveraendert weiter.
    entries = (await session.execute(select(GradeEntry))).scalars().all()
    assert len(entries) == 1, "Note wurde beim Klassen-Speichern vernichtet"
    assert entries[0].id == entry_id
    assert entries[0].value == 2.0


@pytest.mark.asyncio
async def test_removed_student_is_deleted(session):
    """Gegenprobe: ein wirklich entfernter Schueler (card_id weg) verschwindet
    samt seiner Daten — das ist gewollt, nicht der Fehlerfall."""
    user, cls, stud_id, entry_id = await _seed(session)
    body = ClassCreate(name="7a", color="#2563eb", students=[])
    await update_class(cls.id, body, user, session)
    students = (await session.execute(select(Student).where(Student.class_id == cls.id))).scalars().all()
    assert students == []
    entries = (await session.execute(select(GradeEntry))).scalars().all()
    assert entries == []


@pytest.mark.asyncio
async def test_endgueltig_geloeschte_klasse_nimmt_ihren_leeren_kurs_mit(session):
    """Sonst bleibt ein Fach in der Liste, das es nicht mehr gibt.

    Jede neue Klasse bekommt ihren eigenen Kurs. Wurde die Klasse endgueltig
    geloescht, stand er weiter in /api/kurse — leer, ohne Klasse, und die
    Lehrkraft musste ihn von Hand hinterherraeumen. Aufgefallen ist es dem
    Oberflaechen-Systemtest, der nach jedem Lauf Reste zaehlt.
    """
    from app.models import Kurs
    s = session
    u, _, _, _ = await _seed(s)
    k = await C.create_class(ClassCreate(name="8b", students=[StudentIn(card_id=5, name="Ann")]),
                             user=u, db=s)
    kurs_id = (await s.get(SchoolClass, k.id)).kurs_id
    assert kurs_id is not None, "eine neue Klasse bringt ihren Kurs mit"

    await C.delete_class(k.id, user=u, db=s)
    await C.purge_class(k.id, user=u, db=s)
    assert await s.get(Kurs, kurs_id) is None, "der leere Kurs muss mit weg"


@pytest.mark.asyncio
async def test_geteilter_kurs_ueberlebt_die_geloeschte_klasse(session):
    """Die Gegenprobe: ein Kurs, der noch eine zweite Klasse hat, bleibt.

    Kurse sind ausdruecklich dafuer da, ueber Klassen hinaus zu gelten. Wer
    beim Aufraeumen zu grosszuegig ist, reisst fremde Noten mit."""
    from app.models import Kurs, KursTag
    s = session
    u, _, _, _ = await _seed(s)
    a = await C.create_class(ClassCreate(name="8b", students=[StudentIn(card_id=5, name="Ann")]), user=u, db=s)
    b = await C.create_class(ClassCreate(name="8c", students=[StudentIn(card_id=6, name="Ben")]), user=u, db=s)
    kurs_id = (await s.get(SchoolClass, a.id)).kurs_id
    s.add(KursTag(kurs_id=kurs_id, class_id=b.id))
    await s.commit()

    await C.delete_class(a.id, user=u, db=s)
    await C.purge_class(a.id, user=u, db=s)
    assert await s.get(Kurs, kurs_id) is not None, "der geteilte Kurs gehoert noch 7b"


@pytest.mark.asyncio
async def test_klasse_mit_quiz_laesst_sich_endgueltig_loeschen(session):
    """Eine Klasse, die je fuer ein CardVote-Quiz benutzt wurde, muss aus dem
    Papierkorb verschwinden koennen.

    sessions.class_id ist der einzige Verweis auf school_classes OHNE
    ON DELETE CASCADE. Der Purge lief deshalb in "FOREIGN KEY constraint
    failed" — und zwar auf Postgres genauso, dort werden Fremdschluessel immer
    erzwungen. Aufgefallen ist es im Log der Pruefinstanz, nicht in einem Test:
    die bisherigen Faelle loeschten nur Klassen, mit denen nie ein Quiz lief.
    """
    from app.models import Session as CvSession
    s = session
    u, _, _, _ = await _seed(s)
    k = await C.create_class(ClassCreate(name="8b", students=[StudentIn(card_id=5, name="Ann")]),
                             user=u, db=s)
    s.add(CvSession(name="Test 1", class_id=k.id, owner_id=u.id))
    await s.commit()

    await C.delete_class(k.id, user=u, db=s)
    await C.purge_class(k.id, user=u, db=s)

    assert await s.get(SchoolClass, k.id) is None, "die Klasse muss weg sein"
    uebrig = (await s.execute(select(CvSession).where(CvSession.class_id == k.id))).scalars().all()
    assert uebrig == [], "die Sitzung der Klasse gehoert mit geloescht"


@pytest.mark.asyncio
async def test_umnummerieren_nimmt_die_scans_mit(session):
    """Reihenfolge ändern vergibt neue Kartennummern — und verschiebt dabei
    KEINE Testergebnisse auf andere Kinder.

    `Scan.student_id` ist die aufgedruckte Kartennummer (kein Fremdschlüssel).
    Wer nur `students.card_id` umschreibt, hängt die alten Scans an das Kind,
    das jetzt auf der Nummer sitzt. Genau das prüft der Test: nach dem Tausch
    muss Annas Antwort weiterhin Anna gehören.
    """
    from app.models import Question, Session as CvSession, Scan

    user = User(email="r@b.de", password_hash="x", name="L")
    session.add(user)
    await session.flush()
    cls = SchoolClass(name="7b", owner_id=user.id)
    session.add(cls)
    await session.flush()
    anna = Student(card_id=1, name="Anna", class_id=cls.id, position=0)
    bea = Student(card_id=2, name="Bea", class_id=cls.id, position=1)
    session.add_all([anna, bea])
    frage = Question(owner_id=user.id, text="1+1", correct_answer="A")
    session.add(frage)
    await session.flush()
    sitzung = CvSession(owner_id=user.id, class_id=cls.id)
    session.add(sitzung)
    await session.flush()
    session.add_all([
        Scan(session_id=sitzung.id, question_id=frage.id, student_id=1, answer="A"),   # Anna
        Scan(session_id=sitzung.id, question_id=frage.id, student_id=2, answer="B"),   # Bea
    ])
    await session.commit()

    # Bea nach vorn ziehen und speichern.
    body = ClassCreate(name="7b", renumber=True, students=[
        StudentIn(card_id=2, name="Bea"), StudentIn(card_id=1, name="Anna"),
    ])
    await update_class(cls.id, body, user, session)

    kinder = {s.name: s for s in (await session.execute(
        select(Student).where(Student.class_id == cls.id))).scalars().all()}
    assert kinder["Bea"].card_id == 1 and kinder["Anna"].card_id == 2, "nicht neu durchnummeriert"
    assert kinder["Anna"].id == anna.id, "Schüler-ID muss stabil bleiben"

    scans = (await session.execute(select(Scan))).scalars().all()
    antwort = {s.student_id: s.answer for s in scans}
    assert antwort[kinder["Anna"].card_id] == "A", "Annas Antwort ist auf ein anderes Kind gerutscht"
    assert antwort[kinder["Bea"].card_id] == "B", "Beas Antwort ist auf ein anderes Kind gerutscht"


@pytest.mark.asyncio
async def test_ohne_renumber_bleiben_die_nummern(session):
    """Gegenprobe: ein gewöhnliches Speichern (Farbe, Name) fasst die
    Kartennummern nicht an — sonst wäre jeder Ausdruck nach jedem Klick tot."""
    user, cls, stud_id, _ = await _seed(session)
    body = ClassCreate(name="7a", color="#111111", students=[StudentIn(card_id=7, name="Max")])
    # card_id 7 gibt es nicht -> neuer Schueler; der alte (1) faellt weg.
    await update_class(cls.id, body, user, session)
    nummern = sorted(s.card_id for s in (await session.execute(
        select(Student).where(Student.class_id == cls.id))).scalars().all())
    assert nummern == [7], f"ohne renumber darf nichts umnummeriert werden: {nummern}"
