"""Authentication: register, login, profile, admin user management, password reset."""
import base64
import hashlib
import logging
import hmac
import os
import secrets
import time
from collections import defaultdict
from typing import Optional

logger = logging.getLogger(__name__)

from argon2 import PasswordHasher
from argon2.low_level import Type as Argon2Type
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, field_validator
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import User, Question, MarketplaceQuiz
from .. import mailer

UPLOAD_DIR = "/app/uploads"


async def _purge_user_content(db: AsyncSession, user_id: int):
    """Vor dem Löschen eines Kontos ALLE Inhalte tilgen, die die DB-Kaskade nicht
    erfasst: die Marktplatz-Veröffentlichungen der Person (author_id ist SET NULL,
    bliebe sonst verwaist stehen) und ihre hochgeladenen Bilddateien auf der Platte.
    Der Rest hängt an owner_id ON DELETE CASCADE und geht mit dem User-Row."""
    # 1) Bilddateien der eigenen Fragen einsammeln (image_url + choice_images).
    eigene = (await db.execute(select(Question).where(Question.owner_id == user_id))).scalars().all()
    urls = set()
    for q in eigene:
        if q.image_url:
            urls.add(q.image_url)
        if isinstance(q.choice_images, dict):
            urls.update(v for v in q.choice_images.values() if isinstance(v, str))
    # 2) Marktplatz-Veröffentlichungen der Person löschen (Ratings kaskadieren).
    await db.execute(delete(MarketplaceQuiz).where(MarketplaceQuiz.author_id == user_id))
    # 3) Dateien löschen — aber nur, wenn keine fremde Frage sie noch nutzt
    #    (übernommene Kopien referenzieren dieselbe URL, sollen nicht kaputtgehen).
    for url in urls:
        if not url.startswith("/api/uploads/"):
            continue
        andere = (await db.execute(
            select(Question.id).where(Question.owner_id != user_id, Question.image_url == url).limit(1)
        )).scalar_one_or_none()
        if andere:
            continue
        name = url.rsplit("/", 1)[-1]
        if name and "/" not in name and ".." not in name:
            try:
                os.remove(os.path.join(UPLOAD_DIR, name))
            except OSError:
                pass  # Datei schon weg / nicht vorhanden

RESET_TTL = 3600  # Passwort-Reset-Link 1 Stunde gültig
SITE_URL = os.environ.get("SITE_URL", "").rstrip("/")

router = APIRouter(prefix="/api/auth", tags=["auth"])

SECRET = os.environ.get("TOKEN_SECRET", secrets.token_hex(32))
TOKEN_TTL = 86400 * 30  # 30 Tage; per Sliding-Renewal (siehe get_current_user)
                        # bekommt ein aktiver Nutzer laufend einen frischen Token,
                        # laeuft also praktisch nie ab. Nur echtes Nichtstun > 30 Tage
                        # (oder token_version-Wechsel) meldet ab.

# Rate limiting: {ip: [(timestamp, ...)]}
_login_attempts: dict[str, list[float]] = defaultdict(list)
MAX_LOGIN_ATTEMPTS = 5
LOGIN_WINDOW = 60


# ─────────────────────── Passwort-Hashes ───────────────────────
# Standard ist Argon2id. Neue und geaenderte Passwoerter werden nur noch damit
# gehasht; die beiden PBKDF2-Formate bleiben pruefbar, damit sich kein
# Bestandskonto aussperrt, und wandern beim naechsten erfolgreichen Login still
# mit (siehe login()) — nur dort liegt der Klartext vor.
#
# Drei Formate, sauber unterscheidbar:
#   argon2id: "$argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>"  → beginnt mit "$argon2"
#   pbkdf2:   "pbkdf2_sha256$600000$<salt>$<hash>"            → 3 Dollarzeichen
#   ganz alt: "<salt>$<hash>", implizit 100 000 Iterationen   → 1 Dollarzeichen
#
# Warum Argon2id statt mehr PBKDF2-Runden: PBKDF2 braucht kaum Speicher und
# laesst sich deshalb auf GPUs massiv parallel durchprobieren. Argon2id kostet
# den Angreifer pro Versuch echten RAM — genau das, wovon eine Grafikkarte
# wenig hat.
#
# Parameter nach OWASP (Password Storage Cheat Sheet), zweite der dort als
# gleichwertig genannten Kombinationen:
#   time_cost=2, memory_cost=19456 KiB (19 MiB), parallelism=1
# Die erste Variante (m=46 MiB, t=1) ist gleich sicher, kostet aber 46 MiB je
# gleichzeitiger Anmeldung. Wir laufen in einem kleinen Container neben
# Postgres — 19 MiB pro Login ist die Variante, die auch bei mehreren
# Anmeldungen gleichzeitig nicht den Speicher sprengt (10 parallele Logins
# = ~190 MiB Spitze, und das nur fuer die Dauer einer Pruefung).
# parallelism=1, weil der Container wenige Kerne hat und ein zweiter Thread
# je Anmeldung unter Last nichts bringt, ausser sich selbst im Weg zu stehen.
# Gemessen: ~14 ms je Pruefung (PBKDF2 mit 600 000 Runden: ~48 ms) — deutlich
# unter der 100-ms-Grenze, mit Luft fuer eine langsamere Server-CPU.
PW_ALGO = "pbkdf2_sha256"
PW_ITERATIONS = 600_000
PW_ITERATIONS_LEGACY = 100_000
_PW_ITERATIONS_MAX = 10_000_000  # Notbremse gegen einen manipulierten Hash,
                                 # der den Prozess sonst minutenlang rechnen liesse

