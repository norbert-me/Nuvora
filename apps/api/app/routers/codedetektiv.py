"""Modul Code-Detektiv — Rätsel serverseitig speichern.

Damit Rätsel themen-getaggt und im Kalender planbar sind, liegen die eigenen
Rätsel der Lehrkraft im Kern (nicht mehr nur im Browser-localStorage). Die App
arbeitet weiter mit ihrer stabilen `client_id`; upsert läuft darüber.
"""
import secrets
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from ..database import get_db
from ..models import CodePuzzle, CodeSession, Topic, User
from .auth import get_current_user, rate_limit, client_ip
from .modules import is_active

router = APIRouter(prefix="/api/codedetektiv", tags=["codedetektiv"])
MODULE_KEY = "code-detektiv"


async def require_module(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> User:
    if not await is_active(db, user.id, MODULE_KEY):
        raise HTTPException(403, "Modul Code-Detektiv ist nicht aktiviert")
    return user


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

def _now():
    return datetime.now(timezone.utc)


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


async def _by_code(db: AsyncSession, code: str) -> CodeSession:
    s = (await db.execute(select(CodeSession).where(CodeSession.code == code.upper()))).scalar_one_or_none()
    if not s:
        raise HTTPException(404, "Session nicht gefunden")
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
    for _ in range(5):
        code = "".join(secrets.choice("ABCDEFGHJKLMNPQRSTUVWXYZ23456789") for _ in range(6))
        if not (await db.execute(select(CodeSession.id).where(CodeSession.code == code))).scalar_one_or_none():
            break
    s = CodeSession(owner_id=user.id, code=code, puzzles=body.puzzles[:50], players=[], results=[])
    db.add(s)
    await db.commit()
    await db.refresh(s)
    return _session_public(s)


@router.get("/sessions/{code}")
async def get_session(code: str, request: Request, db: AsyncSession = Depends(get_db)):
    """Öffentlich: Zustand pollen (Beitreten, Spielen ohne Login)."""
    # Öffentlich + kurzer Code -> gegen Erraten/Enumerieren begrenzen (pro IP).
    rate_limit("cd_code", client_ip(request), 300, 60, "Zu viele Anfragen. Bitte kurz warten.")
    return _session_public(await _by_code(db, code))


class JoinIn(BaseModel):
    name: str


@router.post("/sessions/{code}/join")
async def join_session(code: str, body: JoinIn, request: Request, db: AsyncSession = Depends(get_db)):
    """Öffentlich: als Spieler beitreten."""
    rate_limit("cd_join", client_ip(request), 60, 60, "Zu viele Beitritts-Versuche. Bitte kurz warten.")
    s = await _by_code(db, code)
    if s.ended:
        raise HTTPException(400, "Session ist beendet")
    name = (body.name or "").strip()[:40]
    if not name:
        raise HTTPException(400, "Name fehlt")
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


class ResultIn(BaseModel):
    playerName: str
    puzzleId: str
    solved: bool = False
    attempts: int = 0
    time: float = 0


@router.post("/sessions/{code}/result")
async def submit_result(code: str, body: ResultIn, db: AsyncSession = Depends(get_db)):
    """Öffentlich: Ergebnis einer Runde melden (einmal je Spieler+Rätsel)."""
    s = await _by_code(db, code)
    results = list(s.results or [])
    if any(r.get("playerName") == body.playerName and r.get("puzzleId") == body.puzzleId for r in results):
        return _session_public(s)
    results.append({"playerName": body.playerName, "puzzleId": body.puzzleId,
                    "solved": bool(body.solved), "attempts": int(body.attempts), "time": float(body.time)})
    s.results = results
    flag_modified(s, "results")
    await db.commit()
    return _session_public(s)


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
