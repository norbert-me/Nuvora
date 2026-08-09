"""Modul Kalender — Raender: Tagesgrenze bei der Freigabe, ICS-Feed, freie
Zeitraeume, Stundenplan-Gueltigkeit ueber den Monatswechsel und das Loeschen
eines Eintrags, an dem eine Klassenarbeit haengt.
"""
import pytest
import pytest_asyncio
from datetime import date, datetime, timedelta, timezone
from sqlalchemy import event, select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from app.models import (Base, CalendarBreak, CalendarEntry, CardDeck, ExamDate, Kurs,
                        SchoolClass, TimetableSlot, Topic, User, UserModule)
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


async def _lehrkraft(s, mail="k@d.de", module=("kalender",), token=None):
    u = User(email=mail, password_hash="x", name="L", calendar_token=token)
    s.add(u)
    await s.flush()
    for m in module:
        s.add(UserModule(user_id=u.id, module_key=m))
    await s.commit()
    return u


@pytest.mark.asyncio
async def test_freigabe_ab_tagesbeginn_nicht_erst_mittags(s):
    """Kalender-Eintraege sind auf 12:00 verankert (so sendet es die Oberflaeche).
    Wurde released_at daraus uebernommen, war der Stapel in der 1. Stunde noch
    unsichtbar und tauchte erst am Nachmittag auf. Freigeschaltet wird ab
    Tagesbeginn."""
    u = await _lehrkraft(s, module=("kalender", "karten"))
    cls = SchoolClass(name="7a", owner_id=u.id)
    s.add(cls)
    await s.flush()
    t = Topic(name="Brüche", owner_id=u.id)
    s.add(t)
    await s.flush()
    deck = CardDeck(owner_id=u.id, class_id=cls.id, topic_id=t.id, name="D", released_at=None)
    e = CalendarEntry(owner_id=u.id, date=datetime(2026, 9, 3, 12, 0, tzinfo=timezone.utc),
                      class_id=cls.id, topic_id=t.id)
    s.add_all([deck, e])
    await s.commit()

    await KAL._release_matching_decks(s, u, e)
    await s.refresh(deck)
    assert deck.released_at.replace(tzinfo=None) == datetime(2026, 9, 3, 0, 0)


@pytest.mark.asyncio
async def test_ics_feed_zeigt_nur_das_eigene_konto(s):
    """Der Feed haengt an einem Token statt an einem Login — er darf ausschliesslich
    die Termine, Ferien und Stundenplan-Stunden DIESES Kontos enthalten."""
    u = await _lehrkraft(s, "a@d.de", token="tok-a")
    v = await _lehrkraft(s, "b@d.de", token="tok-b")
    cv = SchoolClass(name="Fremdklasse", owner_id=v.id)
    s.add(cv)
    await s.flush()
    s.add_all([
        CalendarEntry(owner_id=u.id, date=datetime(2026, 9, 3, 12, tzinfo=timezone.utc), title="Meins"),
        CalendarEntry(owner_id=v.id, date=datetime(2026, 9, 3, 12, tzinfo=timezone.utc), title="Fremd", notes="geheim"),
        CalendarBreak(owner_id=v.id, start_date=datetime(2026, 10, 1), end_date=datetime(2026, 10, 3), label="Fremdferien"),
        TimetableSlot(owner_id=v.id, weekday=0, period=1, class_id=cv.id),
    ])
    await s.commit()

    body = (await KAL.ics_feed("tok-a", db=s)).body.decode()
    assert "SUMMARY:Meins" in body
    for fremd in ("Fremd", "geheim", "Fremdferien", "Fremdklasse"):
        assert fremd not in body


@pytest.mark.asyncio
async def test_ics_feed_bleibt_bei_zeilenumbruechen_heil(s):
    """Notizen kommen aus einem mehrzeiligen Feld. Ein \\r (Windows-Umbruch) blieb
    frueher unmaskiert im Feed stehen — der abonnierte Kalender sah dort ein
    Zeilenende und riss den Termin auseinander."""
    u = await _lehrkraft(s, "c@d.de", token="tok-c")
    s.add(CalendarEntry(owner_id=u.id, date=datetime(2026, 9, 3, 12, tzinfo=timezone.utc),
                        title="Konferenz", notes="Zeile1\r\nZeile2\rZeile3\nZeile4"))
    await s.commit()

    body = (await KAL.ics_feed("tok-c", db=s)).body.decode()
    zeilen = body.split("\r\n")
    assert body.count("BEGIN:VEVENT") == 1 and body.count("END:VEVENT") == 1
    beschreibung = [z for z in zeilen if z.startswith("DESCRIPTION:")]
    assert len(beschreibung) == 1
    assert beschreibung[0] == r"DESCRIPTION:Zeile1\nZeile2\nZeile3\nZeile4"
    assert not any("\r" in z for z in zeilen)   # kein loses Wagenrueck-Zeichen mehr


