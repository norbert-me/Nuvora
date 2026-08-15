"""Karteikarten: EINE Sammlung, Stapel werden KURSEN zugewiesen.

Die umgedrehte Zuordnung beruehrt die einzige Stelle, an der es wirklich weh
tut — was ein Kind ueber seinen ausgeteilten QR-Code zu sehen bekommt. Geprueft
wird deshalb beides in dieselbe Richtung: die eigenen Karten muessen ankommen,
die eines fremden Kurses duerfen es nie.

Dazu die einmalige Uebernahme des Bestands (zweimal laufen lassen darf nichts
verdoppeln und nichts wiederbeleben) und die neue G-Vorgabe fuer neue Karten.
"""
import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy import event, select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from app.models import (Base, Card, CardDeck, CardDeckKurs, Kurs, KursTag,
                        SchoolClass, Student, User, UserModule)
from app.routers import karten as K


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


async def _lehrkraft(s, mail="l@d.de"):
    u = User(email=mail, password_hash="x", name="L")
    s.add(u)
    await s.flush()
    s.add(UserModule(user_id=u.id, module_key="karten"))
    await s.commit()
    return u


async def _kurs_mit_klasse(s, u, name, token, niveau_aktiv=False, niveau=""):
    """Ein Kurs, eine Fach-Klasse, ein Kind mit ausgeteiltem Token."""
    k = Kurs(owner_id=u.id, name=name, niveau_aktiv=niveau_aktiv)
    s.add(k)
    await s.flush()
    c = SchoolClass(name=f"{name} Klasse", owner_id=u.id, kurs_id=k.id)
    s.add(c)
    await s.flush()
    s.add(KursTag(kurs_id=k.id, class_id=c.id))
    st = Student(card_id=1, name=f"Kind {name}", class_id=c.id, karten_token=token, niveau=niveau)
    s.add(st)
    await s.commit()
    return k, c, st


async def _sammlungsstapel(s, u, name="Sammlung", kurs_ids=None, karte=True, ausgerollt=True, niveau_aktiv=False):
    deck = await K.create_collection_deck(K.DeckIn(name=name, kurs_ids=kurs_ids, niveau_aktiv=niveau_aktiv), user=u, db=s)
    if karte:
        await K.add_card(deck.id, K.CardIn(front="2+2", back="4"), user=u, db=s)
    if ausgerollt:
        await K.release_deck(deck.id, K.ReleaseIn(now=True), user=u, db=s)
    return deck


# ─── Zuweisung ───

@pytest.mark.asyncio
async def test_zuweisung_setzen_und_ersetzen(s):
    u = await _lehrkraft(s)
    k1, _, _ = await _kurs_mit_klasse(s, u, "Mathe", "t1")
    k2, _, _ = await _kurs_mit_klasse(s, u, "Lernzeit", "t2")

    deck = await _sammlungsstapel(s, u, kurs_ids=[k1.id])
    assert (await K.get_deck_kurse(deck.id, user=u, db=s))["kurs_ids"] == [k1.id]

    # Ersetzen heisst ersetzen: k1 faellt raus, k2 kommt dazu.
    out = await K.set_deck_kurse(deck.id, K.DeckKurseIn(kurs_ids=[k2.id]), user=u, db=s)
    assert out["kurs_ids"] == [k2.id]
    rows = (await s.execute(select(CardDeckKurs.kurs_id).where(CardDeckKurs.deck_id == deck.id))).scalars().all()
    assert sorted(rows) == [k2.id], "keine Karteileiche der alten Zuweisung"

    # Leere Liste ist erlaubt: der Stapel bleibt, ist aber fuer niemanden ausgerollt.
    assert (await K.set_deck_kurse(deck.id, K.DeckKurseIn(kurs_ids=[]), user=u, db=s))["kurs_ids"] == []
    assert await s.get(CardDeck, deck.id) is not None


