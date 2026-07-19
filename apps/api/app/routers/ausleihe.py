"""Modul Material-Ausleihe — Gegenstände verleihen und den Rückgabe-Stand
im Blick behalten. Ausleiher ist ein Kern-Schüler oder ein Freitextname.
"""
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..database import get_db
from ..models import MaterialItem, MaterialLoan, Student, User
from .auth import get_current_user, rate_limit
from .modules import is_active

router = APIRouter(prefix="/api/ausleihe", tags=["ausleihe"])
MODULE_KEY = "ausleihe"


async def require_module(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> User:
    if not await is_active(db, user.id, MODULE_KEY):
        raise HTTPException(403, "Modul Ausleihe ist nicht aktiviert")
    return user


class ItemIn(BaseModel):
    name: str


class LoanIn(BaseModel):
    item_id: int
    borrower: str = ""
    student_id: Optional[int] = None


def _loan_dict(loan: MaterialLoan) -> dict:
    return {
        "id": loan.id, "item_id": loan.item_id, "borrower": loan.borrower,
        "student_id": loan.student_id,
        "out_at": loan.out_at.isoformat() if loan.out_at else None,
        "returned_at": loan.returned_at.isoformat() if loan.returned_at else None,
    }


@router.get("/items")
async def list_items(user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(MaterialItem).options(selectinload(MaterialItem.loans)).where(MaterialItem.owner_id == user.id).order_by(MaterialItem.name)
    )).scalars().all()
    from datetime import datetime, timezone, timedelta
    grenze = datetime.now(timezone.utc) - timedelta(days=14)  # überfällig ab 14 Tagen
    def _ueberfaellig(l):
        if l.returned_at is not None or l.out_at is None:
            return False
        out = l.out_at if l.out_at.tzinfo else l.out_at.replace(tzinfo=timezone.utc)
        return out < grenze
    return [{"id": it.id, "name": it.name,
             "open": sum(1 for l in it.loans if l.returned_at is None),
             "overdue": sum(1 for l in it.loans if _ueberfaellig(l))} for it in rows]


@router.post("/items", status_code=201)
async def create_item(body: ItemIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    rate_limit("ausleihe", f"u{user.id}", 200, 60, "Zu viele Einträge. Bitte kurz warten.")
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(400, "Name darf nicht leer sein")
    it = MaterialItem(owner_id=user.id, name=name[:160])
    db.add(it)
    await db.commit()
    await db.refresh(it)
    return {"id": it.id, "name": it.name, "open": 0}


@router.delete("/items/{item_id}", status_code=204)
async def delete_item(item_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    it = await db.get(MaterialItem, item_id)
    if not it or it.owner_id != user.id:
        raise HTTPException(404, "Gegenstand nicht gefunden")
    await db.delete(it)
    await db.commit()


@router.get("/loans")
async def list_loans(item_id: Optional[int] = None, open: Optional[bool] = None,
                     user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    q = select(MaterialLoan).where(MaterialLoan.owner_id == user.id)
    if item_id is not None:
        q = q.where(MaterialLoan.item_id == item_id)
    if open:
        q = q.where(MaterialLoan.returned_at.is_(None))
    rows = (await db.execute(q.order_by(MaterialLoan.out_at.desc()))).scalars().all()
    return [_loan_dict(l) for l in rows]


@router.post("/loans", status_code=201)
async def create_loan(body: LoanIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    rate_limit("ausleihe", f"u{user.id}", 300, 60, "Zu viele Ausleihen. Bitte kurz warten.")
    it = await db.get(MaterialItem, body.item_id)
    if not it or it.owner_id != user.id:
        raise HTTPException(404, "Gegenstand nicht gefunden")
    borrower = (body.borrower or "").strip()
    sid = None
    if body.student_id:
        st = await db.get(Student, body.student_id)
        if st:
            sid = st.id
            if not borrower:
                borrower = st.name
    if not borrower:
        raise HTTPException(400, "Ausleiher fehlt")
    loan = MaterialLoan(owner_id=user.id, item_id=it.id, student_id=sid, borrower=borrower[:160])
    db.add(loan)
    await db.commit()
    await db.refresh(loan)
    return _loan_dict(loan)


@router.put("/loans/{loan_id}/return")
async def return_loan(loan_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    loan = await db.get(MaterialLoan, loan_id)
    if not loan or loan.owner_id != user.id:
        raise HTTPException(404, "Ausleihe nicht gefunden")
    loan.returned_at = datetime.now().astimezone()
    await db.commit()
    return _loan_dict(loan)
