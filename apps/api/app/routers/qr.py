"""QR-Bild zu einem Link — fuer alles, was die Lehrkraft weitergibt (Waage, PAP,
Kalender-Abo …). Nur mit Anmeldung, nur http(s)-Adressen und begrenzt in Laenge
und Haeufigkeit: ein offener QR-Erzeuger waere ein Werkzeug fuer fremde Zwecke."""
import io

import qrcode
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response

from ..models import User
from .auth import get_current_user, rate_limit

router = APIRouter(prefix="/api/qr", tags=["qr"])

MAX_LAENGE = 1000


@router.get("")
async def qr_bild(text: str, user: User = Depends(get_current_user)):
    rate_limit("qr", f"u{user.id}", 120, 60, "Zu viele QR-Codes. Bitte kurz warten.")
    text = (text or "").strip()
    if not text or len(text) > MAX_LAENGE or not text.lower().startswith(("http://", "https://", "webcal://")):
        raise HTTPException(400, "Nur Links (http, https oder webcal) lassen sich als QR-Code zeigen")
    buf = io.BytesIO()
    qrcode.make(text).save(buf, format="PNG")
    return Response(content=buf.getvalue(), media_type="image/png",
                    headers={"Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff"})