@pytest.mark.asyncio
async def test_fremder_kurs_wird_abgelehnt(s):
    """Ueber die Zuweisung darf kein Stapel in einen fremden Kurs wandern."""
    u = await _lehrkraft(s)
    v = await _lehrkraft(s, "v@d.de")
    kv, _, _ = await _kurs_mit_klasse(s, v, "Fremd", "tf")
    deck = await _sammlungsstapel(s, u)

    with pytest.raises(HTTPException) as ex:
        await K.set_deck_kurse(deck.id, K.DeckKurseIn(kurs_ids=[kv.id]), user=u, db=s)
    assert ex.value.status_code == 404
    assert (await s.execute(select(CardDeckKurs).where(CardDeckKurs.deck_id == deck.id))).first() is None

    # Auch beim Anlegen, nicht erst hinterher.
    with pytest.raises(HTTPException):
        await K.create_collection_deck(K.DeckIn(name="X", kurs_ids=[kv.id]), user=u, db=s)


@pytest.mark.asyncio
async def test_sammlung_zeigt_alles_und_filtert_nach_kurs(s):
    u = await _lehrkraft(s)
    k1, _, _ = await _kurs_mit_klasse(s, u, "Mathe", "t1")
    k2, _, _ = await _kurs_mit_klasse(s, u, "Lernzeit", "t2")
    a = await _sammlungsstapel(s, u, name="A", kurs_ids=[k1.id])
    b = await _sammlungsstapel(s, u, name="B", kurs_ids=[k2.id])
    c = await _sammlungsstapel(s, u, name="C")   # keinem Kurs zugewiesen

    alle = await K.list_collection(user=u, db=s)
    assert {d.name for d in alle} == {"A", "B", "C"}, "die Sammlung braucht keine Klasse"
    assert [d for d in alle if d.id == c.id][0].kurs_ids == [], "ohne Zuweisung als solche erkennbar"

    nur1 = await K.list_collection(kurs_id=k1.id, user=u, db=s)
    assert [d.name for d in nur1] == ["A"]
    assert [d.name for d in await K.list_collection(kurs_id=k2.id, user=u, db=s)] == ["B"]


# ─── Sichtbarkeit fuer Lernende ───

@pytest.mark.asyncio
async def test_kind_bekommt_die_karten_seines_kurses_und_keine_fremden(s):
    u = await _lehrkraft(s)
    k1, _, kind1 = await _kurs_mit_klasse(s, u, "Mathe", "tok-1")
    k2, _, kind2 = await _kurs_mit_klasse(s, u, "Lernzeit", "tok-2")
    deck = await _sammlungsstapel(s, u, name="Nur Mathe", kurs_ids=[k1.id])
    karte = (await s.execute(select(Card).where(Card.deck_id == deck.id))).scalar_one()

    eigen = await K.student_session("tok-1", db=s)
    assert [c["card_id"] for c in eigen["cards"]] == [karte.id]

    fremd = await K.student_session("tok-2", db=s)
    assert fremd["cards"] == [] and fremd["total"] == 0, "fremder Kurs sieht nichts"
    with pytest.raises(HTTPException) as ex:
        await K.submit_review("tok-2", K.ReviewIn(card_id=karte.id, grade=2), db=s)
    assert ex.value.status_code == 403

    # Auch die Zahlen der Lehrkraft folgen der Zuweisung, nicht der Klasse.
    fort = await K.progress(kind2.class_id, kurs_id=k2.id, user=u, db=s)
    assert [p.total for p in fort] == [0]
    fort1 = await K.progress(kind1.class_id, kurs_id=k1.id, user=u, db=s)
    assert [p.total for p in fort1] == [1]


@pytest.mark.asyncio
async def test_zuweisung_zurueckgenommen_heisst_karten_weg(s):
    """Ein Stapel, den die Lehrkraft aus dem Kurs nimmt, wird nicht mehr
    ausgeteilt — auch nicht ueber die Herkunft."""
    u = await _lehrkraft(s)
    k1, cls1, _ = await _kurs_mit_klasse(s, u, "Mathe", "tok-1")
    deck = await _sammlungsstapel(s, u, kurs_ids=[k1.id])
    assert (await K.student_session("tok-1", db=s))["cards"], "erst da"

    await K.set_deck_kurse(deck.id, K.DeckKurseIn(kurs_ids=[]), user=u, db=s)
    assert (await K.student_session("tok-1", db=s))["cards"] == [], "nach dem Entfernen still"


