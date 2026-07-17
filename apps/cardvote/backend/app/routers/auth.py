"""Authentication: register, login, profile, admin user management, password reset."""
import base64
import hashlib
import hmac
import os
import secrets
import time
from collections import defaultdict
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import User
from .. import mailer

RESET_TTL = 3600  # Passwort-Reset-Link 1 Stunde gültig
SITE_URL = os.environ.get("SITE_URL", "").rstrip("/")

router = APIRouter(prefix="/api/auth", tags=["auth"])

SECRET = os.environ.get("TOKEN_SECRET", secrets.token_hex(32))
TOKEN_TTL = 86400 * 7

# Rate limiting: {ip: [(timestamp, ...)]}
_login_attempts: dict[str, list[float]] = defaultdict(list)
MAX_LOGIN_ATTEMPTS = 5
LOGIN_WINDOW = 60


def _hash_pw(password: str) -> str:
    salt = secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 100_000)
    return f"{salt}${h.hex()}"


def _verify_pw(password: str, stored: str) -> bool:
    salt, h = stored.split("$", 1)
    return hmac.compare_digest(
        hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 100_000).hex(),
        h,
    )


def _make_token(user_id: int, token_version: int = 0) -> str:
    ts = int(time.time())
    payload = f"{user_id}:{token_version}:{ts}"
    sig = hmac.new(SECRET.encode(), payload.encode(), "sha256").hexdigest()[:32]
    return f"{payload}:{sig}"


def _verify_token(token: str) -> Optional[tuple[int, int]]:
    try:
        parts = token.rsplit(":", 1)
        if len(parts) != 2:
            return None
        payload, sig = parts
        expected = hmac.new(SECRET.encode(), payload.encode(), "sha256").hexdigest()[:32]
        if not hmac.compare_digest(sig, expected):
            return None
        segments = payload.split(":")
        if len(segments) == 3:
            user_id, tv, ts = segments
            return int(user_id), int(tv), int(ts)
        elif len(segments) == 2:
            user_id, ts = segments
            return int(user_id), 0, int(ts)
        return None
    except Exception:
        return None


def _make_reset_token(user: User) -> str:
    ts = int(time.time())
    payload = f"{user.id}:{ts}"
    # An password_hash gebunden: nach dem Zurücksetzen ändert sich der Hash → Token ungültig (einmalig)
    sig = hmac.new(SECRET.encode(), (payload + user.password_hash).encode(), "sha256").hexdigest()[:32]
    raw = f"{payload}:{sig}"
    return base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")


def _decode_reset_token(token: str):
    try:
        pad = "=" * (-len(token) % 4)
        raw = base64.urlsafe_b64decode(token + pad).decode()
        user_id, ts, sig = raw.split(":")
        return int(user_id), int(ts), sig
    except Exception:
        return None


def _make_verify_token(user: User) -> str:
    sig = hmac.new(SECRET.encode(), f"verify:{user.id}:{user.email}".encode(), "sha256").hexdigest()[:32]
    return base64.urlsafe_b64encode(f"{user.id}:{sig}".encode()).decode().rstrip("=")


def _decode_verify_token(token: str):
    try:
        pad = "=" * (-len(token) % 4)
        raw = base64.urlsafe_b64decode(token + pad).decode()
        user_id, sig = raw.split(":")
        return int(user_id), sig
    except Exception:
        return None


def _make_email_change_token(user: User) -> str:
    sig = hmac.new(SECRET.encode(), f"emailchange:{user.id}:{user.pending_email}".encode(), "sha256").hexdigest()[:32]
    return base64.urlsafe_b64encode(f"{user.id}:{sig}".encode()).decode().rstrip("=")


def _decode_email_change_token(token: str):
    try:
        pad = "=" * (-len(token) % 4)
        raw = base64.urlsafe_b64decode(token + pad).decode()
        user_id, sig = raw.split(":")
        return int(user_id), sig
    except Exception:
        return None


