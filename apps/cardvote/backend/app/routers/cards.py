"""Generate printable ArUco card PDFs per class (A4, 2 cards per page, duplex-ready)."""
import io
import tempfile
from pathlib import Path

import cv2
import numpy as np
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sqlalchemy import select

from ..database import get_db
from ..models import SchoolClass, User
from .auth import get_current_user

router = APIRouter(prefix="/api", tags=["cards"])

ARUCO_DICT = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_6X6_50)
MARKER_SIZE_PX = 600


def build_card_image(marker_id: int) -> np.ndarray:
    marker = cv2.aruco.generateImageMarker(ARUCO_DICT, marker_id, MARKER_SIZE_PX)
    h, w = marker.shape[:2]

    padding = 120
    label_margin = 60
    canvas_size = h + 2 * padding + 2 * label_margin
    card = np.ones((canvas_size, canvas_size), dtype=np.uint8) * 255

    ox = (canvas_size - w) // 2
    oy = (canvas_size - h) // 2
    card[oy:oy + h, ox:ox + w] = marker

    font = cv2.FONT_HERSHEY_SIMPLEX
    label_positions = {
        "A": (canvas_size // 2, oy - label_margin // 2),
        "B": (ox + w + label_margin // 2, canvas_size // 2),
        "C": (canvas_size // 2, oy + h + label_margin // 2),
        "D": (ox - label_margin // 2, canvas_size // 2),
    }
    for label, (cx, cy) in label_positions.items():
        (tw, th), _ = cv2.getTextSize(label, font, 2.0, 4)
        cv2.putText(card, label, (cx - tw // 2, cy + th // 2), font, 2.0, 0, 4)

    cv2.circle(card, (canvas_size // 2 + 50, oy - label_margin + 5), 12, 0, -1)

    return card


@router.get("/classes/{class_id}/cards-pdf")
async def class_cards_pdf(class_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(SchoolClass).options(selectinload(SchoolClass.students)).where(SchoolClass.id == class_id)
    )
    cls = result.scalar_one_or_none()
    if not cls:
        raise HTTPException(404, "Klasse nicht gefunden")
    if cls.owner_id and cls.owner_id != user.id:
        raise HTTPException(403, "Kein Zugriff auf diese Klasse")

    students = sorted(cls.students, key=lambda s: s.card_id)
    if not students:
        raise HTTPException(400, "Keine Lernenden in der Klasse")

    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.pdfgen import canvas

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    page_w, page_h = A4

    card_w = page_w - 20 * mm
    card_h = (page_h - 30 * mm) / 2
    card_size = min(card_w, card_h)

    pairs = []
    for i in range(0, len(students), 2):
        pair = students[i:i + 2]
        pairs.append(pair)

    tmp_files = {}

    mark_len = 4 * mm
    mark_inset = 3 * mm

    def draw_crop_marks(c, x, y, w, h):
        c.setStrokeColorRGB(0.4, 0.4, 0.4)
        c.setLineWidth(0.25)
        for cx, cy, dx, dy in [
            (x + mark_inset, y + h - mark_inset, -1, 1),
            (x + w - mark_inset, y + h - mark_inset, 1, 1),
            (x + mark_inset, y + mark_inset, -1, -1),
            (x + w - mark_inset, y + mark_inset, 1, -1),
        ]:
            c.line(cx, cy, cx + dx * mark_len, cy)
            c.line(cx, cy, cx, cy + dy * mark_len)

    for pair in pairs:
        for idx, student in enumerate(pair):
            img = build_card_image(student.card_id)
            tmp_path = tempfile.mktemp(suffix=f"_card_{student.card_id}.png")
            cv2.imwrite(tmp_path, img)
            tmp_files[student.card_id] = tmp_path

            x = (page_w - card_size) / 2
            if idx == 0:
                y = page_h / 2 + 5 * mm
            else:
                y = 5 * mm

            c.drawImage(tmp_path, x, y, width=card_size, height=card_size)
            draw_crop_marks(c, x, y, card_size, card_size)

        c.setStrokeColorRGB(0.8, 0.8, 0.8)
        c.setDash(3, 3)
        c.line(20 * mm, page_h / 2, page_w - 20 * mm, page_h / 2)
        c.setDash()
        c.showPage()

        for idx, student in enumerate(pair):
            x = (page_w - card_size) / 2
            if idx == 0:
                y_bottom = page_h / 2 + 5 * mm
            else:
                y_bottom = 5 * mm
            y_center = y_bottom + card_size / 2

            c.setFont("Helvetica-Bold", 28)
            c.drawCentredString(page_w / 2, y_center, student.name)

        c.setStrokeColorRGB(0.8, 0.8, 0.8)
        c.setDash(3, 3)
        c.line(20 * mm, page_h / 2, page_w - 20 * mm, page_h / 2)
        c.setDash()
        c.showPage()

    c.save()

    for p in tmp_files.values():
        Path(p).unlink(missing_ok=True)

    buf.seek(0)
    filename = f"CardVote_{cls.name}.pdf"
    return StreamingResponse(
        buf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
