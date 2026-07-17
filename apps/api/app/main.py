import os

import asyncio
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .database import engine
from .models import Base
from .routers import questions, sessions, results, scan_image, classes, folders, cards, export_import, auth, marketplace, modules, topics, lernpfad
from . import websocket as ws

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
import time as _time
from collections import defaultdict as _defaultdict


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        return response


# --- Missbrauchsschutz: Body-Grösse + globaler Flood-Schutz pro IP ---
MAX_BODY_BYTES = int(os.environ.get("MAX_BODY_BYTES", 24 * 1024 * 1024))
# Grosszügig, da ganze Klassen/Schulen oft hinter EINER öffentlichen IP (NAT) hängen
GLOBAL_RATE_MAX = int(os.environ.get("GLOBAL_RATE_MAX", 3000))
GLOBAL_RATE_WINDOW = int(os.environ.get("GLOBAL_RATE_WINDOW", 60))
_global_hits: dict[str, list] = _defaultdict(list)


def _req_ip(request) -> str:
    # X-Real-IP zuerst (von unserem nginx gesetzt, nicht spoofbar) — siehe client_ip in auth.py
    real = request.headers.get("X-Real-IP")
    if real:
        return real.strip()
    xff = request.headers.get("X-Forwarded-For", "")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


class AbuseGuardMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        # 1) Body-Grösse begrenzen (Schutz vor Speicher-Erschöpfung)
        cl = request.headers.get("Content-Length")
        if cl:
            try:
                if int(cl) > MAX_BODY_BYTES:
                    return JSONResponse(status_code=413, content={"detail": "Anfrage zu gross"})
            except ValueError:
                pass
        # 2) Globaler Flood-Schutz pro IP (nur /api/, ohne Health)
        path = request.url.path
        if path.startswith("/api/") and path != "/api/health":
            ip = _req_ip(request)
            now = _time.time()
            hits = [t for t in _global_hits[ip] if now - t < GLOBAL_RATE_WINDOW]
            if len(hits) >= GLOBAL_RATE_MAX:
                _global_hits[ip] = hits
                return JSONResponse(status_code=429, content={"detail": "Zu viele Anfragen"}, headers={"Retry-After": str(GLOBAL_RATE_WINDOW)})
            hits.append(now)
            _global_hits[ip] = hits
        return await call_next(request)


app = FastAPI(title="Nuvora API")

app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(AbuseGuardMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("CORS_ORIGINS", "http://localhost:3001").split(","),
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Content-Type", "Authorization"],
)

app.include_router(questions.router)
app.include_router(sessions.router)
app.include_router(results.router)
app.include_router(scan_image.router)
app.include_router(classes.router)
app.include_router(folders.router)
app.include_router(cards.router)
app.include_router(export_import.router)
app.include_router(auth.router)
app.include_router(modules.router)
app.include_router(topics.router)
app.include_router(lernpfad.router)
app.include_router(marketplace.router)

UPLOAD_DIR = "/app/uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)
app.mount("/api/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")


def _ensure_columns(sync_conn):
    """Additive Migration: fehlende Spalten auf bestehenden Tabellen ergaenzen (kein Datenverlust)."""
    from sqlalchemy import inspect as sa_inspect, text
    inspector = sa_inspect(sync_conn)
    existing_tables = inspector.get_table_names()
    # (Tabelle, Spalte, DDL-Typ inkl. Default)
    wanted = [
        ("users", "marketplace_name", "VARCHAR(100) DEFAULT '' NOT NULL"),
        ("users", "email_verified", "BOOLEAN DEFAULT false NOT NULL"),
        ("users", "pending_email", "VARCHAR(255)"),
        ("questions", "owner_id", "INTEGER"),
        ("users", "modules_initialized", "BOOLEAN DEFAULT false NOT NULL"),
        ("questions", "topic_id", "INTEGER"),
    ]
    for table, column, ddl in wanted:
        if table not in existing_tables:
            continue
        cols = {c["name"] for c in inspector.get_columns(table)}
        if column not in cols:
            sync_conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}"))

    # Indizes auf haeufig gefilterte Fremdschluessel (idempotent, additiv).
    # Ohne sie laufen Auswertung/Live-Session als Full-Table-Scans ueber die scans-Tabelle.
    indexes = [
        ("idx_scans_session", "scans", "session_id"),
        ("idx_scans_question", "scans", "question_id"),
        ("idx_students_class", "students", "class_id"),
        ("idx_qsi_set", "question_set_items", "question_set_id"),
        ("idx_sessions_owner", "sessions", "owner_id"),
        ("idx_sessions_class", "sessions", "class_id"),
        ("idx_classes_owner", "school_classes", "owner_id"),
        ("idx_folders_owner", "folders", "owner_id"),
        ("idx_questions_owner", "questions", "owner_id"),
        ("idx_mp_ratings_quiz", "marketplace_ratings", "quiz_id"),
    ]
    for name, table, column in indexes:
        if table in existing_tables:
            sync_conn.execute(text(f"CREATE INDEX IF NOT EXISTS {name} ON {table} ({column})"))


