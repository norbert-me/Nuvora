"""Modul Karten — der Weg, den ein Kind OHNE Konto geht (/lernen/<token>).

Deckt die Stellen ab, an denen der Token-Weg und die Lehrkraft-Ansicht
auseinanderliefen: was ausgeteilt wird, muss auch beantwortet werden koennen,
und was geloescht ist, darf weder gezaehlt noch ausgeliefert werden.
"""
import pytest
import pytest_asyncio
from datetime import datetime, timedelta, timezone
from sqlalchemy import event, select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from app.models import (Base, Card, CardDeck, CardReview, Kurs, KursTag, SchoolClass,
                        Student, User, UserModule)
from app.routers import karten as K
from fastapi import HTTPException


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


def _jetzt():
    return datetime.now(timezone.utc)


def _naiv(dt):
    """SQLite liefert Zeitstempel ohne Zeitzone zurueck — fuer Vergleiche angleichen."""
    return dt.replace(tzinfo=None) if dt.tzinfo else dt


async def _lehrkraft(s, mail="l@d.de"):
    u = User(email=mail, password_hash="x", name="L")
    s.add(u)
    await s.flush()
    s.add(UserModule(user_id=u.id, module_key="karten"))
    return u


async def _kurs_mit_zwei_fachklassen(s, u):
    """Ein Kurs, zwei Fach-Klassen — dieselbe Person steckt in beiden."""
    k = Kurs(owner_id=u.id, name="Mathe 7")
    s.add(k)
    await s.flush()
    a = SchoolClass(name="Mathe 7a", owner_id=u.id, kurs_id=k.id)
    b = SchoolClass(name="Lernzeit 7a", owner_id=u.id, kurs_id=k.id)
    s.add_all([a, b])
    await s.flush()
    s.add_all([KursTag(kurs_id=k.id, class_id=a.id), KursTag(kurs_id=k.id, class_id=b.id)])
    ma = Student(card_id=1, name="Max", class_id=a.id, karten_token="tok-a")
    mb = Student(card_id=1, name="Max", class_id=b.id, karten_token="tok-b")
    s.add_all([ma, mb])
    await s.commit()
    return k, a, b, ma, mb


async def _deck_mit_karte(s, u, cls, kurs=None, name="D", released=True):
    deck = CardDeck(owner_id=u.id, class_id=cls.id, kurs_id=(kurs.id if kurs else None), name=name,
                    released_at=_jetzt() - timedelta(hours=1) if released else None)
    s.add(deck)
    await s.flush()
    c = Card(deck_id=deck.id, front="2+2", back="4", position=0)
    s.add(c)
    await s.commit()
    return deck, c


@pytest.mark.asyncio
async def test_kurs_karte_kann_auch_beantwortet_werden(s):
    """Ein Stapel am KURS wird dem Kind der Geschwister-Fachklasse ausgeteilt —
    dann muss es ihn auch beantworten koennen.

    Bug: submit_review verglich nur deck.class_id == student.class_id. Das Kind
    sah die Karte, jede Antwort kam als 403 zurueck — auf dem Handy hing die
    Sitzung, ohne dass jemand den Grund sehen konnte."""
    u = await _lehrkraft(s)
    kurs, a, b, ma, mb = await _kurs_mit_zwei_fachklassen(s, u)
    deck, karte = await _deck_mit_karte(s, u, a, kurs)      # haengt an Klasse A + Kurs

    # Kind aus der Geschwister-Klasse B bekommt die Karte ausgeteilt …
    sess = await K.student_session("tok-b", db=s)
    assert [c["card_id"] for c in sess["cards"]] == [karte.id]

    # … und kann sie auch beantworten.
    out = await K.submit_review("tok-b", K.ReviewIn(card_id=karte.id, grade=2), db=s)
    assert out["ok"] is True
    rev = (await s.execute(select(CardReview).where(CardReview.student_id == mb.id))).scalar_one()
    assert rev.reps == 1