async def _send_verify_mail(user: User):
    token = _make_verify_token(user)
    link = f"{SITE_URL}/verify-email?token={token}" if SITE_URL else f"/verify-email?token={token}"
    await mailer.send_email(
        user.email,
        "CardVote — E-Mail bestätigen",
        "Hallo,\n\n"
        "bitte bestätige deine E-Mail-Adresse, um dein CardVote-Konto zu aktivieren:\n\n"
        f"{link}\n\n"
        "Wichtig: Wird die Adresse nicht innerhalb von 14 Tagen bestätigt, wird das Konto automatisch gelöscht.\n\n"
        "Viele Grüße\nDein CardVote-Team",
    )


async def get_current_user(request: Request, db: AsyncSession = Depends(get_db)) -> User:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(401, "Nicht angemeldet")
    result = _verify_token(auth[7:])
    if result is None:
        raise HTTPException(401, "Token ungültig oder abgelaufen")
    user_id, tv, ts = result
    if int(time.time()) - ts > TOKEN_TTL:
        raise HTTPException(401, "Token abgelaufen")
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(401, "Konto nicht gefunden")
    if tv != user.token_version:
        raise HTTPException(401, "Token wurde ungültig – bitte neu anmelden")
    return user


def _check_rate_limit(ip: str):
    now = time.time()
    attempts = _login_attempts[ip]
    _login_attempts[ip] = [t for t in attempts if now - t < LOGIN_WINDOW]
    if len(_login_attempts[ip]) >= MAX_LOGIN_ATTEMPTS:
        raise HTTPException(429, "Zu viele Anmeldeversuche. Bitte warte eine Minute.")
    _login_attempts[ip].append(now)


# Generischer, wiederverwendbarer Sliding-Window-Limiter (pro IP + Bucket)
_buckets: dict[str, list[float]] = defaultdict(list)


def client_ip(request: Request) -> str:
    # X-Real-IP zuerst: wird von UNSEREM nginx aus $remote_addr gesetzt (nicht spoofbar).
    # X-Forwarded-For kaeme direkt vom Client durch und liesse sich faelschen -> Rate-Limit-Bypass.
    real = request.headers.get("X-Real-IP")
    if real:
        return real.strip()
    xff = request.headers.get("X-Forwarded-For", "")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def rate_limit(bucket: str, ip: str, max_hits: int, window: int, msg: str = "Zu viele Anfragen. Bitte kurz warten."):
    now = time.time()
    key = f"{bucket}:{ip}"
    hits = [t for t in _buckets[key] if now - t < window]
    if len(hits) >= max_hits:
        hits_sorted = sorted(hits)
        retry = max(1, int(window - (now - hits_sorted[0])))
        _buckets[key] = hits
        raise HTTPException(429, msg, headers={"Retry-After": str(retry)})
    hits.append(now)
    _buckets[key] = hits


class LoginBody(BaseModel):
    email: str
    password: str

    @field_validator("password")
    @classmethod
    def pw_max_length(cls, v):
        if len(v) > 256:
            raise ValueError("Passwort zu lang")
        return v


class RegisterBody(BaseModel):
    email: str
    password: str
    name: str = ""
    salutation: str = "Hr."

    @field_validator("password")
    @classmethod
    def pw_length(cls, v):
        if len(v) < 8:
            raise ValueError("Passwort muss mindestens 8 Zeichen lang sein")
        if len(v) > 256:
            raise ValueError("Passwort zu lang (max. 256 Zeichen)")
        return v

    @field_validator("email")
    @classmethod
    def valid_email(cls, v):
        v = v.strip().lower()
        if "@" not in v or len(v) > 254:
            raise ValueError("Ungültige E-Mail")
        return v

    @field_validator("name")
    @classmethod
    def name_length(cls, v):
        if len(v) > 200:
            raise ValueError("Name zu lang")
        return v