@pytest.mark.asyncio
async def test_mehrere_kurse_bekommen_denselben_stapel(s):
    u = await _lehrkraft(s)
    k1, _, _ = await _kurs_mit_klasse(s, u, "Mathe", "tok-1")
    k2, _, _ = await _kurs_mit_klasse(s, u, "Lernzeit", "tok-2")
    await _sammlungsstapel(s, u, kurs_ids=[k1.id, k2.id])
    assert len((await K.student_session("tok-1", db=s))["cards"]) == 1
    assert len((await K.student_session("tok-2", db=s))["cards"]) == 1


# ─── Einmalige Uebernahme des Bestands ───

@pytest.mark.asyncio
async def test_uebernahme_laeuft_genau_einmal(s):
    u = await _lehrkraft(s)
    k1, cls1, kind = await _kurs_mit_klasse(s, u, "Mathe", "tok-1")
    # Bestand: einmal mit Herkunfts-Kurs, einmal nur mit Klasse.
    mit_kurs = CardDeck(owner_id=u.id, class_id=cls1.id, kurs_id=k1.id, name="Alt A")
    nur_klasse = CardDeck(owner_id=u.id, class_id=cls1.id, kurs_id=None, name="Alt B")
    s.add_all([mit_kurs, nur_klasse])
    await s.commit()

    assert await K.uebernahme_deck_kurse(s) == 2
    zu = await K._kurse_je_deck(s, [mit_kurs.id, nur_klasse.id])
    assert zu[mit_kurs.id] == [k1.id], "bevorzugt aus kurs_id"
    assert zu[nur_klasse.id] == [k1.id], "ersatzweise aus dem Kurs der Klasse"

    # Zweiter Lauf: nichts mehr zu tun, nichts doppelt.
    assert await K.uebernahme_deck_kurse(s) == 0
    rows = (await s.execute(select(CardDeckKurs))).scalars().all()
    assert len(rows) == 2

    # Und eine von Hand entfernte Zuweisung bleibt entfernt.
    await K.set_deck_kurse(mit_kurs.id, K.DeckKurseIn(kurs_ids=[]), user=u, db=s)
    assert await K.uebernahme_deck_kurse(s) == 0
    assert (await K._kurse_je_deck(s, [mit_kurs.id])).get(mit_kurs.id) is None

    # Die Herkunft bleibt stehen — sie ist die Spur, aus der gerechnet wurde.
    frisch = await s.get(CardDeck, nur_klasse.id)
    assert frisch.class_id == cls1.id


@pytest.mark.asyncio
async def test_bestand_bleibt_bis_zur_uebernahme_sichtbar(s):
    """Vor der Uebernahme gilt weiter die Herkunft: kein Kind steht ploetzlich
    ohne Karten da, nur weil der Umbau noch nicht durchgelaufen ist."""
    u = await _lehrkraft(s)
    k1, cls1, _ = await _kurs_mit_klasse(s, u, "Mathe", "tok-1")
    deck = CardDeck(owner_id=u.id, class_id=cls1.id, kurs_id=k1.id, name="Alt")
    s.add(deck)
    await s.flush()
    s.add(Card(deck_id=deck.id, front="a", back="b", position=0))
    await s.commit()
    await K.release_deck(deck.id, K.ReleaseIn(now=True), user=u, db=s)

    assert len((await K.student_session("tok-1", db=s))["cards"]) == 1
    await K.uebernahme_deck_kurse(s)
    assert len((await K.student_session("tok-1", db=s))["cards"]) == 1, "nach der Uebernahme genauso"


# ─── E/G: neue Karten sind G, sobald der Kurs mit Niveaus arbeitet ───

