"""Eine Schulklasse ist 30 Geraete im selben Moment.

Alle anderen Tests fahren eine Anfrage nach der anderen — und genau darum sind
die Fehler, um die es hier geht, nie aufgefallen: Endpunkte auf den
Schueler-Wegen lesen erst, ob eine Zeile existiert, und legen sonst eine an.
Zwei gleichzeitige Anfragen finden beide nichts und legen beide an (doppelte
Zeile, verlorene Aktualisierung, 500er).

Dieser Test erzeugt echte Gleichzeitigkeit: eine gemeinsame Datenbank auf der
Platte, je Aufgabe eine eigene Sitzung, alles zusammen in `asyncio.gather`.
Eine In-Memory-SQLite taugt dafuer nicht — jede Verbindung bekaeme ihre eigene,
leere Datenbank.

Geprueft werden Invarianten, keine Ablaeufe: genau eine Zeile, Zaehler stimmt,
kein 500er.
"""
import asyncio
import os
import tempfile
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from sqlalchemy import event, func, select
from sqlalchemy.pool import NullPool
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.models import (Base, Card, CardDeck, CardReview, CodeSession, Kurs, KursTag, Question,
                        SchoolClass, Scan, Session, Student, User, UserModule)
from app.routers import codedetektiv as CD
from app.routers import karten as K
from app.routers import results as R


# ─── gemeinsame Datenbank auf der Platte ───

@pytest_asyncio.fixture
async def db_fabrik():
    """Eine Datei-Datenbank, die sich mehrere Sitzungen gleichzeitig teilen.

    WAL + Wartezeit, damit gleichzeitige Schreiber sich nicht sofort gegenseitig
    mit „database is locked" abwuergen — das ist die SQLite-Entsprechung dessen,
    was Postgres mit Zeilensperren macht.
    """
    pfad = os.path.join(tempfile.mkdtemp(prefix="nuvora-gleichzeitig-"), "test.db")
    # NullPool: jede Sitzung bekommt ihre EIGENE Verbindung. Mit dem Standard-Pool
    # teilen sich die Aufgaben wenige Verbindungen — dann laeuft vieles doch wieder
    # nacheinander und der Test uebersieht genau das, wofuer es ihn gibt.
    e = create_async_engine(f"sqlite+aiosqlite:///{pfad}", poolclass=NullPool,
                            connect_args={"timeout": 30})

    @event.listens_for(e.sync_engine, "connect")
    def _pragmas(c, _):
        c.execute("PRAGMA foreign_keys=ON")
        c.execute("PRAGMA journal_mode=WAL")
        c.execute("PRAGMA busy_timeout=30000")

    async with e.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    fabrik = async_sessionmaker(e, class_=AsyncSession, expire_on_commit=False)
    yield fabrik
    await e.dispose()


async def _parallel(fabrik, n, arbeit):
    """`arbeit(i, db)` n-mal gleichzeitig, jede mit eigener Sitzung.

    Liefert die Ergebnisse bzw. die Ausnahmen zurueck — der Test entscheidet,
    was davon erlaubt ist (eine 400er-Absage ist Fachlogik, ein 500er nie).
    """
    async def einer(i):
        async with fabrik() as db:
            return await arbeit(i, db)

    return await asyncio.gather(*(einer(i) for i in range(n)), return_exceptions=True)


def _harte_fehler(ergebnisse):
    """Alles, was keine saubere HTTP-Absage ist — also echte Abstuerze."""
    from fastapi import HTTPException
    return [r for r in ergebnisse
            if isinstance(r, BaseException) and not isinstance(r, HTTPException)]


class _Req:
    """Minimaler Request-Ersatz fuer die Drosselung (feste IP = eine Klasse hinter NAT)."""
    client = type("C", (), {"host": "10.0.0.1"})()
    headers: dict = {}


@pytest.fixture(autouse=True)
def _drossel_zuruecksetzen():
    """Die Drosselung ist Prozess-Zustand — sonst faerbt ein Test den naechsten."""
    from app.routers.auth import _buckets
    _buckets.clear()
    yield
    _buckets.clear()


# ─── Karten: zwei Antworten desselben Kindes im selben Moment ───

