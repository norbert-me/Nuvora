"""Modul Kalender: der Stundenplan-Slot merkt sich den GEWÄHLTEN Kurs (kurs_id),
nicht nur die Fach-Klasse. Eine Klasse kann in mehreren Kursen liegen — ohne
kurs_id riete die Anzeige den falschen Kurs (Bug: Kurs „mathe 7.5" gewählt,
Plan zeigt Klassenname „7.5 LZ").
"""
import pytest
import pytest_asyncio
from sqlalchemy import event
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from app.models import Base, User, SchoolClass, Kurs, KursTag
from app.routers import kalender as KAL


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
async def test_slot_behaelt_kurs(s):
    u = User(email="a@b.de", password_hash="x", name="L"); s.add(u); await s.flush()
    cls = SchoolClass(name="7.5 LZ", owner_id=u.id); s.add(cls); await s.flush()
    kurs = Kurs(owner_id=u.id, name="mathe 7.5"); s.add(kurs); await s.flush()
    s.add(KursTag(kurs_id=kurs.id, class_id=cls.id)); await s.commit()

    body = KAL.SlotIn(weekday=0, period=1, class_id=cls.id, kurs_id=kurs.id)
    out = await KAL.upsert_slot(body, user=u, db=s)
    assert out.class_id == cls.id and out.kurs_id == kurs.id

    tt = await KAL.get_timetable(user=u, db=s)
    slot = tt["slots"][0]
    assert slot.kurs_id == kurs.id   # Anzeige kann so „mathe 7.5" auflösen

    # Fremder Kurs wird abgewiesen (Owner-Check).
    v = User(email="v@b.de", password_hash="x", name="V"); s.add(v); await s.flush()
    fremd = Kurs(owner_id=v.id, name="fremd"); s.add(fremd); await s.commit()
    with pytest.raises(Exception):
        await KAL.upsert_slot(KAL.SlotIn(weekday=1, period=1, class_id=cls.id, kurs_id=fremd.id), user=u, db=s)


@pytest.mark.asyncio
async def test_ics_freie_uhrzeit(s):
    """Eintrag mit freier Uhrzeit wird als getakteter VEVENT exportiert
    (DTSTART/DTEND mit Zeit), nicht als Ganztags-Termin."""
    from datetime import datetime, timezone
    from app.models import CalendarEntry
    u = User(email="c@d.de", password_hash="x", name="L", calendar_token="tok123"); s.add(u); await s.flush()
    # 12:00-verankertes Datum (wie das Frontend jetzt sendet).
    s.add(CalendarEntry(owner_id=u.id, date=datetime(2025, 9, 3, 10, 0, tzinfo=timezone.utc),
                        title="Konferenz", start_time="07:55", end_time="12:40"))
    await s.commit()
    resp = await KAL.ics_feed("tok123", db=s)
    body = resp.body.decode() if hasattr(resp.body, "decode") else resp.body
    assert "DTSTART:20250903T075500" in body
    assert "DTEND:20250903T124000" in body
    assert "SUMMARY:Konferenz" in body


@pytest.mark.asyncio
async def test_external_color_partial_update(s):
    """Farbe extern speichern darf die abonnierte URL nicht löschen (partiell)."""
    u = User(email="x@y.de", password_hash="p", name="L"); s.add(u); await s.flush()
    u.external_ics_url = "https://example.com/f.ics"; await s.commit()
    # Nur Farbe setzen -> URL bleibt.
    out = await KAL.set_external(KAL.ExtIn(color="#ff8800"), user=u, db=s)
    assert out["url"] == "https://example.com/f.ics"
    assert out["color"] == "#ff8800"
    # Ungültige Farbe -> leer.
    out = await KAL.set_external(KAL.ExtIn(color="rot"), user=u, db=s)
    assert out["color"] == ""
    assert out["url"] == "https://example.com/f.ics"