# Konten, die vor diesem Zeitpunkt existierten, gelten als bestätigt (keine Verifizierung nötig).
# Fester Zeitpunkt = idempotent, auch bei Neustart werden neue Konten NICHT auto-bestätigt.
VERIFY_CUTOFF = "2026-07-13 00:00:00+00"


@app.on_event("startup")
async def startup():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.run_sync(_ensure_columns)

    from sqlalchemy import select, text
    from .models import User
    from .routers.auth import _hash_pw
    from .database import async_session

    # Bestandskonten (vor Cutoff) als bestätigt markieren — Neue müssen bestätigen
    async with async_session() as db:
        await db.execute(text(
            "UPDATE users SET email_verified = true "
            f"WHERE email_verified = false AND created_at < TIMESTAMPTZ '{VERIFY_CUTOFF}'"
        ))
        await db.commit()

    # Bestandskonten an das Modulregister anschliessen: wer schon CardVote-Daten
    # hat, bekommt CardVote aktiviert — sonst staende er nach dem Umbau vor einer
    # leeren Shell, obwohl seine Daten da sind. Laeuft einmal pro Konto
    # (modules_initialized), damit spaeteres Abschalten nicht rueckgaengig wird.
    async with async_session() as db:
        await db.execute(text("""
            INSERT INTO user_modules (user_id, module_key)
            SELECT u.id, 'cardvote' FROM users u
            WHERE u.modules_initialized = false
              AND EXISTS (
                    SELECT 1 FROM questions q WHERE q.owner_id = u.id
                    UNION ALL SELECT 1 FROM school_classes c WHERE c.owner_id = u.id
                    UNION ALL SELECT 1 FROM sessions s WHERE s.owner_id = u.id
              )
            ON CONFLICT ON CONSTRAINT uq_user_module DO NOTHING
        """))
        await db.execute(text("UPDATE users SET modules_initialized = true WHERE modules_initialized = false"))
        await db.commit()

    admin_email = os.environ.get("ADMIN_EMAIL", "")
    admin_pw = os.environ.get("ADMIN_PASSWORD", "")
    if admin_email and admin_pw:
        async with async_session() as db:
            result = await db.execute(select(User).where(User.email == admin_email))
            if not result.scalar_one_or_none():
                db.add(User(email=admin_email, password_hash=_hash_pw(admin_pw), name="Admin", email_verified=True))
                await db.commit()

    # Hintergrund-Task: unbestätigte Konten älter als 14 Tage löschen
    asyncio.create_task(_cleanup_unverified_loop())


async def _cleanup_unverified_loop():
    from sqlalchemy import text
    from .database import async_session
    while True:
        try:
            async with async_session() as db:
                await db.execute(text(
                    "DELETE FROM users "
                    "WHERE email_verified = false AND created_at < NOW() - INTERVAL '14 days'"
                ))
                await db.commit()
        except Exception:
            pass
        await asyncio.sleep(6 * 3600)  # alle 6 Stunden


async def _ws_is_session_owner(token: str, session_id: int) -> bool:
    """Prueft, ob das Token zur Besitzer-Person der Session gehoert (fuer Steuerbefehle)."""
    from .routers.auth import _verify_token, TOKEN_TTL
    from .database import async_session
    from .models import User, Session as SessionModel
    import time as _time
    if not token:
        return False
    result = _verify_token(token)
    if result is None:
        return False
    user_id, tv, ts = result
    if int(_time.time()) - ts > TOKEN_TTL:
        return False
    async with async_session() as db:
        user = await db.get(User, user_id)
        if not user or tv != user.token_version:
            return False
        s = await db.get(SessionModel, session_id)
        if not s:
            return False
        return (not s.owner_id) or s.owner_id == user_id


@app.websocket("/ws/session/{session_id}")
async def websocket_endpoint(websocket: WebSocket, session_id: int):
    import json as _json
    if not await ws.connect(session_id, websocket):
        return  # Verbindungslimit für diese Session erreicht
    # Authentifizierung per erster Nachricht (Token nicht in der URL -> nicht in Logs)
    is_owner = False
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = _json.loads(raw)
            except Exception:
                continue
            if not isinstance(msg, dict):
                continue
            if msg.get("type") == "auth":
                is_owner = await _ws_is_session_owner(msg.get("token", ""), session_id)
                continue
            # Steuerbefehle nur von der authentifizierten Besitzer-Person weiterreichen
            if not is_owner:
                continue
            # remote: Scanner -> Host (Aufdecken/Weiter/...); host_state/session_finished: Host -> Scanner
            if msg.get("type") in ("remote", "host_state", "session_finished"):
                await ws.broadcast(session_id, msg)
    except WebSocketDisconnect:
        ws.disconnect(session_id, websocket)


