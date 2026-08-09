"""Modul Code-Detektiv — die oeffentliche Sitzung (Beitreten und Spielen ohne
Konto, nur mit dem sechsstelligen Code)."""
import pytest
import pytest_asyncio
from sqlalchemy import event, select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from app.models import Base, User, UserModule, CodeSession
from app.routers import codedetektiv as CD
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


class _Req:
    """Minimaler Request-Ersatz fuer die IP-Rate-Limits."""
    client = type("C", (), {"host": "10.0.0.1"})()
    headers: dict = {}


async def _sitzung(s, mail="cd@d.de"):
    u = User(email=mail, password_hash="x", name="L")
    s.add(u)
    await s.flush()
    s.add(UserModule(user_id=u.id, module_key="code-detektiv"))
    await s.commit()
    out = await CD.create_session(CD.SessionCreate(puzzles=[{"id": "p1"}, {"id": "p2"}]), user=u, db=s)
    return u, out["code"]


@pytest.mark.asyncio
async def test_beitreten_doppelt_und_sehr_lange_namen(s):
    """Zweimal derselbe Name ist ein zweiter Klick, keine zweite Person. Namen
    werden auf 40 Zeichen gekuerzt — auch zwei Namen, die sich erst nach dem
    Schnitt unterscheiden, duerfen nicht als zwei Personen erscheinen."""
    u, code = await _sitzung(s)
    await CD.join_session(code, CD.JoinIn(name="Max"), request=_Req(), db=s)
    st = await CD.join_session(code, CD.JoinIn(name="  Max  "), request=_Req(), db=s)
    assert [p["name"] for p in st["players"]] == ["Max"]

    lang = "A" * 60
    await CD.join_session(code, CD.JoinIn(name=lang), request=_Req(), db=s)
    st = await CD.join_session(code, CD.JoinIn(name=lang + "anders"), request=_Req(), db=s)
    namen = [p["name"] for p in st["players"]]
    assert namen == ["Max", "A" * 40]
    assert all(len(n) <= 40 for n in namen)


@pytest.mark.asyncio
async def test_kein_beitritt_nach_start_aber_rueckkehr_erlaubt(s):
    """Wer schon dabei ist, darf nach einem Reload zurueckkommen; wer neu ist,
    kommt nach dem Start nicht mehr rein."""
    u, code = await _sitzung(s)
    await CD.join_session(code, CD.JoinIn(name="Max"), request=_Req(), db=s)
    await CD.start_session(code, user=u, db=s)

    st = await CD.join_session(code, CD.JoinIn(name="Max"), request=_Req(), db=s)   # Reload
    assert [p["name"] for p in st["players"]] == ["Max"]
    with pytest.raises(HTTPException) as ex:
        await CD.join_session(code, CD.JoinIn(name="Neu"), request=_Req(), db=s)
    assert ex.value.status_code == 400


@pytest.mark.asyncio
async def test_ergebnisse_nur_von_mitspielenden(s):
    """Wer den Code kennt, konnte waehrend des Spiels beliebige Namen in die
    Ergebnisliste schreiben — und damit in die spaetere Notenspalte. Vor dem
    Start wird ein verlorener Beitritt dagegen still nachgeholt."""
    u, code = await _sitzung(s)
    # Vor dem Start: Ergebnis ohne vorherigen Beitritt wird nachgetragen.
    st = await CD.submit_result(code, CD.ResultIn(playerName="Lena", puzzleId="p1", solved=True),
                                request=_Req(), db=s)
    assert [p["name"] for p in st["players"]] == ["Lena"]

    await CD.start_session(code, user=u, db=s)
    with pytest.raises(HTTPException) as ex:
        await CD.submit_result(code, CD.ResultIn(playerName="Fremd", puzzleId="p1", solved=True),
                               request=_Req(), db=s)
    assert ex.value.status_code == 403
    st = await CD.get_session(code, request=_Req(), db=s)
    assert [r["playerName"] for r in st["results"]] == ["Lena"]


@pytest.mark.asyncio
async def test_ergebnis_zaehlt_einmal_und_nicht_mehr_nach_ende(s):
    """Ein Raetsel zaehlt je Person genau einmal (auch wenn das Geraet den
    Aufruf wiederholt); nach dem Ende der Sitzung wird nichts mehr angenommen."""
    u, code = await _sitzung(s)
    await CD.join_session(code, CD.JoinIn(name="Max"), request=_Req(), db=s)
    await CD.start_session(code, user=u, db=s)
    for _ in range(3):
        st = await CD.submit_result(code, CD.ResultIn(playerName="Max", puzzleId="p1", solved=True, attempts=2),
                                    request=_Req(), db=s)
    assert len(st["results"]) == 1

    await CD.end_session(code, user=u, db=s)
    with pytest.raises(HTTPException) as ex:
        await CD.submit_result(code, CD.ResultIn(playerName="Max", puzzleId="p2", solved=True),
                               request=_Req(), db=s)
    assert ex.value.status_code == 400
    # Der Stand bleibt fuer die Lehrkraft abrufbar (Quelle der Notenspalte).
    assert len((await CD.get_session(code, request=_Req(), db=s))["results"]) == 1


@pytest.mark.asyncio
async def test_fremde_sitzung_nicht_steuerbar(s):
    """Nur das eigene Konto steuert eine Sitzung (starten, weiter, beenden,
    Spieler entfernen, loeschen)."""
    u, code = await _sitzung(s)
    v = User(email="v@d.de", password_hash="x", name="V")
    s.add(v)
    await s.flush()
    s.add(UserModule(user_id=v.id, module_key="code-detektiv"))
    await s.commit()

    for ruf in (CD.start_session, CD.advance_session, CD.end_session, CD.delete_session):
        with pytest.raises(HTTPException) as ex:
            await ruf(code, user=v, db=s)
        assert ex.value.status_code == 403
    with pytest.raises(HTTPException):
        await CD.remove_player(code, CD.RemoveIn(name="Max"), user=v, db=s)


@pytest.mark.asyncio
async def test_beenden_haelt_den_zeitpunkt_fest(s):
    """Die Aufräumfrist läuft ab dem Ende, nicht ab dem Anlegen.

    Eine Runde wird oft Tage vor dem Unterricht vorbereitet. Rechnete die Frist
    ab dem Anlegen, war sie eine Stunde nach dem Spielen gelöscht — bevor die
    Lehrkraft das Ergebnis als Notenspalte übernehmen konnte.
    """
    u, code = await _sitzung(s)
    frisch = (await s.execute(select(CodeSession).where(CodeSession.code == code))).scalar_one()
    assert frisch.ended_at is None, "eine laufende Runde hat kein Ende"

    await CD.end_session(code, user=u, db=s)
    beendet = (await s.execute(select(CodeSession).where(CodeSession.code == code))).scalar_one()
    assert beendet.ended and beendet.ended_at is not None, "das Ende muss festgehalten werden"
