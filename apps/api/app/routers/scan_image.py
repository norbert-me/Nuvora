"""Server-side ArUco marker detection from camera images."""
import base64
import math
from typing import List

import cv2
import numpy as np
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, field_validator
from starlette.concurrency import run_in_threadpool
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from ..database import get_db
from ..models import Scan, Session, User
from ..uploads import bildtyp
from .auth import get_current_user
from .. import websocket as ws
from .modules import modul_pflicht

CARDVOTE = Depends(modul_pflicht("cardvote"))

router = APIRouter(prefix="/api", tags=["scan"], dependencies=[CARDVOTE])

ARUCO_DICT = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_6X6_50)
ARUCO_PARAMS = cv2.aruco.DetectorParameters()
DETECTOR = cv2.aruco.ArucoDetector(ARUCO_DICT, ARUCO_PARAMS)


class DetectedCard(BaseModel):
    marker_id: int
    answer: str
    confidence: float
    corners: List[List[float]]


MAX_IMAGE_B64_LEN = 5 * 1024 * 1024
# Rohdaten sind ein Viertel kleiner als ihre base64-Fassung — dieselbe Grenze,
# nur ohne die Aufblaehung mitzuzaehlen.
MAX_IMAGE_BYTES = MAX_IMAGE_B64_LEN * 3 // 4


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


def zuversicht(degrees: float) -> float:
    """Wie eindeutig lag die Karte?

    Die Zuordnung viertelt den Kreis: bei 44 Grad Schieflage kommt A heraus, bei
    45 Grad D. Im Unterricht haelt niemand die Karte exakt gerade — eine Karte,
    die knapp an dieser Kante lag, ist ein Kandidat fuer eine Verwechslung, und
    die Lehrkraft soll das sehen koennen.

    Frueher stand hier fest 0.95, egal ob die Karte gerade oder 44 Grad schief
    gehalten wurde. Die Zahl war damit wertlos, obwohl sie im Antwortmodell
    genau dafuer vorgesehen ist.

    0 Grad Abweichung -> 1.0, 45 Grad (die Kante) -> 0.0.
    """
    normalized = (degrees % 360 + 360) % 360
    abweichung = min(abs(normalized - viertel) for viertel in (0, 90, 180, 270, 360))
    return round(max(0.0, 1.0 - abweichung / 45.0), 3)


def detect_markers(image_bytes: bytes) -> List[DetectedCard]:
    nparr = np.frombuffer(image_bytes, np.uint8)
    # Direkt grau dekodieren, nicht farbig und dann umrechnen: die Erkennung
    # arbeitet ausschliesslich auf Graustufen. IMREAD_COLOR baute erst ein
    # Bild mit drei Kanaelen (bei 1280x720 rund 2,7 MB) und cvtColor danach
    # ein zweites — pro Bild, und der Scanner schickt mehrere pro Sekunde.
    # IMREAD_GRAYSCALE spart beides: ein Drittel Speicher, kein Umrechnen.
    img = cv2.imdecode(nparr, cv2.IMREAD_GRAYSCALE)
    if img is None:
        return []

    corners_list, ids, _ = DETECTOR.detectMarkers(img)

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
            confidence=zuversicht(angle),
            corners=norm_corners,
        ))
    return results


async def _erkenne_und_speichere(image_bytes: bytes, session_id: int, save: bool,
                                user: User, db: AsyncSession) -> ScanImageResponse:
    """Gemeinsamer Weg fuer beide Aufnahme-Endpunkte (JSON und rohes Bild)."""
    # Erst den Dateityp pruefen, dann erkennen. Vorher entschied cv2.imdecode,
    # und bei einer kaputten Aufnahme kam eine LEERE Kartenliste mit HTTP 200
    # zurueck — fuer die Lehrkraft nicht zu unterscheiden von "niemand hat eine
    # Karte hochgehalten". uploads.bildtyp() ist genau dafuer da und wird auf
    # allen anderen Bildwegen (Schuelerfoto, Kartenbild) auch benutzt.
    bildtyp(image_bytes)

    # In den Threadpool: Dekodieren und Markererkennung sind reine Rechenarbeit
    # (OpenCV, kein await). Direkt in der Coroutine blockierten sie die ganze
    # Ereignisschleife — waehrend ein Bild lief, wartete JEDE andere Anfrage an
    # den Server, und der Scanner schickt mehrere Bilder pro Sekunde.
    cards = await run_in_threadpool(detect_markers, image_bytes)

    if not save:
        return ScanImageResponse(cards=cards)

    session = await db.get(Session, session_id)
    if session and session.owner_id and session.owner_id != user.id:
        raise HTTPException(403)
    if session and session.current_question_id:
        # Alle vorhandenen Scans dieser Frage EINMAL holen statt je Karte eine
        # eigene Abfrage: bei 30 Kindern im Bild waren das 30 Abfragen, wo eine
        # reicht — und das mehrmals pro Sekunde.
        vorhanden = {
            s.student_id: s
            for s in (await db.execute(
                select(Scan).where(
                    Scan.session_id == session_id,
                    Scan.question_id == session.current_question_id,
                )
            )).scalars().all()
        }
        for card in cards:
            scan = vorhanden.get(card.marker_id)
            if scan:
                scan.answer = card.answer
            else:
                scan = Scan(
                    session_id=session_id,
                    question_id=session.current_question_id,
                    student_id=card.marker_id,
                    answer=card.answer,
                )
                db.add(scan)
                vorhanden[card.marker_id] = scan

            await ws.broadcast(session_id, {
                "type": "scan",
                "student_id": card.marker_id,
                "answer": card.answer,
                "question_id": session.current_question_id,
            })

        if cards:
            await db.commit()
            # Aus dem schon geladenen Stand zaehlen — die Zeilen sind dieselben,
            # die oben gelesen und gerade geschrieben wurden. Eine zweite
            # Abfrage ueber alle Scans der Frage kostete nur Zeit.
            from collections import Counter
            counts = Counter(s.answer for s in vorhanden.values())
            await ws.broadcast(session_id, {
                "type": "results",
                "question_id": session.current_question_id,
                "counts": {k: counts.get(k, 0) for k in "ABCD"},
            })

    return ScanImageResponse(cards=cards)


