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


@pytest.mark.asyncio
async def test_exam_crud_and_overview(s):
    """Klassenarbeit anlegen/listen/löschen; Übersicht zählt Stundenplan-Stunden
    bis zum Termin (>=1 bei passendem Slot)."""
    from datetime import datetime, timezone, timedelta
    from app.models import UserModule, TimetableSlot
    from app.routers import kalender as K
    u = User(email="ex@d.de", password_hash="x", name="L"); s.add(u); await s.flush()
    s.add(UserModule(user_id=u.id, module_key="kalender"))
    a = SchoolClass(name="7a", owner_id=u.id); s.add(a); await s.commit()
    d = datetime.now(timezone.utc) + timedelta(days=20)
    ex = await K.create_exam(K.ExamIn(date=d, title="Vokabeltest", class_id=a.id), user=u, db=s)
    assert len(await K.list_exams(user=u, db=s)) == 1
    # Automatisch erzeugter ganztägiger Kalendereintrag.
    from app.models import CalendarEntry
    assert ex.entry_id is not None
    entry = await s.get(CalendarEntry, ex.entry_id)
    assert entry is not None and entry.period is None and "Klassenarbeit" in entry.title
    # Stunde am Wochentag des Termins -> in 20 Tagen mehrfach, mind. eine vor dem Termin.
    s.add(TimetableSlot(owner_id=u.id, weekday=d.weekday(), period=1, class_id=a.id)); await s.commit()
    ov = await K.exam_overview(user=u, db=s)
    assert len(ov) == 1 and isinstance(ov[0]["stunden"], int) and ov[0]["stunden"] >= 1
    await K.delete_exam(ex.id, user=u, db=s)
    assert await K.list_exams(user=u, db=s) == []
    assert await s.get(CalendarEntry, ex.entry_id) is None  # Eintrag mitgelöscht


@pytest.mark.asyncio
async def test_exam_auto_creates_work_when_module_active(s):
    """Bei aktivem Modul „Klassenarbeit" entsteht zum Termin automatisch eine leere
    Auswertung; ohne das Modul nicht. Eine leere wird beim Löschen mitgenommen,
    eine befüllte bleibt (Live-Daten)."""
    from datetime import datetime, timezone, timedelta
    from app.models import UserModule, WorkAnalysis
    from app.routers import kalender as K
    u = User(email="w@d.de", password_hash="x", name="L"); s.add(u); await s.flush()
    s.add(UserModule(user_id=u.id, module_key="kalender"))
    a = SchoolClass(name="7a", owner_id=u.id); s.add(a); await s.commit()
    d = datetime.now(timezone.utc) + timedelta(days=10)

    # Modul NICHT aktiv -> keine Auswertung.
    ex1 = await K.create_exam(K.ExamIn(date=d, title="Ohne", class_id=a.id), user=u, db=s)
    assert ex1.work_id is None

    # Modul aktiv -> Auswertung automatisch, leer, gleicher Name.
    s.add(UserModule(user_id=u.id, module_key="klassenarbeit")); await s.commit()
    ex2 = await K.create_exam(K.ExamIn(date=d, title="Bruchrechnung", class_id=a.id), user=u, db=s)
    assert ex2.work_id is not None
    w = await s.get(WorkAnalysis, ex2.work_id)
    assert w is not None and w.name == "Bruchrechnung" and (w.tasks or []) == []

    # Leere Auswertung wird beim Löschen des Termins mitgenommen.
    await K.delete_exam(ex2.id, user=u, db=s)
    assert await s.get(WorkAnalysis, w.id) is None

    # Befüllte Auswertung bleibt.
    ex3 = await K.create_exam(K.ExamIn(date=d, title="Terme", class_id=a.id), user=u, db=s)
    w3 = await s.get(WorkAnalysis, ex3.work_id)
    w3.tasks = [{"id": "t1", "label": "x", "topic_id": None}]; await s.commit()
    await K.delete_exam(ex3.id, user=u, db=s)
    assert await s.get(WorkAnalysis, w3.id) is not None


