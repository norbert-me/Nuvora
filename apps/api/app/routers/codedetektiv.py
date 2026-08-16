"""Modul Code-Detektiv — Rätsel serverseitig speichern.

Damit Rätsel themen-getaggt und im Kalender planbar sind, liegen die eigenen
Rätsel der Lehrkraft im Kern (nicht mehr nur im Browser-localStorage). Die App
arbeitet weiter mit ihrer stabilen `client_id`; upsert läuft darüber.
"""
import secrets
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select, update as sa_update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from ..nebenlauf import mit_wiederholung
from ..zeit import jetzt
from ..database import get_db
from ..models import CodePuzzle, CodeSession, Topic, User
from .auth import rate_limit, client_ip
from .modules import is_active, modul_pflicht

router = APIRouter(prefix="/api/codedetektiv", tags=["codedetektiv"])
MODULE_KEY = "code-detektiv"


require_module = modul_pflicht(MODULE_KEY)


class PuzzleIn(BaseModel):
    client_id: str
    title: str = ""
    topic_id: Optional[int] = None
    payload: dict = {}


class PuzzleOut(BaseModel):
    id: int
    client_id: str
    title: str
    topic_id: Optional[int] = None
    payload: dict
    model_config = {"from_attributes": True}


@router.get("/puzzles", response_model=List[PuzzleOut])
async def list_puzzles(user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(CodePuzzle).where(CodePuzzle.owner_id == user.id).order_by(CodePuzzle.id))).scalars().all()
    return rows


