import io
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select, func as sa_func
from sqlalchemy.ext.asyncio import AsyncSession
from ..database import get_db
from ..models import Session, QuestionSetItem, SchoolClass, QuestionSet, User
from .auth import get_current_user, rate_limit, client_ip
from .. import websocket as ws

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


class SessionCreate(BaseModel):
    name: str = ""
    class_id: Optional[int] = None
    question_set_id: Optional[int] = None
    mode: str = "test"


class SessionOut(BaseModel):
    id: int
    code: str = "0000"
    name: str
    class_id: Optional[int]
    question_set_id: Optional[int]
    current_question_id: Optional[int]
    status: str

    model_config = {"from_attributes": True}


@router.get("/active")
async def get_active_sessions(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Session).where(
            Session.owner_id == user.id,
            Session.status == "active",
            Session.archived == False,
        ).order_by(Session.id.desc()).limit(10)
    )
    sessions = result.scalars().all()
    out = []
    for s in sessions:
        item = {"id": s.id, "code": s.code, "name": s.name, "class_id": s.class_id, "question_set_id": s.question_set_id, "current_question_id": s.current_question_id, "mode": s.mode}
        if s.class_id:
            cls = await db.get(SchoolClass, s.class_id)
            item["class_name"] = cls.name if cls else None
        if s.question_set_id:
            qs = await db.get(QuestionSet, s.question_set_id)
            item["set_name"] = qs.name if qs else None
        out.append(item)
    return out