@pytest.mark.asyncio
async def test_fremdes_kind_kommt_nicht_an_die_karte(s):
    """Der Token eines Kindes aus einer fremden Klasse (anderes Konto) darf die
    Karte weder sehen noch beantworten."""
    u = await _lehrkraft(s)
    kurs, a, b, ma, mb = await _kurs_mit_zwei_fachklassen(s, u)
    deck, karte = await _deck_mit_karte(s, u, a, kurs)

    v = await _lehrkraft(s, "v@d.de")
    fremd = SchoolClass(name="8b", owner_id=v.id)
    s.add(fremd)
    await s.flush()
    s.add(Student(card_id=1, name="Ida", class_id=fremd.id, karten_token="tok-fremd"))
    await s.commit()

    assert (await K.student_session("tok-fremd", db=s))["cards"] == []
    with pytest.raises(HTTPException) as ex:
        await K.submit_review("tok-fremd", K.ReviewIn(card_id=karte.id, grade=2), db=s)
    assert ex.value.status_code == 403
    with pytest.raises(HTTPException):
        await K.student_card_image("tok-fremd", karte.id, "front", db=s)


@pytest.mark.asyncio
async def test_geloeschte_karte_mitten_im_lernen(s):
    """Loescht die Lehrkraft eine Karte, waehrend ein Kind sie gerade offen hat:
    kein Fehler auf dem Kindergeraet, aber auch kein Fortschritt auf etwas, das
    es nicht mehr gibt. Dasselbe, wenn der Stapel zurueckgezogen wird."""
    u = await _lehrkraft(s)
    kurs, a, b, ma, mb = await _kurs_mit_zwei_fachklassen(s, u)
    deck, karte = await _deck_mit_karte(s, u, a, kurs)

    karte.deleted_at = _jetzt()
    await s.commit()
    out = await K.submit_review("tok-a", K.ReviewIn(card_id=karte.id, grade=2), db=s)
    assert out.get("ignoriert") is True
    assert (await s.execute(select(CardReview))).scalars().all() == []
    # Auch das Bild einer geloeschten Karte wird nicht mehr ausgeliefert.
    with pytest.raises(HTTPException):
        await K.student_card_image("tok-a", karte.id, "front", db=s)

    # Freigabe zurueckgezogen -> ebenfalls still verworfen.
    karte.deleted_at = None
    deck.released_at = None
    await s.commit()
    assert (await K.submit_review("tok-a", K.ReviewIn(card_id=karte.id, grade=2), db=s)).get("ignoriert") is True


@pytest.mark.asyncio
async def test_intervall_waechst_nicht_ins_unendliche(s):
    """40-mal „leicht" (mit all=True kann ein Kind eine Karte beliebig oft ueben):
    frueher explodierte das Intervall (ease ohne Deckel, Intervall mal ease) bis
    datetime ueberlief — 500er, und die Karte war nie wieder faellig."""
    u = await _lehrkraft(s)
    kurs, a, b, ma, mb = await _kurs_mit_zwei_fachklassen(s, u)
    deck, karte = await _deck_mit_karte(s, u, a, kurs)

    for _ in range(40):
        await K.submit_review("tok-a", K.ReviewIn(card_id=karte.id, grade=3), db=s)
    rev = (await s.execute(select(CardReview).where(CardReview.student_id == ma.id))).scalar_one()
    assert rev.interval_days <= K.INTERVAL_MAX_DAYS
    assert rev.ease <= K.EASE_MAX
    # SQLite gibt die Zeit ohne Zeitzone zurueck — fuer den Vergleich angleichen.
    assert _naiv(rev.due) < datetime.utcnow() + timedelta(days=K.INTERVAL_MAX_DAYS + 1)

    # Ein „nochmal" setzt danach sauber zurueck (10 Minuten, kein Ueberlauf).
    await K.submit_review("tok-a", K.ReviewIn(card_id=karte.id, grade=0), db=s)
    await s.refresh(rev)
    assert rev.reps == 0 and rev.interval_days == 0 and _naiv(rev.due) < datetime.utcnow() + timedelta(hours=1)
    assert rev.ease >= K.EASE_MIN