@pytest.mark.asyncio
async def test_eintrag_loeschen_nimmt_die_klassenarbeit_mit(s):
    """Wer den Termin im Kalender loescht, hat die Klassenarbeit geloescht. Frueher
    blieb der ExamDate-Datensatz zurueck: in der Uebersicht stand die Arbeit
    weiter (samt Stundenzaehlung), im Kalender war sie weg."""
    u = await _lehrkraft(s, "e@d.de")
    cls = SchoolClass(name="7a", owner_id=u.id)
    s.add(cls)
    await s.commit()
    d = datetime.now(timezone.utc) + timedelta(days=10)
    ex = await KAL.create_exam(KAL.ExamIn(date=d, title="Terme", class_id=cls.id), user=u, db=s)

    await KAL.delete_entry(ex.entry_id, user=u, db=s)
    assert await s.get(ExamDate, ex.id) is None
    assert await KAL.list_exams(user=u, db=s) == []
    assert await KAL.exam_overview(user=u, db=s) == []


@pytest.mark.asyncio
async def test_import_haengt_nichts_an_fremde_klassen(s):
    """Der Import ordnet Klassen ueber den NAMEN zu. Kontenlose Alt-Klassen sind
    fuer alle sichtbar — ein Import mit passendem Namen haette Eintraege an eine
    Klasse gehaengt, die dem Konto nicht gehoert."""
    u = await _lehrkraft(s, "i@d.de")
    s.add(SchoolClass(name="7a", owner_id=None))   # kontenlose Alt-Klasse
    await s.commit()

    n = await KAL.import_kalender({"type": "nuvora_kalender",
                                   "entries": [{"date": "2026-09-03T12:00:00", "title": "X", "class": "7a"}]},
                                  user=u, db=s)
    assert n["imported"] == 1
    e = (await s.execute(select(CalendarEntry).where(CalendarEntry.owner_id == u.id))).scalar_one()
    assert e.class_id is None        # lieber ohne Klasse als an einer fremden


@pytest.mark.asyncio
async def test_stunden_bis_zur_arbeit_ueber_monatswechsel_und_ferien(s):
    """Zaehlung bis zur Klassenarbeit: wiederkehrende Stunden ueber den
    Monatswechsel, Tage in freien Zeitraeumen fallen raus, und die Gueltigkeit
    (valid_to) schneidet an ihrem Rand sauber ab (letzter gueltiger Tag zaehlt)."""
    u = await _lehrkraft(s, "m@d.de")
    cls = SchoolClass(name="7a", owner_id=u.id)
    s.add(cls)
    await s.commit()

    # Vier Montage am Stueck, ueber einen Monatswechsel hinweg.
    mo = date.today() + timedelta(days=7)
    while mo.weekday() != 0:
        mo += timedelta(days=1)
    while mo.month == (mo + timedelta(days=21)).month:   # Monatswechsel im Fenster erzwingen
        mo += timedelta(days=7)
    ka = datetime.combine(mo + timedelta(days=28), datetime.min.time(), timezone.utc)
    ex = await KAL.create_exam(KAL.ExamIn(date=ka, title="A", class_id=cls.id), user=u, db=s)
    s.add(TimetableSlot(owner_id=u.id, weekday=0, period=1, class_id=cls.id))
    await s.commit()
    voll = (await KAL.exam_overview(user=u, db=s))[0]["stunden"]
    assert voll >= 4       # mindestens die vier Montage davor, Monatswechsel egal

    # Der zweite Montag liegt in den Ferien -> eine Stunde weniger.
    frei = mo + timedelta(days=7)
    b = CalendarBreak(owner_id=u.id, start_date=datetime.combine(frei, datetime.min.time()),
                      end_date=datetime.combine(frei + timedelta(days=4), datetime.min.time()), label="Ferien")
    s.add(b)
    await s.commit()
    assert (await KAL.exam_overview(user=u, db=s))[0]["stunden"] == voll - 1

    # Gueltigkeit endet am dritten Montag: dieser Tag zaehlt noch, der vierte nicht.
    slot = (await s.execute(select(TimetableSlot))).scalar_one()
    slot.valid_to = mo + timedelta(days=14)
    await s.commit()
    assert KAL._slot_active_on(slot, mo + timedelta(days=14))
    assert not KAL._slot_active_on(slot, mo + timedelta(days=15))
    assert (await KAL.exam_overview(user=u, db=s))[0]["stunden"] == voll - 2
    await KAL.delete_exam(ex.id, user=u, db=s)


@pytest.mark.asyncio
async def test_eintrag_mit_fremder_klasse_wird_abgewiesen(s):
    """Ein Eintrag (und eine Klassenarbeit) mit der Klasse eines fremden Kontos
    darf gar nicht erst entstehen."""
    u = await _lehrkraft(s, "f@d.de")
    v = await _lehrkraft(s, "g@d.de")
    fremd = SchoolClass(name="8b", owner_id=v.id)
    fremdkurs = Kurs(name="Fremdkurs", owner_id=v.id)
    s.add_all([fremd, fremdkurs])
    await s.commit()
    d = datetime(2026, 9, 3, 12, tzinfo=timezone.utc)

    with pytest.raises(Exception):
        await KAL.create_entry(KAL.EntryIn(date=d, class_id=fremd.id), user=u, db=s)
    with pytest.raises(Exception):
        await KAL.create_entry(KAL.EntryIn(date=d, kurs_id=fremdkurs.id), user=u, db=s)
    with pytest.raises(Exception):
        await KAL.create_exam(KAL.ExamIn(date=d, title="X", class_id=fremd.id), user=u, db=s)

    # Ohne Klasse ist ein Eintrag dagegen erlaubt (freier Termin).
    e = await KAL.create_entry(KAL.EntryIn(date=d, title="Konferenz"), user=u, db=s)
    assert e.class_id is None