class ChangePasswordBody(BaseModel):
    old_password: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def pw_min_length(cls, v):
        if len(v) < 8:
            raise ValueError("Passwort muss mindestens 8 Zeichen lang sein")
        if len(v) > 256:
            raise ValueError("Passwort zu lang (max. 256 Zeichen)")
        return v


class UpdateProfileBody(BaseModel):
    name: str
    salutation: str
    grade_scale: Optional[dict] = None
    marketplace_name: Optional[str] = None

    @field_validator("name")
    @classmethod
    def name_length(cls, v):
        if len(v.strip()) > 200:
            raise ValueError("Name zu lang")
        return v

    @field_validator("salutation")
    @classmethod
    def valid_salutation(cls, v):
        if v not in ("Hr.", "Fr.", ""):
            raise ValueError("Ungültige Anrede")
        return v


def _user_dict(user):
    display = f"{user.salutation} {user.name}".strip() if user.salutation else user.name
    return {
        "id": user.id, "email": user.email, "name": user.name, "salutation": user.salutation,
        "display_name": display or user.email, "grade_scale": user.grade_scale,
        "marketplace_name": getattr(user, "marketplace_name", "") or "",
        "pending_email": getattr(user, "pending_email", None),
    }


@router.post("/login")
async def login(body: LoginBody, request: Request, db: AsyncSession = Depends(get_db)):
    ip = request.headers.get("X-Real-IP", request.client.host if request.client else "unknown")
    _check_rate_limit(ip)
    result = await db.execute(select(User).where(User.email == body.email.lower().strip()))
    user = result.scalar_one_or_none()
    if not user or not _verify_pw(body.password, user.password_hash):
        raise HTTPException(401, "E-Mail oder Passwort falsch")
    if not user.email_verified:
        raise HTTPException(403, "E-Mail noch nicht bestätigt. Bitte prüfe dein Postfach (auch Spam).")
    return {"token": _make_token(user.id, user.token_version), "user": _user_dict(user)}


@router.post("/register")
async def register(body: RegisterBody, request: Request, db: AsyncSession = Depends(get_db)):
    # Anti-Spam: max. 10 Registrierungen pro IP in 10 Minuten
    rate_limit("register", client_ip(request), 10, 600, "Zu viele Registrierungen. Bitte später erneut versuchen.")
    email = body.email.lower().strip()
    result = await db.execute(select(User).where(User.email == email))
    if result.scalar_one_or_none():
        raise HTTPException(400, "E-Mail bereits registriert")
    user = User(email=email, password_hash=_hash_pw(body.password), name=body.name, salutation=body.salutation, email_verified=False)
    db.add(user)
    await db.commit()
    await db.refresh(user)
    # Bestätigungs-Mail (best-effort). Login erst nach Bestätigung möglich.
    await _send_verify_mail(user)
    return {"ok": True}