@pytest.mark.asyncio
async def test_slot_cancellation(s):
    """Stundenausfall: anlegen (idempotent), listen, löschen."""
    from datetime import datetime, timezone
    u = User(email="sc@d.de", password_hash="x", name="L"); s.add(u); await s.commit()
    d = datetime(2026, 9, 3, 12, 0, tzinfo=timezone.utc)
    await KAL.add_slot_cancellation(KAL.SlotCancelIn(date=d, period=2), user=u, db=s)
    await KAL.add_slot_cancellation(KAL.SlotCancelIn(date=d, period=2), user=u, db=s)  # idempotent
    lst = await KAL.list_slot_cancellations(user=u, db=s)
    assert len(lst) == 1 and lst[0]["period"] == 2
    await KAL.del_slot_cancellation(KAL.SlotCancelIn(date=d, period=2), user=u, db=s)
    assert await KAL.list_slot_cancellations(user=u, db=s) == []


@pytest.mark.asyncio
async def test_release_deck_via_kurs(s):
    """Kalender-Auto-Freischaltung: ein Stapel am KURS wird auch dann freigeschaltet,
    wenn der Eintrag eine ANDERE Fach-Klasse desselben Kurses hat (Bug: nur exakt
    dieselbe class_id matchte, Kurs-Decks blieben unverbunden)."""
    from datetime import datetime, timezone
    from app.models import Kurs, KursTag, Topic, CardDeck, CalendarEntry, UserModule
    u = User(email="k@d.de", password_hash="x", name="L"); s.add(u); await s.flush()
    s.add(UserModule(user_id=u.id, module_key="karten"))  # Auto-Freischaltung nur bei aktivem Modul
    a = SchoolClass(name="7a", owner_id=u.id); b = SchoolClass(name="7b", owner_id=u.id); s.add(a); s.add(b); await s.flush()
    kurs = Kurs(owner_id=u.id, name="Mathe"); s.add(kurs); await s.flush()
    s.add(KursTag(kurs_id=kurs.id, class_id=a.id)); s.add(KursTag(kurs_id=kurs.id, class_id=b.id))
    topic = Topic(name="Brüche", owner_id=u.id); s.add(topic); await s.flush()
    # Deck hängt an Klasse 7a + Kurs Mathe, Thema Brüche, noch Entwurf.
    deck = CardDeck(owner_id=u.id, class_id=a.id, kurs_id=kurs.id, topic_id=topic.id, name="D", released_at=None); s.add(deck)
    # Eintrag hat die ANDERE Fach-Klasse 7b (gleicher Kurs) + gleiches Thema.
    e = CalendarEntry(owner_id=u.id, date=datetime(2026, 9, 3, 12, tzinfo=timezone.utc), class_id=b.id, topic_id=topic.id)
    s.add(e); await s.commit()

    await KAL._release_matching_decks(s, u, e)
    await s.refresh(deck); await s.refresh(e)
    assert deck.released_at is not None       # über den Kurs verbunden + freigeschaltet
    assert e.karten_deck_id == deck.id        # automatisch am Eintrag verknüpft


@pytest.mark.asyncio
async def test_deck_created_after_entry_schedules(s):
    """Wird das Deck NACH dem Kalender-Eintrag angelegt, plant die Deck-Seite die
    Freischaltung zum Eintragsdatum und verlinkt den Eintrag (Gegenstück zur
    Kalender-Seite)."""
    from datetime import datetime, timezone
    from app.models import Topic, CalendarEntry, UserModule
    from app.routers import karten as KR
    u = User(email="d@e.de", password_hash="x", name="L"); s.add(u); await s.flush()
    s.add(UserModule(user_id=u.id, module_key="karten"))
    s.add(UserModule(user_id=u.id, module_key="kalender"))
    a = SchoolClass(name="7a", owner_id=u.id); s.add(a); await s.flush()
    topic = Topic(name="Winkel", owner_id=u.id); s.add(topic); await s.flush()
    e = CalendarEntry(owner_id=u.id, date=datetime(2026, 9, 14, 7, tzinfo=timezone.utc), class_id=a.id, topic_id=topic.id)
    s.add(e); await s.commit()

    deck = await KR.create_deck(a.id, KR.DeckIn(name="D", topic_id=topic.id), kurs_id=None, user=u, db=s)
    await s.refresh(deck); await s.refresh(e)
    assert deck.released_at == e.date          # zum Termin geplant
    assert e.karten_deck_id == deck.id         # Eintrag verlinkt