async def _karten_aufbau(fabrik):
    async with fabrik() as db:
        u = User(email="k@d.de", password_hash="x", name="L")
        db.add(u)
        await db.flush()
        db.add(UserModule(user_id=u.id, module_key="karten"))
        k = Kurs(owner_id=u.id, name="Mathe 7")
        db.add(k)
        await db.flush()
        cls = SchoolClass(name="Mathe 7a", owner_id=u.id, kurs_id=k.id)
        db.add(cls)
        await db.flush()
        db.add(KursTag(kurs_id=k.id, class_id=cls.id))
        st = Student(card_id=1, name="Max", class_id=cls.id, karten_token="tok-max")
        deck = CardDeck(owner_id=u.id, class_id=cls.id, kurs_id=k.id, name="D",
                        released_at=datetime.now(timezone.utc) - timedelta(hours=1))
        db.add_all([st, deck])
        await db.flush()
        karte = Card(deck_id=deck.id, front="2+2", back="4", position=0)
        db.add(karte)
        await db.commit()
        return st.id, karte.id


@pytest.mark.asyncio
async def test_karten_review_gleichzeitig_nur_eine_zeile(db_fabrik):
    """Ein Kind tippt zweimal schnell (oder das Netz wiederholt den Zug).

    Beide Anfragen finden keine CardReview-Zeile und legen eine an — die zweite
    lief frueher in die Eindeutigkeitsbedingung uq_review_student_card und kam
    als 500er auf dem Kindergeraet an.
    """
    student_id, card_id = await _karten_aufbau(db_fabrik)

    async def zug(i, db):
        return await K.submit_review("tok-max", K.ReviewIn(card_id=card_id, grade=2), db=db)

    ergebnisse = await _parallel(db_fabrik, 8, zug)
    assert not _harte_fehler(ergebnisse), _harte_fehler(ergebnisse)

    async with db_fabrik() as db:
        anzahl = (await db.execute(select(func.count()).select_from(CardReview).where(
            CardReview.student_id == student_id, CardReview.card_id == card_id))).scalar_one()
    assert anzahl == 1, f"{anzahl} CardReview-Zeilen statt einer"


@pytest.mark.asyncio
async def test_karten_review_ganze_klasse_gleichzeitig(db_fabrik):
    """30 Kinder, jedes auf seiner Karte — je Kind genau eine Zeile, kein 500er
    und keine Absage durch die Drosselung (die zaehlt je Token, nicht je IP)."""
    async with db_fabrik() as db:
        u = User(email="klasse@d.de", password_hash="x", name="L")
        db.add(u)
        await db.flush()
        db.add(UserModule(user_id=u.id, module_key="karten"))
        k = Kurs(owner_id=u.id, name="Mathe 7")
        db.add(k)
        await db.flush()
        cls = SchoolClass(name="Mathe 7a", owner_id=u.id, kurs_id=k.id)
        db.add(cls)
        await db.flush()
        db.add(KursTag(kurs_id=k.id, class_id=cls.id))
        deck = CardDeck(owner_id=u.id, class_id=cls.id, kurs_id=k.id, name="D",
                        released_at=datetime.now(timezone.utc) - timedelta(hours=1))
        db.add(deck)
        await db.flush()
        karte = Card(deck_id=deck.id, front="2+2", back="4", position=0)
        db.add(karte)
        for i in range(30):
            db.add(Student(card_id=i + 1, name=f"Kind {i}", class_id=cls.id, karten_token=f"tok-{i}"))
        await db.commit()
        card_id = karte.id

    async def zug(i, db):
        return await K.submit_review(f"tok-{i}", K.ReviewIn(card_id=card_id, grade=2), db=db)

    ergebnisse = await _parallel(db_fabrik, 30, zug)
    assert not _harte_fehler(ergebnisse), _harte_fehler(ergebnisse)
    absagen = [r for r in ergebnisse if isinstance(r, BaseException)]
    assert not absagen, f"Absagen fuer eine ganze Klasse: {absagen}"

    async with db_fabrik() as db:
        anzahl = (await db.execute(select(func.count()).select_from(CardReview))).scalar_one()
    assert anzahl == 30


# ─── Code-Detektiv: 30 Kinder treten im selben Moment bei ───

async def _cd_aufbau(db_fabrik, raetsel=None):
    async with db_fabrik() as db:
        u = User(email="cd@d.de", password_hash="x", name="L")
        db.add(u)
        await db.flush()
        db.add(UserModule(user_id=u.id, module_key="code-detektiv"))
        await db.commit()
        out = await CD.create_session(
            CD.SessionCreate(puzzles=raetsel or [{"id": "p1"}, {"id": "p2"}]), user=u, db=db)
        return u.id, out["code"]