@router.post("/scan-image", response_model=ScanImageResponse)
async def scan_image(body: ScanImageRequest, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    image_data = body.image
    if "," in image_data:
        image_data = image_data.split(",", 1)[1]
    try:
        image_bytes = base64.b64decode(image_data, validate=False)
    except Exception:
        # Abgeschnittener Upload: vorher lief die binascii-Ausnahme ungefangen
        # durch und wurde zu HTTP 500 — als waere der Server kaputt.
        raise HTTPException(400, "Das Bild ist unvollstaendig angekommen. Bitte noch einmal aufnehmen.")

    return await _erkenne_und_speichere(image_bytes, body.session_id, body.save, user, db)


@router.post("/scan-image-raw", response_model=ScanImageResponse)
async def scan_image_raw(request: Request, session_id: int, save: bool = True,
                         user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Dasselbe, aber das Bild kommt als Rohdaten im Rumpf statt als base64.

    Der Scanner schickt im Betrieb mehrere Bilder pro Sekunde. base64 blaeht
    jedes um ein Drittel auf (und muss auf beiden Seiten umgerechnet werden) —
    ueber eine Unterrichtsstunde sind das hunderte Megabyte umsonst, im
    Schulnetz ueber WLAN der teuerste Weg im ganzen Werkzeug. Der alte
    JSON-Endpunkt bleibt daneben stehen: aeltere Clients (und die Desktop-App
    mit ihrem Zwischenspeicher) rufen ihn weiter auf.
    """
    image_bytes = await request.body()
    if not image_bytes:
        raise HTTPException(400, "Das Bild ist unvollstaendig angekommen. Bitte noch einmal aufnehmen.")
    if len(image_bytes) > MAX_IMAGE_BYTES:
        raise HTTPException(400, "Bild zu gross")

    return await _erkenne_und_speichere(image_bytes, session_id, save, user, db)


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

    # Wie oben: einmal lesen statt je Karte einmal.
    vorhanden = {
        s.student_id: s
        for s in (await db.execute(
            select(Scan).where(
                Scan.session_id == body.session_id,
                Scan.question_id == session.current_question_id,
            )
        )).scalars().all()
    }

    for item in body.scans:
        mid = item["marker_id"]
        answer = item["answer"]
        # Die Kartennummer ist die aufgedruckte ArUco-Nummer: DICT_6X6_50 kennt
        # 0..49. Die Erkennung kann gar nichts anderes liefern und der
        # Kartendruck nichts anderes erzeugen — aber dieser Endpunkt nimmt die
        # Liste vom Client entgegen, und Scan.student_id ist ein blankes
        # Integer ohne Fremdschluessel. Ohne diese Pruefung landete
        # {"marker_id": 999} still in der Wertung.
        if not isinstance(mid, int) or isinstance(mid, bool) or not (0 <= mid <= 49):
            raise HTTPException(400, f"Ungueltige Kartennummer {mid!r} (erlaubt: 0-49)")
        if answer not in ("A", "B", "C", "D", ""):
            raise HTTPException(400, f"Ungueltige Antwort {answer!r}")
        scan = vorhanden.get(mid)
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
            vorhanden[mid] = scan

        await ws.broadcast(body.session_id, {
            "type": "scan",
            "student_id": mid,
            "answer": answer,
            "question_id": session.current_question_id,
        })

    if body.scans:
        await db.commit()
        from collections import Counter
        counts = Counter(s.answer for s in vorhanden.values())
        await ws.broadcast(body.session_id, {
            "type": "results",
            "question_id": session.current_question_id,
            "counts": {k: counts.get(k, 0) for k in "ABCD"},
        })

    return {"ok": True}