@router.post("/{session_id}/finish")
async def finish_session(session_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    s = await db.get(Session, session_id)
    if not s:
        raise HTTPException(404)
    if s.owner_id and s.owner_id != user.id:
        raise HTTPException(403)
    s.status = "finished"
    await db.commit()
    return {"ok": True}


@router.post("", response_model=SessionOut, status_code=201)
async def create_session(body: SessionCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    # Generate 4-digit code cycling 0001–9999
    result = await db.execute(
        select(sa_func.max(Session.code)).where(Session.owner_id == user.id)
    )
    max_code = result.scalar_one_or_none()
    if max_code and max_code != "0000":
        next_num = int(max_code) + 1
        if next_num > 9999:
            next_num = 1
    else:
        next_num = 1
    code = str(next_num).zfill(4)

    session = Session(**body.model_dump(), owner_id=user.id, code=code)
    if body.question_set_id:
        first = await db.execute(
            select(QuestionSetItem)
            .where(QuestionSetItem.question_set_id == body.question_set_id)
            .order_by(QuestionSetItem.position)
            .limit(1)
        )
        item = first.scalar_one_or_none()
        if item:
            session.current_question_id = item.question_id
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return session


@router.get("/by-code/{code}")
async def get_session_by_code(code: str, request: Request, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    # Anti-Brute-Force gegen 4-stellige Session-Codes
    rate_limit("bycode", client_ip(request), 60, 60)
    # Nur eigene Sessions: Codes werden pro Lehrkraft vergeben (0001, 0002, ...) und
    # kollidieren zwischen Lehrkraeften — ohne Filter landet der Scanner sonst in einer
    # fremden Session und bekommt beim Scannen nur unverstaendliche 403-Fehler.
    result = await db.execute(
        select(Session).where(
            Session.code == code,
            Session.status == "active",
            Session.archived == False,
            (Session.owner_id == user.id) | (Session.owner_id.is_(None)),
        ).order_by(Session.id.desc()).limit(1)
    )
    s = result.scalar_one_or_none()
    if not s:
        raise HTTPException(404, "Session nicht gefunden")
    return {"id": s.id, "code": s.code, "name": s.name, "class_id": s.class_id, "current_question_id": s.current_question_id}


@router.put("/{session_id}/question-map")
async def save_question_map(session_id: int, body: dict, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    s = await db.get(Session, session_id)
    if not s:
        raise HTTPException(404)
    if s.owner_id and s.owner_id != user.id:
        raise HTTPException(403)
    s.question_map = body
    await db.commit()
    return {"ok": True}


@router.get("/{session_id}")
async def get_session(session_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    s = await db.get(Session, session_id)
    if not s:
        raise HTTPException(404)
    if s.owner_id and s.owner_id != user.id:
        raise HTTPException(403)
    out = {"id": s.id, "code": s.code, "name": s.name, "class_id": s.class_id, "question_set_id": s.question_set_id, "current_question_id": s.current_question_id, "status": s.status, "archived": s.archived}
    if s.class_id:
        cls = await db.get(SchoolClass, s.class_id)
        out["class_name"] = cls.name if cls else None
    if s.question_set_id:
        qs = await db.get(QuestionSet, s.question_set_id)
        out["set_name"] = qs.name if qs else None
    return out


@router.post("/{session_id}/next", response_model=SessionOut)
async def next_question(session_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    s = await db.get(Session, session_id)
    if not s or not s.question_set_id:
        raise HTTPException(404)
    if s.owner_id and s.owner_id != user.id:
        raise HTTPException(403)

    items = await db.execute(
        select(QuestionSetItem)
        .where(QuestionSetItem.question_set_id == s.question_set_id)
        .order_by(QuestionSetItem.position)
    )
    ordered = items.scalars().all()
    current_ids = [item.question_id for item in ordered]

    if s.current_question_id in current_ids:
        idx = current_ids.index(s.current_question_id)
        if idx + 1 < len(current_ids):
            s.current_question_id = current_ids[idx + 1]
        else:
            s.status = "finished"
    await db.commit()
    await db.refresh(s)

    await ws.broadcast(s.id, {
        "type": "next_question",
        "question_id": s.current_question_id,
        "status": s.status,
    })
    return s


@router.post("/{session_id}/set-question")
async def set_question(session_id: int, question_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    s = await db.get(Session, session_id)
    if not s:
        raise HTTPException(404)
    if s.owner_id and s.owner_id != user.id:
        raise HTTPException(403)
    s.current_question_id = question_id
    await db.commit()
    await ws.broadcast(s.id, {"type": "next_question", "question_id": question_id, "status": s.status})
    return {"ok": True}


@router.get("/{session_id}/eval-config")
async def get_eval_config(session_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    s = await db.get(Session, session_id)
    if not s:
        raise HTTPException(404)
    if s.owner_id and s.owner_id != user.id:
        raise HTTPException(403)
    return s.eval_config or {}


@router.put("/{session_id}/eval-config")
async def save_eval_config(session_id: int, body: dict, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    s = await db.get(Session, session_id)
    if not s:
        raise HTTPException(404)
    if s.owner_id and s.owner_id != user.id:
        raise HTTPException(403)
    s.eval_config = body
    await db.commit()
    return {"ok": True}


@router.post("/{session_id}/archive")
async def toggle_archive(session_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    s = await db.get(Session, session_id)
    if not s:
        raise HTTPException(404)
    if s.owner_id and s.owner_id != user.id:
        raise HTTPException(403)
    s.archived = not s.archived
    await db.commit()
    return {"ok": True, "archived": s.archived}


@router.delete("/{session_id}", status_code=204)
async def delete_session(session_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    s = await db.get(Session, session_id)
    if not s:
        raise HTTPException(404)
    if s.owner_id and s.owner_id != user.id:
        raise HTTPException(403)
    await db.delete(s)
    await db.commit()


@router.get("/{session_id}/qr")
async def get_session_qr(session_id: int, request: Request, db: AsyncSession = Depends(get_db)):
    s = await db.get(Session, session_id)
    if not s:
        raise HTTPException(404)
    import qrcode
    forwarded_host = request.headers.get("x-forwarded-host") or request.headers.get("host")
    scheme = request.headers.get("x-forwarded-proto", "https")
    base = f"{scheme}://{forwarded_host}" if forwarded_host else str(request.base_url).rstrip("/")
    url = f"{base}/scan?session={s.code}"
    img = qrcode.make(url, box_size=6, border=2)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return StreamingResponse(buf, media_type="image/png")