@pytest.mark.asyncio
async def test_cd_beitritt_ganze_klasse(db_fabrik):
    """30 verschiedene Namen gleichzeitig — die players-Liste ist EIN JSON-Feld
    einer Zeile. Ohne Sperre ueberschreibt der letzte Schreiber alle anderen:
    von 30 Kindern bleiben zwei uebrig."""
    _, code = await _cd_aufbau(db_fabrik)

    async def beitritt(i, db):
        return await CD.join_session(code, CD.JoinIn(name=f"Kind {i:02d}"), request=_Req(), db=db)

    ergebnisse = await _parallel(db_fabrik, 30, beitritt)
    assert not _harte_fehler(ergebnisse), _harte_fehler(ergebnisse)
    absagen = [r for r in ergebnisse if isinstance(r, BaseException)]
    assert not absagen, f"Absagen beim Beitritt einer Klasse: {absagen}"

    async with db_fabrik() as db:
        s = (await db.execute(select(CodeSession).where(CodeSession.code == code))).scalar_one()
        namen = sorted(p["name"] for p in (s.players or []))
    assert len(namen) == 30, f"nur {len(namen)} von 30 Kindern in der Sitzung: {namen}"


@pytest.mark.asyncio
async def test_cd_beitritt_zweiter_klick_keine_zweite_person(db_fabrik):
    """„Zweiter Klick, keine zweite Person" — auch wenn beide Klicks im selben
    Moment ankommen (Doppeltipp, Wiederholung durch das Netz)."""
    _, code = await _cd_aufbau(db_fabrik)

    async def beitritt(i, db):
        return await CD.join_session(code, CD.JoinIn(name="Max"), request=_Req(), db=db)

    ergebnisse = await _parallel(db_fabrik, 10, beitritt)
    assert not _harte_fehler(ergebnisse), _harte_fehler(ergebnisse)

    async with db_fabrik() as db:
        s = (await db.execute(select(CodeSession).where(CodeSession.code == code))).scalar_one()
    assert [p["name"] for p in (s.players or [])] == ["Max"]


@pytest.mark.asyncio
async def test_cd_ergebnisse_ganze_klasse(db_fabrik):
    """30 Kinder melden ihr Rundenergebnis gleichzeitig — jedes muss ankommen."""
    _, code = await _cd_aufbau(db_fabrik)

    async def melden(i, db):
        return await CD.submit_result(
            code, CD.ResultIn(playerName=f"Kind {i:02d}", puzzleId="p1", solved=True, attempts=1, time=5.0),
            request=_Req(), db=db)

    ergebnisse = await _parallel(db_fabrik, 30, melden)
    assert not _harte_fehler(ergebnisse), _harte_fehler(ergebnisse)
    absagen = [r for r in ergebnisse if isinstance(r, BaseException)]
    assert not absagen, f"Absagen beim Melden: {absagen}"

    async with db_fabrik() as db:
        s = (await db.execute(select(CodeSession).where(CodeSession.code == code))).scalar_one()
    assert len(s.results or []) == 30, f"nur {len(s.results or [])} von 30 Ergebnissen"
    assert len(s.players or []) == 30


@pytest.mark.asyncio
async def test_cd_ein_raetsel_zaehlt_je_person_einmal(db_fabrik):
    """„Ein Raetsel zaehlt je Person einmal" — auch bei gleichzeitigen Meldungen."""
    _, code = await _cd_aufbau(db_fabrik)
    async with db_fabrik() as db:
        await CD.join_session(code, CD.JoinIn(name="Max"), request=_Req(), db=db)

    async def melden(i, db):
        return await CD.submit_result(
            code, CD.ResultIn(playerName="Max", puzzleId="p1", solved=True, attempts=i + 1, time=1.0),
            request=_Req(), db=db)

    ergebnisse = await _parallel(db_fabrik, 10, melden)
    assert not _harte_fehler(ergebnisse), _harte_fehler(ergebnisse)

    async with db_fabrik() as db:
        s = (await db.execute(select(CodeSession).where(CodeSession.code == code))).scalar_one()
    assert len(s.results or []) == 1, f"{len(s.results or [])} Ergebnisse fuer eine Person und ein Raetsel"


# ─── CardVote: zwei Scans desselben Kindes zur selben Frage ───