@router.put("/puzzles")
async def upsert_puzzle(body: PuzzleIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    rate_limit("cd_puzzle", f"u{user.id}", 300, 60, "Zu viele Änderungen. Bitte kurz warten.")
    if body.topic_id is not None:
        ok = (await db.execute(select(Topic.id).where(Topic.id == body.topic_id, Topic.owner_id == user.id))).scalar_one_or_none()
        if not ok:
            body.topic_id = None
    row = (await db.execute(select(CodePuzzle).where(
        CodePuzzle.owner_id == user.id, CodePuzzle.client_id == body.client_id))).scalar_one_or_none()
    if row:
        row.title = (body.title or "")[:200]
        row.topic_id = body.topic_id
        row.payload = body.payload or {}
    else:
        row = CodePuzzle(owner_id=user.id, client_id=body.client_id[:64], title=(body.title or "")[:200],
                         topic_id=body.topic_id, payload=body.payload or {})
        db.add(row)
    await db.commit()
    await db.refresh(row)
    return {"id": row.id, "client_id": row.client_id}


@router.delete("/puzzles/{client_id}", status_code=204)
async def delete_puzzle(client_id: str, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    row = (await db.execute(select(CodePuzzle).where(
        CodePuzzle.owner_id == user.id, CodePuzzle.client_id == client_id))).scalar_one_or_none()
    if row:
        await db.delete(row)
        await db.commit()


# ─── Klassen-Sessions (serverseitig, öffentliches Beitreten ohne Login) ───

_now = jetzt   # dieselbe Uhr wie in karten.py — sie steht im Kern (app/zeit.py)


def _session_public(s: CodeSession) -> dict:
    """Für alle sichtbarer Stand (auch öffentlich, ohne Login)."""
    return {
        "code": s.code,
        "puzzles": s.puzzles or [],
        "players": s.players or [],
        "results": s.results or [],
        "started": s.started,
        "ended": s.ended,
        "current_index": s.current_index,
        "started_at": s.started_at.isoformat() if s.started_at else None,
        "round_started_at": s.round_started_at.isoformat() if s.round_started_at else None,
    }


# EINE Meldung fuer jeden Grund — wortgleich mit `karten._student_by_token`.
# Vorher stand hier „Session nicht gefunden": daran liess sich von aussen
# ablesen, ob es den Code gibt und nur das Modul aus ist. Genau diese Auskunft
# soll niemand bekommen — nach aussen darf nicht erkennbar sein, welche Module
# eine Lehrkraft nutzt. Der Statuscode (404) bleibt, nur der Wortlaut ist jetzt
# ueberall derselbe.
ZUGANG_TOT = "Zugang nicht mehr gültig"


async def _pruefe_modul(db: AsyncSession, s: CodeSession) -> None:
    """Sitzung nur, solange das Modul laeuft — fuer JEDEN oeffentlichen Weg."""
    if s.owner_id and not await is_active(db, s.owner_id, "code-detektiv"):
        raise HTTPException(404, ZUGANG_TOT)


async def _by_code(db: AsyncSession, code: str, sperren: bool = False) -> CodeSession:
    """`sperren=True` fuer jeden, der players/results aendert.

    players und results sind JSON-Listen EINER Zeile. Wer sie ohne Sperre liest,
    anhaengt und zurueckschreibt, verliert alles, was zwischendurch jemand
    anderes geschrieben hat — bei 30 Kindern, die gleichzeitig beitreten, bleiben
    davon zwei uebrig.

    Postgres sperrt die Zeile mit `FOR UPDATE`. SQLite (Tests, lokale
    Pruefinstanz) kennt das nicht — und schlimmer: pysqlite beginnt eine
    Transaktion erst beim ersten Schreiben, ein SELECT laeuft also voellig
    ungeschuetzt. Darum dort ein Schein-UPDATE VOR dem Lesen: das erzwingt die
    Schreibtransaktion, weitere Schreiber warten (busy_timeout), statt einander
    zu ueberschreiben.
    """
    q = select(CodeSession).where(CodeSession.code == code.upper())
    if sperren:
        if db.get_bind().dialect.name == "sqlite":
            await db.execute(sa_update(CodeSession).where(CodeSession.code == code.upper())
                             .values(id=CodeSession.id)
                             .execution_options(synchronize_session=False))
        else:
            q = q.with_for_update()
    s = (await db.execute(q)).scalar_one_or_none()
    if not s:
        raise HTTPException(404, ZUGANG_TOT)
    # Jeder oeffentliche Weg laeuft hier durch (beitreten, spielen, melden) —
    # deshalb steht die Modulpruefung hier und nicht in jedem Endpunkt einzeln.
    await _pruefe_modul(db, s)
    return s


async def _owned_session(db: AsyncSession, user: User, code: str) -> CodeSession:
    s = await _by_code(db, code)
    if s.owner_id != user.id:
        raise HTTPException(403, "Keine Berechtigung")
    return s


class SessionCreate(BaseModel):
    puzzles: list = []  # ganze Rätselobjekte (Schnappschuss, inkl. Beispiel-Rätsel)


@router.post("/sessions", status_code=201)
async def create_session(body: SessionCreate, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    rate_limit("cd_session", f"u{user.id}", 60, 3600, "Zu viele Sessions. Bitte später erneut.")
    if not body.puzzles:
        raise HTTPException(400, "Mindestens ein Rätsel wählen")
    # Kurzer, gut ablesbarer Code; Kollision extrem unwahrscheinlich, sonst neu.
    code = None
    for _ in range(8):
        kandidat = "".join(secrets.choice("ABCDEFGHJKLMNPQRSTUVWXYZ23456789") for _ in range(6))
        if not (await db.execute(select(CodeSession.id).where(CodeSession.code == kandidat))).scalar_one_or_none():
            code = kandidat
            break
    if code is None:   # sonst lief der letzte (belegte) Code in einen 500er
        raise HTTPException(503, "Gerade keinen freien Code gefunden. Bitte noch einmal versuchen.")
    s = CodeSession(owner_id=user.id, code=code, puzzles=body.puzzles[:50], players=[], results=[])
    db.add(s)
    await db.commit()
    await db.refresh(s)
    return _session_public(s)


@router.get("/sessions/{code}")
async def get_session(code: str, request: Request, db: AsyncSession = Depends(get_db)):
    """Öffentlich: Zustand pollen (Beitreten, Spielen ohne Login).

    Gedrosselt wird je SITZUNGSCODE, nicht je IP. Eine Schulklasse haengt hinter
    EINER Adresse (NAT) — fuer den Server ist sie ein einziger Client. Die App
    fragt alle 1,8 s den Stand ab (store.jsx), 30 Kinder sind also rund 1000
    Anfragen je Minute aus einer Adresse; das alte Limit (300/min je IP) hat ab
    dem neunten Kind abgewiesen.

    Der Schutz gegen ERRATEN des sechsstelligen Codes bleibt und wird sogar
    schaerfer: nicht die Abfragen auf einen gueltigen Code sind das Problem,
    sondern die FEHLGRIFFE — die zaehlen weiter je Adresse und eng.
    """
    ip = client_ip(request)
    rate_limit("cd_code_ip", ip, 3000, 60)  # Notbremse: ein Geraet/Netz insgesamt
    s = (await db.execute(select(CodeSession).where(CodeSession.code == code.upper()))).scalar_one_or_none()
    if not s:
        rate_limit("cd_code_miss", ip, 30, 60, "Zu viele Versuche. Bitte kurz warten.")
        raise HTTPException(404, ZUGANG_TOT)
    # Modul abgeschaltet = Sitzung zu. Ein Sitzungscode steht an der Tafel und
    # laesst sich nicht einsammeln; wer das Modul abschaltet, erwartet, dass
    # ueber ihn nichts mehr zu holen ist (auch keine Namen der Mitspielenden).
    await _pruefe_modul(db, s)
    rate_limit("cd_code", s.code, 2400, 60)  # ~40/s je Sitzung: Klasse ja, Flut nein
    return _session_public(s)


class JoinIn(BaseModel):
    name: str


@router.post("/sessions/{code}/join")
async def join_session(code: str, body: JoinIn, request: Request, db: AsyncSession = Depends(get_db)):
    """Öffentlich: als Spieler beitreten.

    Gedrosselt je Kind (Sitzungscode + Name) statt je IP: 30 Kinder einer Klasse
    treten aus derselben Adresse bei, das alte Limit (60/min je IP) reichte fuer
    eine Klasse mit Nachzueglern und Wiederholungen nicht. Ein Kind, das
    hundertmal beitritt, wird weiter gebremst — und die beiden groben Zaehler
    darunter halten Flut ueber viele Namen in Grenzen.
    """
    name = (body.name or "").strip()[:40]
    if not name:
        raise HTTPException(400, "Name fehlt")
    ip = client_ip(request)
    rate_limit("cd_join_kind", f"{code.upper()}:{name}", 20, 60, "Zu viele Beitritts-Versuche. Bitte kurz warten.")
    rate_limit("cd_join_code", code.upper(), 600, 60, "Zu viele Beitritte in dieser Sitzung. Bitte kurz warten.")
    rate_limit("cd_join_ip", ip, 1200, 60, "Zu viele Beitritts-Versuche. Bitte kurz warten.")

    async def eintragen():
        s = await _by_code(db, code, sperren=True)
        if s.ended:
            raise HTTPException(400, "Session ist beendet")
        players = list(s.players or [])
        if any(p.get("name") == name for p in players):
            return _session_public(s)  # schon dabei
        if s.started:
            raise HTTPException(400, "Session läuft bereits")
        players.append({"name": name, "joinedAt": _now().isoformat()})
        s.players = players
        flag_modified(s, "players")
        await db.commit()
        return _session_public(s)

    return await mit_wiederholung(db, eintragen, versuche=8)


class ResultIn(BaseModel):
    playerName: str
    puzzleId: str
    solved: bool = False
    attempts: int = 0
    time: float = 0


@router.post("/sessions/{code}/result")
async def submit_result(code: str, body: ResultIn, request: Request, db: AsyncSession = Depends(get_db)):
    """Öffentlich: Ergebnis einer Runde melden (einmal je Spieler+Rätsel).

    Oeffentlich + ohne Login: darum rate-limitiert, mit Laengen- und Groessen-
    Grenzen, damit niemand die results-Liste vollschreiben kann (DB-Bloat/DoS).

    Gedrosselt je Kind (Sitzungscode + Name), nicht je IP — eine Klasse haengt
    hinter EINER Adresse und meldete gemeinsam mehr als die alten 120/min."""
    pn = (body.playerName or "").strip()[:40]
    pid = (body.puzzleId or "").strip()[:64]
    if not pn or not pid:
        raise HTTPException(400, "Ungültige Angaben")
    ip = client_ip(request)
    rate_limit("cd_result_kind", f"{code.upper()}:{pn}", 60, 60, "Zu viele Anfragen. Bitte kurz warten.")
    rate_limit("cd_result_code", code.upper(), 1200, 60, "Zu viele Meldungen in dieser Sitzung. Bitte kurz warten.")
    rate_limit("cd_result_ip", ip, 2400, 60, "Zu viele Anfragen. Bitte kurz warten.")

    async def melden():
        # Gesperrt lesen: players und results sind JSON-Listen EINER Zeile —
        # ohne Sperre ueberschreiben 30 gleichzeitige Meldungen einander.
        s = await _by_code(db, code, sperren=True)
        if s.ended:
            raise HTTPException(400, "Session ist beendet")
        # Nur wer in der Sitzung steht, darf Ergebnisse melden. Wer den Code kennt,
        # konnte sonst waehrend des laufenden Spiels beliebige Namen in die Liste (und
        # damit in die Notenspalte) schreiben. Vor dem Start wird ein verlorener
        # Beitritt still nachgeholt, damit kein Kind sein Ergebnis verliert.
        players = list(s.players or [])
        if not any(p.get("name") == pn for p in players):
            if s.started:
                raise HTTPException(403, "Nicht in dieser Sitzung angemeldet")
            players.append({"name": pn, "joinedAt": _now().isoformat()})
            s.players = players
            flag_modified(s, "players")
        results = list(s.results or [])
        if any(r.get("playerName") == pn and r.get("puzzleId") == pid for r in results):
            return _session_public(s)
        if len(results) >= 5000:
            raise HTTPException(400, "Zu viele Ergebnisse in dieser Session")
        results.append({"playerName": pn, "puzzleId": pid,
                        "solved": bool(body.solved), "attempts": max(0, min(int(body.attempts), 10000)),
                        "time": max(0.0, min(float(body.time), 1e7))})
        s.results = results
        flag_modified(s, "results")
        await db.commit()
        return _session_public(s)

    return await mit_wiederholung(db, melden, versuche=8)


@router.post("/sessions/{code}/start")
async def start_session(code: str, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    s = await _owned_session(db, user, code)
    s.started = True
    s.started_at = _now()
    s.round_started_at = _now()
    await db.commit()
    return _session_public(s)


@router.post("/sessions/{code}/advance")
async def advance_session(code: str, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    s = await _owned_session(db, user, code)
    nxt = s.current_index + 1
    if nxt >= len(s.puzzles or []):
        s.ended = True
    else:
        s.current_index = nxt
        s.round_started_at = _now()
    await db.commit()
    return _session_public(s)


@router.post("/sessions/{code}/end")
async def end_session(code: str, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    s = await _owned_session(db, user, code)
    s.ended = True
    s.ended_at = _now()
    await db.commit()
    return _session_public(s)


class RemoveIn(BaseModel):
    name: str


@router.post("/sessions/{code}/remove")
async def remove_player(code: str, body: RemoveIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    s = await _owned_session(db, user, code)
    s.players = [p for p in (s.players or []) if p.get("name") != body.name]
    s.results = [r for r in (s.results or []) if r.get("playerName") != body.name]
    flag_modified(s, "players")
    flag_modified(s, "results")
    await db.commit()
    return _session_public(s)


@router.delete("/sessions/{code}", status_code=204)
async def delete_session(code: str, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    s = await _owned_session(db, user, code)
    await db.delete(s)
    await db.commit()