@pytest.mark.asyncio
async def test_neue_karte_ist_g_bei_aktivem_niveau(s):
    u = await _lehrkraft(s)
    k, _, _ = await _kurs_mit_klasse(s, u, "Mathe", "tok-1")
    deck = await _sammlungsstapel(s, u, kurs_ids=[k.id], karte=False, ausgerollt=False, niveau_aktiv=True)

    neu = await K.add_card(deck.id, K.CardIn(front="a", back="b"), user=u, db=s)
    assert neu.niveau == "G", "Karteikarten sind G, solange nicht anders gesagt"

    # Ausdrueckliches E bleibt E.
    e = await K.add_card(deck.id, K.CardIn(front="c", back="d", niveau="E"), user=u, db=s)
    assert e.niveau == "E"

    # Import folgt derselben Vorgabe.
    await K.import_cards(deck.id, K.ImportIn(cards=[K.CardIn(front="x", back="y")]), user=u, db=s)
    letzte = (await s.execute(select(Card).where(Card.deck_id == deck.id).order_by(Card.position))).scalars().all()[-1]
    assert letzte.niveau == "G"


@pytest.mark.asyncio
async def test_ohne_aktives_niveau_bleibt_die_karte_neutral(s):
    u = await _lehrkraft(s)
    k, _, _ = await _kurs_mit_klasse(s, u, "Mathe", "tok-1")
    deck = await _sammlungsstapel(s, u, kurs_ids=[k.id], karte=False, ausgerollt=False)
    neu = await K.add_card(deck.id, K.CardIn(front="a", back="b"), user=u, db=s)
    assert neu.niveau == "", "ohne eingeschaltete Differenzierung aendert sich nichts"


@pytest.mark.asyncio
async def test_ausgeschaltete_differenzierung_zeigt_allen_alles(s):
    """Der Schalter am Stapel entscheidet, ob `cards.niveau` ueberhaupt zaehlt.

    Aus heisst aus: eine Karte, die irgendwann einmal auf G stand, darf ein
    E-Kind nicht heimlich verlieren, nur weil sie den Buchstaben noch traegt."""
    u = await _lehrkraft(s)
    k, cls, kind = await _kurs_mit_klasse(s, u, "Mathe", "tok-1", niveau="E")
    deck = await _sammlungsstapel(s, u, kurs_ids=[k.id], karte=False, ausgerollt=False)
    g = Card(deck_id=deck.id, front="G-Karte", back="x", position=0, niveau="G")
    s.add(g)
    await s.commit()
    await K.release_deck(deck.id, K.ReleaseIn(now=True), user=u, db=s)

    assert [c["card_id"] for c in (await K.student_session("tok-1", db=s))["cards"]] == [g.id]
    assert (await K.progress(cls.id, kurs_id=k.id, user=u, db=s))[0].total == 1

    # Eingeschaltet greift die Regel — dieselbe Karte, dasselbe Kind.
    await K.update_deck(deck.id, K.DeckIn(name=deck.name, niveau_aktiv=True), user=u, db=s)
    assert (await K.student_session("tok-1", db=s))["cards"] == []
    assert (await K.progress(cls.id, kurs_id=k.id, user=u, db=s))[0].total == 0