async def _scan_aufbau(db_fabrik):
    async with db_fabrik() as db:
        u = User(email="cv@d.de", password_hash="x", name="L")
        db.add(u)
        await db.flush()
        db.add(UserModule(user_id=u.id, module_key="cardvote"))
        q = Question(text="2+2?", correct_answer="A", owner_id=u.id)
        db.add(q)
        await db.flush()
        sess = Session(name="S", owner_id=u.id, current_question_id=q.id)
        db.add(sess)
        await db.commit()
        return u, sess.id, q.id


@pytest.mark.asyncio
async def test_scan_gleichzeitig_nur_eine_zeile(db_fabrik):
    """Der Scanner erkennt eine Karte zweimal in derselben Sekunde. Ohne Schutz
    entstehen zwei Scan-Zeilen — und das Balkendiagramm zeigt 31 Antworten in
    einer Klasse mit 30 Kindern."""
    u, session_id, question_id = await _scan_aufbau(db_fabrik)

    async def scan(i, db):
        return await R.submit_scan(R.ScanCreate(session_id=session_id, student_id=7, answer="B"),
                                   user=u, db=db)

    ergebnisse = await _parallel(db_fabrik, 8, scan)
    assert not _harte_fehler(ergebnisse), _harte_fehler(ergebnisse)

    async with db_fabrik() as db:
        anzahl = (await db.execute(select(func.count()).select_from(Scan).where(
            Scan.session_id == session_id, Scan.question_id == question_id,
            Scan.student_id == 7))).scalar_one()
    assert anzahl == 1, f"{anzahl} Scan-Zeilen fuer ein Kind und eine Frage"


@pytest.mark.asyncio
async def test_scan_ganze_klasse_gleichzeitig(db_fabrik):
    """30 Karten kurz hintereinander (Serien-Scan): 30 Zeilen, keine mehr."""
    u, session_id, question_id = await _scan_aufbau(db_fabrik)

    async def scan(i, db):
        return await R.submit_scan(R.ScanCreate(session_id=session_id, student_id=i, answer="A"),
                                   user=u, db=db)

    ergebnisse = await _parallel(db_fabrik, 30, scan)
    assert not _harte_fehler(ergebnisse), _harte_fehler(ergebnisse)

    async with db_fabrik() as db:
        anzahl = (await db.execute(select(func.count()).select_from(Scan).where(
            Scan.session_id == session_id, Scan.question_id == question_id))).scalar_one()
    assert anzahl == 30


# ─── Drosselung: eine Klasse hinter EINER Adresse ───

@pytest.mark.asyncio
async def test_drosselung_bremst_klasse_nicht_aus(db_fabrik):
    """Eine Schulklasse ist fuer den Server EIN Client (NAT). Zaehlt die
    Drosselung je IP, sagt sie einer ganzen Klasse ab.

    Gemessen wird der Poll-Takt der App: `store.jsx` fragt alle 1,8 s den Stand
    ab — 30 Kinder ergeben rund 1000 Anfragen je Minute aus einer Adresse.
    """
    _, code = await _cd_aufbau(db_fabrik)

    async def abfragen(i, db):
        return await CD.get_session(code, request=_Req(), db=db)

    # Eine Minute Poll-Takt einer 30er-Klasse, in Bloecken zu 30.
    absagen = 0
    for _runde in range(34):
        ergebnisse = await _parallel(db_fabrik, 30, abfragen)
        assert not _harte_fehler(ergebnisse), _harte_fehler(ergebnisse)
        absagen += sum(1 for r in ergebnisse if isinstance(r, BaseException))
    assert absagen == 0, f"{absagen} von 1020 Abfragen einer Klasse abgewiesen (429)"


@pytest.mark.asyncio
async def test_drosselung_faengt_code_raten_weiter_ab(db_fabrik):
    """Der Schutz darf dabei nicht verloren gehen: wer sechsstellige Codes
    durchprobiert, muss weiter abgewiesen werden."""
    from fastapi import HTTPException
    await _cd_aufbau(db_fabrik)
    abgewiesen = False
    async with db_fabrik() as db:
        for i in range(400):
            try:
                await CD.get_session(f"ZZ{i:04d}"[:6], request=_Req(), db=db)
            except HTTPException as e:
                if e.status_code == 429:
                    abgewiesen = True
                    break
    assert abgewiesen, "Code-Raten wurde nie gedrosselt"
