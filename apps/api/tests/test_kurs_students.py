"""Kurse aus Teilen von Klassen: einzelne SuS in einen Kurs, Roster = Klassen ∪
Einzel-SuS. Additiv — bestehende Klassen-Kurse unberührt."""
import pytest
import pytest_asyncio
from sqlalchemy import event
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from app.models import Base, User, SchoolClass, Student, Kurs
from app.routers import kurse as K


@pytest_asyncio.fixture
async def s():
    e = create_async_engine("sqlite+aiosqlite:///:memory:")

    @event.listens_for(e.sync_engine, "connect")
    def _fk(c, _):
        c.execute("PRAGMA foreign_keys=ON")

    async with e.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    async with async_sessionmaker(e, class_=AsyncSession, expire_on_commit=False)() as ss:
        yield ss
    await e.dispose()


@pytest.mark.asyncio
async def test_kurs_aus_teilen(s):
    u = User(email="a@b.de", password_hash="x", name="L"); s.add(u); await s.flush()
    a = SchoolClass(name="7a", owner_id=u.id); b = SchoolClass(name="7b", owner_id=u.id)
    s.add(a); s.add(b); await s.flush()
    a1 = Student(card_id=1, name="Ann", class_id=a.id); a2 = Student(card_id=2, name="Ben", class_id=a.id)
    b1 = Student(card_id=3, name="Cara", class_id=b.id); b2 = Student(card_id=4, name="Dora", class_id=b.id)
    for st in (a1, a2, b1, b2): s.add(st)
    kurs = Kurs(owner_id=u.id, name="Förder Mathe"); s.add(kurs); await s.commit()

    # Teilmenge: Ann (aus 7a) + Cara (aus 7b) — KEINE ganzen Klassen.
    await K.add_student_member(kurs.id, a1.id, user=u, db=s)
    await K.add_student_member(kurs.id, b1.id, user=u, db=s)

    roster = await K.kurs_students(kurs.id, user=u, db=s)
    namen = {r["name"] for r in roster}
    assert namen == {"Ann", "Cara"}   # nur die ausgewählten, nicht Ben/Dora

    mem = await K.list_student_members(kurs.id, user=u, db=s)
    assert {m["name"]: m["class_name"] for m in mem} == {"Ann": "7a", "Cara": "7b"}

    # Entfernen greift.
    await K.remove_student_member(kurs.id, a1.id, user=u, db=s)
    roster = await K.kurs_students(kurs.id, user=u, db=s)
    assert {r["name"] for r in roster} == {"Cara"}


@pytest.mark.asyncio
async def test_klassenarbeit_roster_kurs(s):
    from app.routers import klassenarbeit as KA
    u = User(email="c@d.de", password_hash="x", name="L"); s.add(u); await s.flush()
    s.add(__import__("app.models", fromlist=["UserModule"]).UserModule(user_id=u.id, module_key="klassenarbeit"))
    a = SchoolClass(name="7a", owner_id=u.id); b = SchoolClass(name="7b", owner_id=u.id); s.add(a); s.add(b); await s.flush()
    a1 = Student(card_id=1, name="Ann", class_id=a.id); b1 = Student(card_id=2, name="Bo", class_id=b.id)
    s.add(a1); s.add(b1)
    kurs = Kurs(owner_id=u.id, name="Förder"); s.add(kurs); await s.commit()
    await K.add_student_member(kurs.id, a1.id, user=u, db=s)
    await K.add_student_member(kurs.id, b1.id, user=u, db=s)
    r = await KA.roster_kurs(kurs.id, user=u, db=s)
    assert {x["name"] for x in r} == {"Ann", "Bo"}


@pytest.mark.asyncio
async def test_noten_teilkurs_roster_und_speichern(s):
    """Noten: Teilkurs-Roster = Einzel-SuS; Note für einen SuS aus einer FREMDEN
    Klasse (nicht repClass) wird akzeptiert (member_student_ids, nicht sibling)."""
    from app.models import UserModule, GradeSection, GradeCategory
    from app.routers import noten as N
    u = User(email="e@f.de", password_hash="x", name="L"); s.add(u); await s.flush()
    s.add(UserModule(user_id=u.id, module_key="noten"))
    a = SchoolClass(name="7a", owner_id=u.id); b = SchoolClass(name="7b", owner_id=u.id); s.add(a); s.add(b); await s.flush()
    a1 = Student(card_id=1, name="Ann", class_id=a.id); b1 = Student(card_id=2, name="Bo", class_id=b.id)
    s.add(a1); s.add(b1)
    kurs = Kurs(owner_id=u.id, name="Förder"); s.add(kurs); await s.commit()
    await K.add_student_member(kurs.id, a1.id, user=u, db=s)
    await K.add_student_member(kurs.id, b1.id, user=u, db=s)

    # repClass ist 7a; Roster des Teilkurses enthält beide, auch Bo aus 7b.
    roster = await N.roster_kurs(kurs.id, user=u, db=s)
    assert {r["name"] for r in roster} == {"Ann", "Bo"}

    # Abschnitt + Spalte am Teilkurs (kurs_id gesetzt, class_id=repClass 7a).
    sec = GradeSection(name="KA", weight=100, class_id=a.id, kurs_id=kurs.id, term="1", owner_id=u.id)
    s.add(sec); await s.flush()
    cat = GradeCategory(name="Test", position=0, section_id=sec.id, class_id=a.id, owner_id=u.id)
    s.add(cat); await s.commit()

    # Note für Bo (aus 7b, NICHT repClass) muss durchgehen — früher abgelehnt.
    body = N.EntryIn(category_id=cat.id, student_id=b1.id, kind="grade", value=2.0, note="2")
    await N.create_entry(body, user=u, db=s)
    ents = await N.list_entries(a.id, kurs_id=kurs.id, user=u, db=s)
    assert any(e.student_id == b1.id and e.value == 2.0 for e in ents)