@pytest.mark.asyncio
async def test_bestandskarten_bleiben_neutral(s):
    """Wer heute neutral ist, bleibt neutral — sonst verschwinden Karten
    schlagartig aus der Sicht der Kinder."""
    u = await _lehrkraft(s)
    k, _, kind = await _kurs_mit_klasse(s, u, "Mathe", "tok-1", niveau="E")
    deck = await _sammlungsstapel(s, u, kurs_ids=[k.id], karte=False, ausgerollt=False, niveau_aktiv=True)
    alt = Card(deck_id=deck.id, front="alt", back="alt", position=0, niveau="")
    s.add(alt)
    await s.commit()
    await K.release_deck(deck.id, K.ReleaseIn(now=True), user=u, db=s)

    # Das E-Kind sieht die neutrale Bestandskarte weiterhin …
    assert [c["card_id"] for c in (await K.student_session("tok-1", db=s))["cards"]] == [alt.id]

    # … und ein Bearbeiten macht sie nicht heimlich zu G.
    await K.update_card(alt.id, K.CardIn(front="alt2", back="alt", niveau=""), user=u, db=s)
    assert (await s.get(Card, alt.id)).niveau == ""

    # Die neu angelegte G-Karte bekommt das E-Kind dagegen NICHT zu sehen —
    # das ist die gewollte Folge der Vorgabe, keine Panne.
    g = await K.add_card(deck.id, K.CardIn(front="neu", back="neu"), user=u, db=s)
    assert g.niveau == "G"
    assert [c["card_id"] for c in (await K.student_session("tok-1", db=s))["cards"]] == [alt.id]


# ─── Die Stunde weist zu (statt der Hand) ───

@pytest.mark.asyncio
async def test_die_stunde_erzeugt_die_zuweisung(s):
    """Wer einen Stapel in eine Stunde plant, weist ihn damit dem Kurs zu.

    Das ist seit der Entscheidung des Nutzers der EINE Weg: von Hand zugewiesen
    wird in der Oberfläche nicht mehr. Die API dahinter bleibt — hier wird der
    Weg über den Kalender nachgerechnet.
    """
    from datetime import datetime, timezone
    from app.models import CalendarEntry, Topic
    from app.routers import kalender as KAL

    u = await _lehrkraft(s)
    s.add(UserModule(user_id=u.id, module_key="kalender"))
    k, cls, kind = await _kurs_mit_klasse(s, u, "Mathe", "tok-1")
    thema = Topic(name="Brüche", owner_id=u.id)
    s.add(thema)
    await s.flush()

    deck = await _sammlungsstapel(s, u, name="Zur Stunde", karte=True, ausgerollt=False)
    # Noch keiner Stunde zugeordnet — also bei niemandem.
    assert (await K._kurse_je_deck(s, [deck.id])).get(deck.id) is None
    assert (await K.student_session("tok-1", db=s))["cards"] == []

    # „In eine Stunde planen" ist genau das: der Eintrag zeigt auf den Stapel.
    e = CalendarEntry(owner_id=u.id, date=datetime.now(timezone.utc), class_id=cls.id,
                      topic_id=thema.id, karten_deck_id=deck.id)
    s.add(e)
    await s.commit()
    await KAL._release_matching_decks(s, u, e)

    assert (await K._kurse_je_deck(s, [deck.id])).get(deck.id) == [k.id], "die Stunde hat zugewiesen"
    assert len((await K.student_session("tok-1", db=s))["cards"]) == 1, "und das Kind bekommt die Karte"


@pytest.mark.asyncio
async def test_stunde_nimmt_bestehende_zuweisung_nicht_weg(s):
    """Ein Stapel kann in mehreren Stunden liegen — die zweite Planung darf die
    erste nicht überschreiben."""
    from datetime import datetime, timezone
    from app.models import CalendarEntry
    from app.routers import kalender as KAL

    u = await _lehrkraft(s)
    s.add(UserModule(user_id=u.id, module_key="kalender"))
    k1, cls1, _ = await _kurs_mit_klasse(s, u, "Mathe", "tok-1")
    k2, cls2, _ = await _kurs_mit_klasse(s, u, "Lernzeit", "tok-2")
    deck = await _sammlungsstapel(s, u, kurs_ids=[k1.id], ausgerollt=False)

    e = CalendarEntry(owner_id=u.id, date=datetime.now(timezone.utc), class_id=cls2.id, karten_deck_id=deck.id)
    s.add(e)
    await s.commit()
    await KAL._release_matching_decks(s, u, e)

    assert (await K._kurse_je_deck(s, [deck.id])).get(deck.id) == sorted([k1.id, k2.id])
    assert len((await K.student_session("tok-1", db=s))["cards"]) == 1
    assert len((await K.student_session("tok-2", db=s))["cards"]) == 1