@pytest.mark.asyncio
async def test_fortschritt_zaehlt_geloeschte_karten_nicht(s):
    """Die Lehrkraft-Uebersicht muss dieselben Karten zaehlen, die das Kind sieht.
    Bug: progress() nahm geloeschte Karten mit — sie wurden nie gelernt, galten
    also fuer immer als „faellig"."""
    u = await _lehrkraft(s)
    kurs, a, b, ma, mb = await _kurs_mit_zwei_fachklassen(s, u)
    deck, karte = await _deck_mit_karte(s, u, a, kurs)
    weg = Card(deck_id=deck.id, front="alt", back="alt", position=1, deleted_at=_jetzt())
    s.add(weg)
    await s.commit()

    p = (await K.progress(a.id, kurs_id=kurs.id, user=u, db=s))[0]
    assert p.total == 1 and p.due == 1
    detail = await K.student_cards(a.id, ma.id, kurs_id=kurs.id, user=u, db=s)
    assert [c.card_id for c in detail] == [karte.id]


@pytest.mark.asyncio
async def test_fremder_kurs_gibt_keine_kartentexte_preis(s):
    """kurs_id kommt aus der URL: mit dem Kurs eines FREMDEN Kontos durfte man
    frueher Stapelnamen und Kartentexte auslesen (progress/student_cards hatten
    keinen Eigentuemer-Filter)."""
    u = await _lehrkraft(s)
    kurs, a, b, ma, mb = await _kurs_mit_zwei_fachklassen(s, u)

    v = await _lehrkraft(s, "v2@d.de")
    vkurs = Kurs(owner_id=v.id, name="Geheim")
    s.add(vkurs)
    await s.flush()
    vcls = SchoolClass(name="8b", owner_id=v.id, kurs_id=vkurs.id)
    s.add(vcls)
    await s.flush()
    s.add(KursTag(kurs_id=vkurs.id, class_id=vcls.id))
    await s.commit()
    await _deck_mit_karte(s, v, vcls, vkurs, name="Klassenarbeit Loesungen")

    with pytest.raises(HTTPException) as ex:
        await K.progress(a.id, kurs_id=vkurs.id, user=u, db=s)
    assert ex.value.status_code == 404
    with pytest.raises(HTTPException):
        await K.student_cards(a.id, ma.id, kurs_id=vkurs.id, user=u, db=s)


@pytest.mark.asyncio
async def test_klasse_im_papierkorb_sperrt_den_link(s):
    """Klasse geloescht (Papierkorb) = ausgeteilte Lern-Links ruhen. Sonst haetten
    Kinder und jeder, der einen Link weiterbekommen hat, weiter Einblick in
    Lernstand und Testergebnisse. Wiederherstellen macht sie wieder gueltig."""
    u = await _lehrkraft(s)
    kurs, a, b, ma, mb = await _kurs_mit_zwei_fachklassen(s, u)
    await _deck_mit_karte(s, u, a, kurs)

    a.deleted_at = _jetzt()
    await s.commit()
    with pytest.raises(HTTPException) as ex:
        await K.student_session("tok-a", db=s)
    assert ex.value.status_code == 401

    a.deleted_at = None
    await s.commit()
    assert (await K.student_session("tok-a", db=s))["cards"]


@pytest.mark.asyncio
async def test_geplanter_stapel_bleibt_bis_zum_termin_unsichtbar(s):
    """released_at in der Zukunft: das Kind sieht den Stapel nicht, bekommt aber
    gesagt, wann es wieder lernen kann — und kann ihn auch nicht „vorab"
    beantworten."""
    u = await _lehrkraft(s)
    kurs, a, b, ma, mb = await _kurs_mit_zwei_fachklassen(s, u)
    deck, karte = await _deck_mit_karte(s, u, a, kurs, released=False)
    morgen = _jetzt() + timedelta(days=1)
    deck.released_at = morgen
    await s.commit()

    sess = await K.student_session("tok-a", db=s)
    assert sess["cards"] == [] and sess["total"] == 0
    assert sess["next_due"] is not None            # „ab morgen"
    assert (await K.submit_review("tok-a", K.ReviewIn(card_id=karte.id, grade=2), db=s)).get("ignoriert") is True


