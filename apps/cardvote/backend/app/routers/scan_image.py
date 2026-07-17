"""Server-side ArUco marker detection from camera images."""
import base64
import math
from typing import List

import cv2
import numpy as np
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from ..database import get_db
from ..models import Scan, Session, User
from .auth import get_current_user
from .. import websocket as ws

router = APIRouter(prefix="/api", tags=["scan"])

ARUCO_DICT = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_6X6_50)
ARUCO_PARAMS = cv2.aruco.DetectorParameters()
DETECTOR = cv2.aruco.ArucoDetector(ARUCO_DICT, ARUCO_PARAMS)


class DetectedCard(BaseModel):
    marker_id: int
    answer: str
    confidence: float
    corners: List[List[float]]


MAX_IMAGE_B64_LEN = 5 * 1024 * 1024


class ScanImageRequest(BaseModel):
    session_id: int
    image: str
    save: bool = True

    @field_validator("image")
    @classmethod
    def limit_image_size(cls, v):
        if len(v) > MAX_IMAGE_B64_LEN:
            raise ValueError("Bild zu gross")
        return v


class ScanImageResponse(BaseModel):
    cards: List[DetectedCard]


def angle_from_corners(corners: np.ndarray) -> float:
    """Compute rotation angle of an ArUco marker from its 4 corners.

    corners shape: (4, 2) — TL, TR, BR, BL in the marker's canonical orientation.
    We measure how much the marker is rotated relative to "upright".
    """
    tl, tr, br, bl = corners
    # Vector from left side midpoint to right side midpoint
    right = ((tr + br) / 2) - ((tl + bl) / 2)
    angle_deg = math.degrees(math.atan2(right[1], right[0]))
    return angle_deg


def answer_from_angle(degrees: float) -> str:
    """Map rotation to answer. 0° = A (top), 90° = D (left), 180° = C, 270° = B (right).
    atan2 with screen coords (Y-down) flips B/D, so we swap them here.
    """
    normalized = (degrees % 360 + 360) % 360
    if normalized < 45 or normalized >= 315:
        return "A"
    elif normalized < 135:
        return "D"
    elif normalized < 225:
        return "C"
    else:
        return "B"


def detect_markers(image_bytes: bytes) -> List[DetectedCard]:
    nparr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        return []

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    corners_list, ids, _ = DETECTOR.detectMarkers(gray)

    if ids is None:
        return []

    h, w = img.shape[:2]
    results = []
    for i, marker_id in enumerate(ids.flatten()):
        corners = corners_list[i][0]  # shape (4, 2)
        angle = angle_from_corners(corners)
        answer = answer_from_angle(angle)
        norm_corners = [[float(c[0]) / w, float(c[1]) / h] for c in corners]
        results.append(DetectedCard(
            marker_id=int(marker_id),
            answer=answer,
            confidence=0.95,
            corners=norm_corners,
        ))
    return results


@router.post("/scan-image", response_model=ScanImageResponse)
async def scan_image(body: ScanImageRequest, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    image_data = body.image
    if "," in image_data:
        image_data = image_data.split(",", 1)[1]
    image_bytes = base64.b64decode(image_data)

    cards = detect_markers(image_bytes)

    if not body.save:
        return ScanImageResponse(cards=cards)

    session = await db.get(Session, body.session_id)
    if session and session.owner_id and session.owner_id != user.id:
        raise HTTPException(403)
    if session and session.current_question_id:
        for card in cards:
            existing = await db.execute(
                select(Scan).where(
                    Scan.session_id == body.session_id,
                    Scan.question_id == session.current_question_id,
                    Scan.student_id == card.marker_id,
                )
            )
            scan = existing.scalar_one_or_none()
            if scan:
                scan.answer = card.answer
            else:
                scan = Scan(
                    session_id=body.session_id,
                    question_id=session.current_question_id,
                    student_id=card.marker_id,
                    answer=card.answer,
                )
                db.add(scan)

            await ws.broadcast(body.session_id, {
                "type": "scan",
                "student_id": card.marker_id,
                "answer": card.answer,
                "question_id": session.current_question_id,
            })

        if cards:
            await db.commit()
            from collections import Counter
            all_scans = await db.execute(
                select(Scan).where(
                    Scan.session_id == body.session_id,
                    Scan.question_id == session.current_question_id,
                )
            )
            counts = Counter(s.answer for s in all_scans.scalars().all())
            await ws.broadcast(body.session_id, {
                "type": "results",
                "question_id": session.current_question_id,
                "counts": {k: counts.get(k, 0) for k in "ABCD"},
            })

    return ScanImageResponse(cards=cards)


class ConfirmScanRequest(BaseModel):
    session_id: int
    scans: list  # [{"marker_id": int, "answer": str}]


@router.post("/scan-confirm")
async def confirm_scans(body: ConfirmScanRequest, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    session = await db.get(Session, body.session_id)
    if not session:
        raise HTTPException(404)
    if session.owner_id and session.owner_id != user.id:
        raise HTTPException(403)
    if not session.current_question_id:
        return {"ok": True}

    for item in body.scans:
        mid = item["marker_id"]
        answer = item["answer"]
        existing = await db.execute(
            select(Scan).where(
                Scan.session_id == body.session_id,
                Scan.question_id == session.current_question_id,
                Scan.student_id == mid,
            )
        )
        scan = existing.scalar_one_or_none()
        if scan:
            scan.answer = answer
        else:
            scan = Scan(
                session_id=body.session_id,
                question_id=session.current_question_id,
                student_id=mid,
                answer=answer,
            )
            db.add(scan)

        await ws.broadcast(body.session_id, {
            "type": "scan",
            "student_id": mid,
            "answer": answer,
            "question_id": session.current_question_id,
        })

    if body.scans:
        await db.commit()
        from collections import Counter
        all_scans_result = await db.execute(
            select(Scan).where(
                Scan.session_id == body.session_id,
                Scan.question_id == session.current_question_id,
            )
        )
        counts = Counter(s.answer for s in all_scans_result.scalars().all())
        await ws.broadcast(body.session_id, {
            "type": "results",
            "question_id": session.current_question_id,
            "counts": {k: counts.get(k, 0) for k in "ABCD"},
        })

    return {"ok": True}