@router.post("/change-password")
async def change_password(body: ChangePasswordBody, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if not _verify_pw(body.old_password, user.password_hash):
        raise HTTPException(400, "Altes Passwort falsch")
    user.password_hash = _hash_pw(body.new_password)
    user.token_version = (user.token_version or 0) + 1
    await db.commit()
    return {"ok": True, "token": _make_token(user.id, user.token_version)}


class ForgotPasswordBody(BaseModel):
    email: str


@router.post("/forgot-password")
async def forgot_password(body: ForgotPasswordBody, request: Request, db: AsyncSession = Depends(get_db)):
    # Rate-Limit gegen Missbrauch/E-Mail-Bombing
    rate_limit("forgot", client_ip(request), 5, 600, "Zu viele Anfragen. Bitte später erneut versuchen.")
    email = body.email.lower().strip()
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if user:
        token = _make_reset_token(user)
        link = f"{SITE_URL}/reset-password?token={token}" if SITE_URL else f"/reset-password?token={token}"
        await mailer.send_email(
            user.email,
            "CardVote — Passwort zurücksetzen",
            "Hallo,\n\n"
            "du hast angefordert, dein CardVote-Passwort zurückzusetzen. "
            "Öffne dazu den folgenden Link (1 Stunde gültig):\n\n"
            f"{link}\n\n"
            "Wenn du das nicht warst, kannst du diese E-Mail ignorieren — dein Passwort bleibt unverändert.\n\n"
            "Viele Grüße\nDein CardVote-Team",
        )
    # Keine Auskunft, ob das Konto existiert (kein Account-Enumeration)
    return {"ok": True}


class ResetPasswordBody(BaseModel):
    token: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def pw_length(cls, v):
        if len(v) < 8:
            raise ValueError("Passwort muss mindestens 8 Zeichen lang sein")
        if len(v) > 256:
            raise ValueError("Passwort zu lang (max. 256 Zeichen)")
        return v


@router.post("/reset-password")
async def reset_password(body: ResetPasswordBody, request: Request, db: AsyncSession = Depends(get_db)):
    rate_limit("reset", client_ip(request), 10, 600)
    dec = _decode_reset_token(body.token)
    if not dec:
        raise HTTPException(400, "Ungültiger oder abgelaufener Link")
    user_id, ts, sig = dec
    if int(time.time()) - ts > RESET_TTL:
        raise HTTPException(400, "Der Link ist abgelaufen. Bitte fordere einen neuen an.")
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(400, "Ungültiger Link")
    expected = hmac.new(SECRET.encode(), (f"{user_id}:{ts}" + user.password_hash).encode(), "sha256").hexdigest()[:32]
    if not hmac.compare_digest(sig, expected):
        raise HTTPException(400, "Ungültiger oder bereits verwendeter Link")
    user.password_hash = _hash_pw(body.new_password)
    user.token_version = (user.token_version or 0) + 1  # meldet bestehende Sitzungen ab
    await db.commit()
    return {"ok": True}


class VerifyEmailBody(BaseModel):
    token: str


@router.post("/verify-email")
async def verify_email(body: VerifyEmailBody, request: Request, db: AsyncSession = Depends(get_db)):
    rate_limit("verify", client_ip(request), 20, 600)
    dec = _decode_verify_token(body.token)
    if not dec:
        raise HTTPException(400, "Ungültiger Bestätigungslink")
    user_id, sig = dec
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(400, "Ungültiger Link")
    expected = hmac.new(SECRET.encode(), f"verify:{user.id}:{user.email}".encode(), "sha256").hexdigest()[:32]
    if not hmac.compare_digest(sig, expected):
        raise HTTPException(400, "Ungültiger Bestätigungslink")
    if not user.email_verified:
        user.email_verified = True
        await db.commit()
    return {"ok": True}


class ResendVerifyBody(BaseModel):
    email: str


@router.post("/resend-verification")
async def resend_verification(body: ResendVerifyBody, request: Request, db: AsyncSession = Depends(get_db)):
    rate_limit("resendverify", client_ip(request), 5, 600, "Zu viele Anfragen. Bitte später erneut versuchen.")
    result = await db.execute(select(User).where(User.email == body.email.lower().strip()))
    user = result.scalar_one_or_none()
    if user and not user.email_verified:
        await _send_verify_mail(user)
    return {"ok": True}


class ChangeEmailBody(BaseModel):
    new_email: str
    password: str


@router.post("/change-email")
async def change_email(body: ChangeEmailBody, request: Request, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    rate_limit("changeemail", f"u{user.id}", 5, 3600, "Zu viele Anfragen. Bitte später erneut versuchen.")
    if not _verify_pw(body.password, user.password_hash):
        raise HTTPException(400, "Passwort falsch")
    new_email = body.new_email.lower().strip()
    if "@" not in new_email or len(new_email) > 255:
        raise HTTPException(400, "Ungültige E-Mail-Adresse")
    if new_email == user.email:
        raise HTTPException(400, "Das ist bereits deine aktuelle E-Mail-Adresse")
    result = await db.execute(select(User).where(User.email == new_email))
    if result.scalar_one_or_none():
        raise HTTPException(400, "Diese E-Mail-Adresse wird bereits verwendet")
    user.pending_email = new_email
    await db.commit()
    await db.refresh(user)
    token = _make_email_change_token(user)
    link = f"{SITE_URL}/confirm-email-change?token={token}" if SITE_URL else f"/confirm-email-change?token={token}"
    await mailer.send_email(
        new_email,
        "CardVote — Neue E-Mail-Adresse bestätigen",
        "Hallo,\n\n"
        "bitte bestätige deine neue E-Mail-Adresse für dein CardVote-Konto:\n\n"
        f"{link}\n\n"
        "Wenn du das nicht warst, kannst du diese E-Mail ignorieren — deine bisherige Adresse bleibt gültig.\n\n"
        "Viele Grüße\nDein CardVote-Team",
    )
    return {"ok": True, "pending_email": new_email}


class ConfirmEmailChangeBody(BaseModel):
    token: str


@router.post("/confirm-email-change")
async def confirm_email_change(body: ConfirmEmailChangeBody, request: Request, db: AsyncSession = Depends(get_db)):
    rate_limit("confirmemailchange", client_ip(request), 20, 600)
    dec = _decode_email_change_token(body.token)
    if not dec:
        raise HTTPException(400, "Ungültiger Bestätigungslink")
    user_id, sig = dec
    user = await db.get(User, user_id)
    if not user or not user.pending_email:
        raise HTTPException(400, "Kein offener Änderungswunsch gefunden")
    expected = hmac.new(SECRET.encode(), f"emailchange:{user.id}:{user.pending_email}".encode(), "sha256").hexdigest()[:32]
    if not hmac.compare_digest(sig, expected):
        raise HTTPException(400, "Ungültiger Bestätigungslink")
    # Zieladresse koennte inzwischen von jemand anderem belegt worden sein
    result = await db.execute(select(User).where(User.email == user.pending_email, User.id != user.id))
    if result.scalar_one_or_none():
        raise HTTPException(400, "Diese E-Mail-Adresse wird inzwischen bereits verwendet")
    user.email = user.pending_email
    user.pending_email = None
    user.token_version = (user.token_version or 0) + 1  # meldet bestehende Sitzungen ab
    await db.commit()
    return {"ok": True}


@router.put("/profile")
async def update_profile(body: UpdateProfileBody, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    user.name = body.name.strip()
    user.salutation = body.salutation
    if body.grade_scale is not None:
        user.grade_scale = body.grade_scale
    if body.marketplace_name is not None:
        user.marketplace_name = body.marketplace_name.strip()[:100]
    await db.commit()
    await db.refresh(user)
    return _user_dict(user)


class DeleteAccountBody(BaseModel):
    password: str


@router.post("/delete-account")
async def delete_account(body: DeleteAccountBody, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if user.id == 1:
        # IDs werden nicht wiederverwendet — ohne Konto 1 gaebe es nie wieder Admin-Zugriff
        raise HTTPException(400, "Das Admin-Konto kann nicht gelöscht werden")
    if not _verify_pw(body.password, user.password_hash):
        raise HTTPException(400, "Passwort falsch")
    await db.delete(user)
    await db.commit()
    return {"ok": True}


# --- Admin: user management (first user = admin) ---

@router.get("/admin/users")
async def admin_list_users(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if user.id != 1:
        raise HTTPException(403, "Nur Admin")
    result = await db.execute(select(User).order_by(User.id))
    return [{"id": u.id, "email": u.email, "name": u.name} for u in result.scalars().all()]


@router.delete("/admin/users/{user_id}")
async def admin_delete_user(user_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if user.id != 1:
        raise HTTPException(403, "Nur Admin")
    if user_id == 1:
        raise HTTPException(400, "Admin-Konto kann nicht gelöscht werden")
    target = await db.get(User, user_id)
    if not target:
        raise HTTPException(404)
    await db.delete(target)
    await db.commit()
    return {"ok": True}