@pytest.mark.asyncio
async def test_antwort_auf_freigegebenen_stapel_ohne_zeitzone(s):
    """Ein freigegebener Stapel darf beantwortet werden — auch ohne Zeitzone.

    Postgres liefert TIMESTAMPTZ mit Zeitzone zurück, SQLite ohne. Der Vergleich
    mit der aktuellen Zeit warf deshalb "can't compare offset-naive and
    offset-aware datetimes" — HTTP 500 auf dem Gerät des Kindes, mitten in der
    Lernsitzung. Der Selbsttest hat es gefunden, die Testsuite nicht: die
    bisherigen Fälle gingen nie über einen Stapel mit gesetztem released_at.
    """
    u = await _lehrkraft(s)
    kurs, a, _b, ma, _mb = await _kurs_mit_zwei_fachklassen(s, u)
    deck, karte = await _deck_mit_karte(s, u, a, kurs)
    # Freigabe OHNE Zeitzone, wie SQLite sie zurückgibt.
    deck.released_at = datetime.utcnow() - timedelta(days=1)
    await s.commit()
    toks = await K.ensure_tokens(a.id, user=u, db=s)
    token = next(t.token for t in toks if t.student_id == ma.id)

    antwort = await K.submit_review(token, K.ReviewIn(card_id=karte.id, grade=3), db=s)
    assert antwort.get("ok") and not antwort.get("ignoriert"), "die Antwort muss zählen"


@pytest.mark.asyncio
async def test_uebersicht_haelt_gelernte_karten_ohne_zeitzone_aus(s):
    """Nachdem ein Kind gelernt hat, muss die Lehrkraft den Stand sehen.

    Derselbe Zeitzonen-Bruch wie eine Zeile hoeher, nur auf der anderen Seite:
    progress() und student_cards() verglichen `rev.due` und `rev.last_reviewed`
    ungefiltert mit der aktuellen Zeit. Solange niemand gelernt hatte, gab es
    keine Review-Zeile und nichts zu vergleichen — der Fehler schlug erst zu,
    wenn die Uebersicht endlich etwas anzuzeigen hatte. Gefunden hat ihn der
    Systemtest, weil er erst lernt und dann nachsieht.
    """
    u = await _lehrkraft(s)
    kurs, a, _b, ma, _mb = await _kurs_mit_zwei_fachklassen(s, u)
    deck, karte = await _deck_mit_karte(s, u, a, kurs)
    deck.released_at = datetime.utcnow() - timedelta(days=1)
    await s.commit()
    toks = await K.ensure_tokens(a.id, user=u, db=s)
    token = next(t.token for t in toks if t.student_id == ma.id)
    await K.submit_review(token, K.ReviewIn(card_id=karte.id, grade=3), db=s)

    p = (await K.progress(a.id, kurs_id=kurs.id, user=u, db=s))[0]
    assert p.total == 1 and p.reviewed == 1, "die gelernte Karte muss gezaehlt werden"
    assert p.due == 0, "sie ist gerade beantwortet, also nicht faellig"
    assert p.last_reviewed is not None, "der Zeitpunkt gehoert in die Uebersicht"

    detail = await K.student_cards(a.id, ma.id, kurs_id=kurs.id, user=u, db=s)
    assert [c.card_id for c in detail] == [karte.id]

    # Und der Lernweg des Kindes selbst: naechster Termin statt Absturz.
    stand = await K.student_session(token, db=s)
    assert stand["due"] == 0, "gerade beantwortet, also nichts mehr offen"
    assert stand["learned"] == 1 and stand["total"] == 1
    assert stand["next_due"] is not None, "der naechste Termin gehoert dazu"