ARGON2_TIME_COST = 2
ARGON2_MEMORY_COST = 19_456  # KiB = 19 MiB je gleichzeitiger Anmeldung
ARGON2_PARALLELISM = 1
ARGON2_PREFIX = "$argon2"

_hasher = PasswordHasher(
    time_cost=ARGON2_TIME_COST,
    memory_cost=ARGON2_MEMORY_COST,
    parallelism=ARGON2_PARALLELISM,
    hash_len=32,
    salt_len=16,
    type=Argon2Type.ID,
)


def _pbkdf2(password: str, salt: str, iterations: int) -> str:
    return hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), iterations).hex()


def _ist_argon2(stored: str) -> bool:
    """Argon2 bringt sein eigenes Format mit ($argon2id$v=19$m=...). Es faengt
    mit einem Dollarzeichen an, die PBKDF2-Formate nie — daran allein haengt die
    Unterscheidung, bevor ueberhaupt gesplittet wird."""
    return (stored or "").startswith(ARGON2_PREFIX)


def _split_pw(stored: str) -> Optional[tuple[int, str, str]]:
    """PBKDF2: (Iterationen, Salt, Hash) — oder None, wenn der Hash weder das
    neue noch das alte PBKDF2-Format ist (Argon2 eingeschlossen: dafuer ist
    _verify_pw zustaendig).

    Die beiden PBKDF2-Formate werden an der Anzahl der Dollarzeichen unterschieden.
    """
    if _ist_argon2(stored):
        return None
    teile = (stored or "").split("$")
    if len(teile) == 4:  # neues PBKDF2-Format
        algo, iters, salt, h = teile
        if algo != PW_ALGO or not salt or not h or not iters.isdigit():
            return None
        n = int(iters)
        if not 1 <= n <= _PW_ITERATIONS_MAX:
            return None
        return n, salt, h
    if len(teile) == 2:  # ganz altes Format, feste Iterationszahl
        salt, h = teile
        if not salt or not h:
            return None
        return PW_ITERATIONS_LEGACY, salt, h
    return None


def _hash_pbkdf2(password: str, iterations: int = PW_ITERATIONS) -> str:
    """Nur noch fuer Tests und zum Nachstellen von Bestandshashes — produktiv
    wird ausschliesslich Argon2id geschrieben."""
    salt = secrets.token_hex(16)
    return f"{PW_ALGO}${iterations}${salt}${_pbkdf2(password, salt, iterations)}"


def _hash_pw(password: str) -> str:
    return _hasher.hash(password)


def _verify_pw(password: str, stored: str) -> bool:
    # Ein beschaedigter oder leerer Hash darf nicht in einen Fehler laufen: das
    # waere HTTP 500 statt "Passwort falsch" — und verriete beim Ausprobieren,
    # dass mit genau diesem Konto etwas nicht stimmt. Argon2 wirft bei kaputtem
    # String (InvalidHash) genauso wie bei falschem Passwort (VerifyMismatch),
    # deshalb faengt der Block bewusst alles ab.
    if _ist_argon2(stored):
        try:
            return _hasher.verify(stored, password)
        except Exception:
            return False
    zerlegt = _split_pw(stored)
    if not zerlegt:
        return False
    iterations, salt, h = zerlegt
    return hmac.compare_digest(_pbkdf2(password, salt, iterations), h)


def _pw_veraltet(stored: str) -> bool:
    """Muss der Hash beim naechsten Login neu geschrieben werden? Das gilt fuer
    beide PBKDF2-Formate und fuer Argon2-Hashes mit schwaecheren Parametern als
    den heutigen (z. B. nach einer spaeteren Erhoehung)."""
    if _ist_argon2(stored):
        try:
            return bool(_hasher.check_needs_rehash(stored))
        except Exception:
            return False  # unbrauchbar — _verify_pw laesst hier ohnehin niemanden durch
    return _split_pw(stored) is not None


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
        "Nuvora — E-Mail bestätigen",
        "Hallo,\n\n"
        "bitte bestätige deine E-Mail-Adresse, um dein Nuvora-Konto zu aktivieren:\n\n"
        f"{link}\n\n"
        "Wichtig: Wird die Adresse nicht innerhalb von 14 Tagen bestätigt, wird das Konto automatisch gelöscht.\n\n"
        "Viele Grüße\nDein Nuvora-Team",
    )