@app.get("/api/health")
async def health():
    # Prüft auch die Datenbank — sonst wäre "ok", obwohl keine Daten gespeichert werden können
    from sqlalchemy import text
    from fastapi.responses import JSONResponse
    from .database import async_session
    try:
        async with async_session() as db:
            await db.execute(text("SELECT 1"))
        return {"status": "ok"}
    except Exception:
        return JSONResponse(status_code=503, content={"status": "db_down"})


# --- Version / Update-Check ---
import pathlib as _pathlib
from .routers.auth import get_current_user


async def _require_admin(user=Depends(get_current_user)):
    if user.id != 1:
        raise HTTPException(403, "Nur für die Administration")
    return user


def _read_version() -> str:
    # VERSION liegt im Repo-Root; im Container unter /app bzw. neben app/
    for p in ("/app/VERSION", str(_pathlib.Path(__file__).resolve().parent.parent / "VERSION"),
              str(_pathlib.Path(__file__).resolve().parent.parent.parent / "VERSION")):
        try:
            return _pathlib.Path(p).read_text().strip()
        except Exception:
            continue
    return "0.0.0"


APP_VERSION = _read_version()
GITHUB_VERSION_URL = os.environ.get(
    "GITHUB_VERSION_URL", "https://raw.githubusercontent.com/norbert-me/CardVote/main/backend/VERSION"
)
_version_cache = {"ts": 0.0, "latest": None}


def _parse_version(v: str):
    v = (v or "").strip().lstrip("vV")
    out = []
    for part in v.split("."):
        num = "".join(ch for ch in part if ch.isdigit())
        out.append(int(num) if num else 0)
    return tuple(out) or (0,)


def _fetch_latest_version() -> str:
    import urllib.request
    req = urllib.request.Request(GITHUB_VERSION_URL, headers={"User-Agent": "CardVote"})
    with urllib.request.urlopen(req, timeout=5) as r:
        return r.read().decode("utf-8", "ignore").strip().split("\n")[0].strip()


@app.get("/api/version")
async def version(user=Depends(_require_admin)):
    latest = _version_cache["latest"]
    if latest is None or (_time.time() - _version_cache["ts"] > 3600):
        try:
            latest = await asyncio.to_thread(_fetch_latest_version)
            _version_cache["ts"] = _time.time()
            _version_cache["latest"] = latest
        except Exception:
            latest = _version_cache["latest"]
    update = bool(latest) and _parse_version(latest) > _parse_version(APP_VERSION)
    return {
        "current": APP_VERSION,
        "latest": latest,
        "update_available": update,
        "repo_url": "https://github.com/norbert-me/CardVote",
    }


@app.post("/api/mail-test")
async def mail_test(to: str, user=Depends(_require_admin)):
    from . import mailer
    return await mailer.send_test(to)


# --- Kontaktformular ---
from pydantic import BaseModel as _BaseModel, field_validator as _field_validator


class ContactBody(_BaseModel):
    name: str = ""
    email: str
    message: str

    @_field_validator("email")
    @classmethod
    def _email_len(cls, v):
        if "@" not in v or len(v) > 255:
            raise ValueError("Ungültige E-Mail-Adresse")
        return v

    @_field_validator("message")
    @classmethod
    def _msg_len(cls, v):
        v = v.strip()
        if not v:
            raise ValueError("Nachricht darf nicht leer sein")
        if len(v) > 5000:
            raise ValueError("Nachricht zu lang (max. 5000 Zeichen)")
        return v

    @_field_validator("name")
    @classmethod
    def _name_len(cls, v):
        return v.strip()[:200]


@app.post("/api/contact")
async def contact(body: ContactBody, request: Request):
    from . import mailer
    from .routers.auth import rate_limit, client_ip
    rate_limit("contact", client_ip(request), 5, 3600, "Zu viele Nachrichten. Bitte später erneut versuchen.")
    to = os.environ.get("ADMIN_EMAIL", "")
    if not to:
        raise HTTPException(503, "Kontaktformular derzeit nicht verfügbar")
    # Zeilenumbrueche aus Nutzereingaben strippen — verhindert E-Mail-Header-Injection im Subject
    def _hdr(s: str) -> str:
        return s.replace("\r", " ").replace("\n", " ").strip()
    sender = _hdr(body.name) or _hdr(body.email)
    ok = await mailer.send_email(
        to,
        f"CardVote Kontaktanfrage von {sender}",
        f"Von: {sender} <{_hdr(body.email)}>\n\n{body.message.strip()}",
    )
    if not ok:
        raise HTTPException(503, "Nachricht konnte nicht gesendet werden")
    return {"ok": True}