@pytest.mark.asyncio
async def test_exam_edit_syncs_and_recreates_work(s):
    """Edit des Termins: der leere Auto-Datensatz zieht Kurs mit; zeigt work_id ins
    Leere (Auswertung geloescht), wird beim Speichern neu angelegt."""
    from datetime import datetime, timezone, timedelta
    from app.models import UserModule, WorkAnalysis, Kurs
    from app.routers import kalender as K
    u = User(email="s2@d.de", password_hash="x", name="L"); s.add(u); await s.flush()
    s.add_all([UserModule(user_id=u.id, module_key="kalender"), UserModule(user_id=u.id, module_key="klassenarbeit")])
    a = SchoolClass(name="7.5 LZ", owner_id=u.id); s.add(a); await s.flush()
    k1 = Kurs(name="7.5 LZ", owner_id=u.id); k2 = Kurs(name="7.5", owner_id=u.id)
    s.add_all([k1, k2]); await s.commit()
    d = datetime.now(timezone.utc) + timedelta(days=10)

    # Anlegen mit falschem Kurs, dann per Edit auf den richtigen umtragen.
    ex = await K.create_exam(K.ExamIn(date=d, title="A", class_id=a.id, kurs_id=k1.id), user=u, db=s)
    w = await s.get(WorkAnalysis, ex.work_id)
    assert w.kurs_id == k1.id
    await K.update_exam(ex.id, K.ExamIn(date=d, title="A", class_id=a.id, kurs_id=k2.id), user=u, db=s)
    w = await s.get(WorkAnalysis, ex.work_id)
    assert w.kurs_id == k2.id  # leerer Auto-Datensatz zog den Kurs mit

    # Auswertung löschen (Verknüpfung ins Leere), dann Edit -> neue Auswertung.
    old = ex.work_id
    await s.delete(w); await s.commit()
    ex = await s.get(K.ExamDate, ex.id); ex.work_id = old  # verwaiste Verknüpfung simulieren
    await s.commit()
    r = await K.update_exam(ex.id, K.ExamIn(date=d, title="A", class_id=a.id, kurs_id=k2.id), user=u, db=s)
    assert r.work_id is not None
    nw = await s.get(WorkAnalysis, r.work_id)
    assert nw is not None and nw.kurs_id == k2.id and (nw.tasks or []) == []  # frisch angelegt


@pytest.mark.asyncio
async def test_exam_overview_calendar_overrides(s):
    """Stundenzählung folgt dem Kalender: ein konkreter Eintrag ERSETZT den
    wiederkehrenden Slot dieser Stunde. Wird der Kurs im Eintrag geändert, zählt
    die Stunde nicht mehr für den alten Kurs (kein Doppel-/Fehlzählen). Zusätzlich
    hinzugefügte Stunden zählen mit."""
    from datetime import datetime, timezone, timedelta
    from app.models import UserModule, TimetableSlot, CalendarEntry
    from app.routers import kalender as K
    u = User(email="ov@d.de", password_hash="x", name="L"); s.add(u); await s.flush()
    s.add(UserModule(user_id=u.id, module_key="kalender"))
    a = SchoolClass(name="7a", owner_id=u.id); s.add(a); await s.flush()
    kA = Kurs(name="Mathe 7a", owner_id=u.id)
    kB = Kurs(name="Physik 7a", owner_id=u.id)
    s.add_all([kA, kB]); await s.commit()

    # Termin für Kurs A an einem Montag, gut in der Zukunft.
    base = datetime.now(timezone.utc) + timedelta(days=30)
    while base.weekday() != 0:  # nächster Montag
        base += timedelta(days=1)
    exd = base + timedelta(days=14)  # KA zwei Wochen später, ebenfalls Montag
    ex = await K.create_exam(K.ExamIn(date=exd, title="Arbeit", class_id=a.id, kurs_id=kA.id), user=u, db=s)

    # Wiederkehrender Montags-Slot Stunde 1 für Kurs A -> zwei Montage vor der KA.
    s.add(TimetableSlot(owner_id=u.id, weekday=0, period=1, class_id=a.id, kurs_id=kA.id)); await s.commit()
    base_cnt = (await K.exam_overview(user=u, db=s))[0]["stunden"]
    assert base_cnt >= 2  # mehrere Montage bis zur KA

    # Ersten (base-)Montag umwidmen: Eintrag Stunde 1 = Kurs B. Kalender zeigt dort
    # B, also darf Kurs A diese Stunde NICHT mehr zählen -> genau eine weniger.
    s.add(CalendarEntry(owner_id=u.id, date=base, period=1, class_id=a.id, kurs_id=kB.id, title="Physik")); await s.commit()
    assert (await K.exam_overview(user=u, db=s))[0]["stunden"] == base_cnt - 1

    # Zusätzliche Stunde für Kurs A am Dienstag drauf (nicht im Raster) zählt mit.
    s.add(CalendarEntry(owner_id=u.id, date=base + timedelta(days=1), period=3, class_id=a.id, kurs_id=kA.id, title="Extra")); await s.commit()
    assert (await K.exam_overview(user=u, db=s))[0]["stunden"] == base_cnt
    await K.delete_exam(ex.id, user=u, db=s)