async def get_current_user(request: Request, response: Response, db: AsyncSession = Depends(get_db)) -> User:
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
    # Sliding-Renewal: ist der Token ueber die halbe TTL alt, einen frischen
    # per Header mitschicken. Der Client (fetch-Interceptor) speichert ihn, so
    # verlaengert sich das Fenster bei jeder Nutzung — aktive Konten fliegen
    # nicht mehr nach fester Frist raus.
    if int(time.time()) - ts > TOKEN_TTL // 2:
        response.headers["X-Refresh-Token"] = _make_token(user.id, user.token_version)
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
    grade_tendency: Optional[bool] = None
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
        "display_name": display or user.email, "grade_scale": user.grade_scale, "grade_tendency": user.grade_tendency,
        "marketplace_name": getattr(user, "marketplace_name", "") or "",
        "pending_email": getattr(user, "pending_email", None),
    }


@router.get("/me")
async def me(user: User = Depends(get_current_user)):
    """Aktuellen Nutzer aus dem Token auflösen. Die Shell ruft das beim Laden
    auf, um zu prüfen, dass das localStorage-Token noch gültig ist — sonst wird
    einer Seite vertraut, deren Token längst abgelaufen/widerrufen ist."""
    return _user_dict(user)


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
    if _pw_veraltet(user.password_hash):
        # Genau hier — und nur hier — liegt der Klartext vor: still auf das
        # aktuelle Verfahren heben. token_version bleibt bewusst unveraendert,
        # sonst wuerde eine Anmeldung alle anderen Sitzungen abmelden.
        user.password_hash = _hash_pw(body.password)
        await db.commit()
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

    # Beispielinhalt anlegen: ein leeres Konto zeigt nicht, was das Werkzeug
    # kann. Best-effort — scheitert das, ist das Konto trotzdem gueltig; eine
    # Registrierung darf nicht an einer Demo haengen.
    try:
        from ..seed import seed_new_account
        await seed_new_account(db, user.id)
    except Exception as e:
        logger.warning("Beispielinhalt für %s konnte nicht angelegt werden: %s", user.id, e)
        await db.rollback()

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
            "Nuvora — Passwort zurücksetzen",
            "Hallo,\n\n"
            "du hast angefordert, dein Nuvora-Passwort zurückzusetzen. "
            "Öffne dazu den folgenden Link (1 Stunde gültig):\n\n"
            f"{link}\n\n"
            "Wenn du das nicht warst, kannst du diese E-Mail ignorieren — dein Passwort bleibt unverändert.\n\n"
            "Viele Grüße\nDein Nuvora-Team",
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
    # Nur im Speicher setzen — der Token braucht kein Commit, er signiert
    # user.id + pending_email. So koennen wir erst die Mail versenden und die
    # Aenderung nur festschreiben, wenn sie zugestellt werden konnte.
    user.pending_email = new_email
    token = _make_email_change_token(user)
    link = f"{SITE_URL}/confirm-email-change?token={token}" if SITE_URL else f"/confirm-email-change?token={token}"
    sent = await mailer.send_email(
        new_email,
        "Nuvora — Neue E-Mail-Adresse bestätigen",
        "Hallo,\n\n"
        "bitte bestätige deine neue E-Mail-Adresse für dein Nuvora-Konto:\n\n"
        f"{link}\n\n"
        "Wenn du das nicht warst, kannst du diese E-Mail ignorieren — deine bisherige Adresse bleibt gültig.\n\n"
        "Viele Grüße\nDein Nuvora-Team",
    )
    # Ohne zustellbare Bestaetigungsmail darf die Adresse nicht wechseln:
    # sonst haengt ein pending_email fest, das nie bestaetigt werden kann.
    if not sent:
        await db.rollback()
        raise HTTPException(503, "Die Bestätigungs-Mail konnte nicht versendet werden. Bitte den Betreiber kontaktieren. Die E-Mail-Adresse wurde nicht geändert.")
    await db.commit()
    return {"ok": True, "pending_email": new_email, "email_sent": True}


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
    if body.grade_tendency is not None:
        user.grade_tendency = bool(body.grade_tendency)
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
    await _purge_user_content(db, user.id)
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
    await _purge_user_content(db, target.id)
    await db.delete(target)
    await db.commit()
    return {"ok": True}
