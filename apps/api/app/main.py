import os

import asyncio
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .database import engine
from .models import Base
from .routers import questions, sessions, results, scan_image, classes, folders, cards, export_import, auth, marketplace, modules, topics, lernpfad, noten, planung, karten, kalender, methoden, sitzplan, anwesenheit, codedetektiv, orga, ausleihe, me, zufall, kurse
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


# Kern-GETs, die sich selten aendern: ETag + 304, damit der Hintergrund-Refresh
# im Client (stale-while-revalidate) bei unveraenderten Daten fast keine Bytes
# kostet. Bewusst nur diese Pfade — kein Caching fuer alles.
import hashlib as _hashlib
from starlette.responses import Response as _Response

_ETAG_PREFIXES = ("/api/classes", "/api/topics", "/api/modules")


class ETagMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        if request.method != "GET":
            return response
        path = request.url.path
        if not any(path == p or path.startswith(p + "/") for p in _ETAG_PREFIXES):
            return response
        if response.status_code != 200:
            return response
        body = b"".join([chunk async for chunk in response.body_iterator])
        etag = '"' + _hashlib.md5(body).hexdigest() + '"'
        headers = dict(response.headers)
        headers["etag"] = etag
        headers.pop("content-length", None)
        if request.headers.get("if-none-match") == etag:
            return _Response(status_code=304, headers={"etag": etag})
        return _Response(content=body, status_code=200, headers=headers, media_type=response.media_type)


app = FastAPI(title="Nuvora API")

app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(ETagMiddleware)
app.add_middleware(AbuseGuardMiddleware)
# Origins normalisieren: Leerzeichen und ein versehentlicher Trailing-Slash in
# SITE_URL/CORS_ORIGINS sind der haeufigste Grund, warum der Browser-Origin
# (nie mit Slash) nicht matcht und Aufrufe an /api "access control"-blockiert.
_cors = [o.strip().rstrip("/") for o in os.environ.get("CORS_ORIGINS", "http://localhost:3001").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Content-Type", "Authorization", "If-None-Match"],
    expose_headers=["ETag"],
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
app.include_router(noten.router)
app.include_router(planung.router)
app.include_router(karten.router)
app.include_router(kalender.router)
app.include_router(methoden.router)
app.include_router(sitzplan.router)
app.include_router(anwesenheit.router)
app.include_router(codedetektiv.router)
app.include_router(orga.router)
app.include_router(ausleihe.router)
app.include_router(me.router)
app.include_router(zufall.router)
app.include_router(kurse.router)
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
        ("users", "methoden_seeded", "BOOLEAN DEFAULT false NOT NULL"),
        ("kurse", "niveau_aktiv", "BOOLEAN DEFAULT false NOT NULL"),
        ("seating_plans", "kurs_id", "INTEGER"),
        ("questions", "topic_id", "INTEGER"),
        ("students", "niveau", "VARCHAR(1) DEFAULT '' NOT NULL"),
        ("students", "foerder", "JSON"),
        ("students", "notizen", "TEXT DEFAULT '' NOT NULL"),
        ("students", "klassenlehrer", "VARCHAR(120) DEFAULT '' NOT NULL"),
        # learning_ladders wurde in einem frueheren Deploy ohne diese Spalten
        # angelegt; sie kamen erst spaeter ins Modell. create_all aendert
        # bestehende Tabellen nicht — deshalb hier nachziehen.
        ("learning_ladders", "topic_id", "INTEGER"),
        ("learning_ladders", "assignments", "JSON"),
        ("grade_categories", "section_id", "INTEGER"),
        ("grade_sections", "term", "VARCHAR(8) DEFAULT '1' NOT NULL"),
        ("grade_overrides", "term", "VARCHAR(8) DEFAULT '1' NOT NULL"),
        ("school_classes", "plan_blocks", "INTEGER DEFAULT 2 NOT NULL"),
        ("school_classes", "karten_token", "VARCHAR(64)"),
        ("school_classes", "color", "VARCHAR(9) DEFAULT '' NOT NULL"),
        ("school_classes", "deleted_at", "TIMESTAMPTZ"),
        ("school_classes", "kurs_id", "INTEGER"),
        ("students", "kurs_id", "INTEGER"),
        ("kurse", "deleted_at", "TIMESTAMPTZ"),
        ("kurse", "deleted_members", "JSON"),
        ("students", "karten_token", "VARCHAR(64)"),
        ("card_decks", "released_at", "TIMESTAMPTZ"),
        ("card_decks", "topic_id", "INTEGER"),
        ("card_decks", "deleted_at", "TIMESTAMPTZ"),
        ("card_decks", "kurs_id", "INTEGER"),
        ("card_decks", "niveau", "VARCHAR(1) DEFAULT ''"),
        ("learning_paths", "deleted_at", "TIMESTAMPTZ"),
        ("marketplace_quizzes", "kind", "VARCHAR(30) DEFAULT 'cardvote_questionset' NOT NULL"),
        ("methods", "ablauf", "TEXT DEFAULT '' NOT NULL"),
        ("methods", "material", "TEXT DEFAULT '' NOT NULL"),
        ("methods", "dauer", "INTEGER"),
        ("grade_categories", "source_session_id", "INTEGER"),
        ("attendance", "period", "INTEGER"),
        ("calendar_entries", "method_id", "INTEGER"),
        ("calendar_entries", "period", "INTEGER"),
        ("calendar_entries", "cardvote_set_id", "INTEGER"),
        ("calendar_entries", "karten_deck_id", "INTEGER"),
        ("calendar_entries", "lernpfad_ladder_id", "INTEGER"),
        ("calendar_entries", "codedetektiv_puzzle", "VARCHAR(64)"),
        ("exercises", "code", "VARCHAR(20) DEFAULT '' NOT NULL"),
        ("users", "timetable_periods", "INTEGER DEFAULT 6 NOT NULL"),
        ("users", "timetable_times", "JSON"),
    ]
    for table, column, ddl in wanted:
        if table not in existing_tables:
            continue
        cols = {c["name"] for c in inspector.get_columns(table)}
        if column not in cols:
            sync_conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}"))
            # Bestandsstapel bleiben sichtbar: einmalig als bereits ausgerollt
            # markieren. Laeuft nur beim erstmaligen Anlegen der Spalte, also
            # nicht wieder ueber spaeter angelegte Entwuerfe (released_at NULL).
            if (table, column) == ("card_decks", "released_at"):
                sync_conn.execute(text("UPDATE card_decks SET released_at = now() WHERE released_at IS NULL"))

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

    # Alt-Zeilen in card_reviews mit NULL-SM-2-Feldern auffuellen — sonst kracht
    # die Bewertung ('NoneType + int') und der Reifegrad. Nur NULL-Zeilen.
    if "card_reviews" in existing_tables:
        sync_conn.execute(text(
            "UPDATE card_reviews SET ease=COALESCE(ease,250), interval_days=COALESCE(interval_days,0), "
            "reps=COALESCE(reps,0), lapses=COALESCE(lapses,0) "
            "WHERE ease IS NULL OR interval_days IS NULL OR reps IS NULL OR lapses IS NULL"
        ))


# Tabellen der eigenständigen Zusatzmodule. Fehlt eine nach create_all, kann das
# Modul nichts speichern (typisch: web neu gestartet, api nicht). Beim Start laut
# in die Logs schreiben, statt dass Nutzer es als „speichert nicht" melden.
_MODULE_TABLES = {
    "Orga": "orga_items",
    "Material-Ausleihe": ["material_items", "material_loans"],
    "Anwesenheit": "attendance",
    "Sitzplan": "seating_plans",
    "Zufallsschüler": "zufall_draws",
    "Code-Detektiv": ["code_puzzles", "code_sessions"],
    "Noten": "grade_sections",
    "Karten": "card_decks",
    "Einstiege": "methods",
    "Kalender": "calendar_entries",
}


def _check_module_tables(sync_conn):
    from sqlalchemy import inspect as sa_inspect
    existing = set(sa_inspect(sync_conn).get_table_names())
    fehlend = []
    for modul, tabellen in _MODULE_TABLES.items():
        for tab in ([tabellen] if isinstance(tabellen, str) else tabellen):
            if tab not in existing:
                fehlend.append(f"{modul}:{tab}")
    if fehlend:
        print(f"[STARTUP-WARN] Modultabellen fehlen trotz create_all: {', '.join(fehlend)} "
              f"— betroffene Module speichern nichts. api neu bauen/starten.", flush=True)
    else:
        print(f"[STARTUP] Alle {len(_MODULE_TABLES)} Modultabellen vorhanden.", flush=True)


# Konten, die vor diesem Zeitpunkt existierten, gelten als bestätigt (keine Verifizierung nötig).
# Fester Zeitpunkt = idempotent, auch bei Neustart werden neue Konten NICHT auto-bestätigt.
VERIFY_CUTOFF = "2026-07-13 00:00:00+00"


@app.on_event("startup")
async def startup():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.run_sync(_ensure_columns)
        await conn.run_sync(_check_module_tables)

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
        # Wer schon Einstiege hat, gilt als geseedet — sonst wuerde die
        # Startsammlung nach dem Loeschen aller Einstiege einmal neu auftauchen.
        await db.execute(text("UPDATE users SET methoden_seeded = true WHERE methoden_seeded = false AND EXISTS (SELECT 1 FROM methods m WHERE m.owner_id = users.id)"))
        await db.commit()

    # Anwesenheit ist ins Modul „Orga & Anwesenheit" aufgegangen. Wer Anwesenheit
    # aktiv hatte, bekommt orga aktiv (sonst verschwindet der Zugang); die alten
    # anwesenheit-Zeilen fallen weg. Idempotent.
    async with async_session() as db:
        await db.execute(text("""
            INSERT INTO user_modules (user_id, module_key)
            SELECT DISTINCT user_id, 'orga' FROM user_modules WHERE module_key = 'anwesenheit'
            ON CONFLICT ON CONSTRAINT uq_user_module DO NOTHING
        """))
        await db.execute(text("DELETE FROM user_modules WHERE module_key = 'anwesenheit'"))
        # Material-Ausleihe ebenso ins Modul „Orga" aufgegangen.
        await db.execute(text("""
            INSERT INTO user_modules (user_id, module_key)
            SELECT DISTINCT user_id, 'orga' FROM user_modules WHERE module_key = 'ausleihe'
            ON CONFLICT ON CONSTRAINT uq_user_module DO NOTHING
        """))
        await db.execute(text("DELETE FROM user_modules WHERE module_key = 'ausleihe'"))
        # Sitzplan ebenso ins Modul „Orga" aufgegangen (4. Tab).
        await db.execute(text("""
            INSERT INTO user_modules (user_id, module_key)
            SELECT DISTINCT user_id, 'orga' FROM user_modules WHERE module_key = 'sitzplan'
            ON CONFLICT ON CONSTRAINT uq_user_module DO NOTHING
        """))
        await db.execute(text("DELETE FROM user_modules WHERE module_key = 'sitzplan'"))
        await db.commit()

    # Anwesenheit ist jetzt pro Stunde (student, date, period) statt pro Tag.
    # Der alte Unique-Constraint auf (student, date) würde die zweite Stunde
    # blockieren — droppen; das Modell bringt den neuen mit period selbst mit.
    async with async_session() as db:
        try:
            await db.execute(text("ALTER TABLE attendance DROP CONSTRAINT IF EXISTS uq_attendance_student_date"))
            await db.commit()
        except Exception:
            pass

    # Sitzplan hängt jetzt am Kurs (kurs_id); der alte Unique-Constraint auf
    # (owner, class_id) würde mehrere Fach-Kurse derselben Klasse blockieren.
    async with async_session() as db:
        try:
            await db.execute(text("ALTER TABLE seating_plans DROP CONSTRAINT IF EXISTS uq_seating_owner_class"))
            await db.commit()
        except Exception:
            pass

    # Kurs-Konzept, Phase 1: jede Klasse ohne Kurs bekommt ihren eigenen Kurs
    # (1:1, gleicher Name/Owner). Ändert nichts am Verhalten, legt nur die
    # Grundlage, damit Klassen später zu einem gemeinsamen Kurs gruppiert werden.
    async with async_session() as db:
        try:
            rows = (await db.execute(text(
                "SELECT id, name, owner_id FROM school_classes WHERE kurs_id IS NULL"
            ))).all()
            for cid, cname, owner in rows:
                if owner is None:
                    continue
                kid = (await db.execute(text(
                    "INSERT INTO kurse (owner_id, name) VALUES (:o, :n) RETURNING id"
                ), {"o": owner, "n": cname or ""})).scalar()
                await db.execute(text("UPDATE school_classes SET kurs_id = :k WHERE id = :c"), {"k": kid, "c": cid})
            if rows:
                print(f"[STARTUP] Kurse: {len(rows)} Klasse(n) je eigenem Kurs zugeordnet.", flush=True)
            # Schüler erben den Kurs ihrer Klasse (für geteilte Anwesenheit).
            await db.execute(text(
                "UPDATE students SET kurs_id = (SELECT kurs_id FROM school_classes WHERE id = students.class_id) "
                "WHERE kurs_id IS NULL"
            ))
            # Mitgliedschaft (kurs_tags) ist jetzt die Wahrheit (many-to-many):
            # jede Klasse mit kurs_id wird Mitglied ihres Kurses.
            await db.execute(text(
                "INSERT INTO kurs_tags (kurs_id, class_id) "
                "SELECT kurs_id, id FROM school_classes WHERE kurs_id IS NOT NULL "
                "ON CONFLICT ON CONSTRAINT uq_kurs_tag DO NOTHING"
            ))
            # Karten-Decks an den Kurs ihrer Klasse hängen (Decks gelten kursweit).
            await db.execute(text(
                "UPDATE card_decks SET kurs_id = (SELECT kurs_id FROM school_classes WHERE id = card_decks.class_id) "
                "WHERE kurs_id IS NULL"
            ))
            await db.commit()
        except Exception as e:
            print(f"[STARTUP-WARN] Kurs-Migration übersprungen: {e}", flush=True)

    # Marktplatz: kind muss zum Snapshot-Typ passen. Vor der kind-Spalte
    # veröffentlichte Karten-Decks/Einstiege trugen den Default
    # "cardvote_questionset" und wurden dann als Quiz behandelt (Vorschau im
    # Quiz-Layout, Übernahme ohne Klassenwahl). payload->>'type' ist die Wahrheit.
    async with async_session() as db:
        try:
            res = await db.execute(text(
                "UPDATE marketplace_quizzes SET kind = payload->>'type' "
                "WHERE payload->>'type' IN ('karten_deck','method','cardvote_questionset') "
                "AND kind IS DISTINCT FROM payload->>'type'"
            ))
            if res.rowcount:
                print(f"[STARTUP] Marktplatz: kind bei {res.rowcount} Eintrag/Einträgen korrigiert.", flush=True)
            await db.commit()
        except Exception:
            pass

    # Papierkorb leeren: Klassen, die länger als 30 Tage gelöscht sind, endgültig
    # entfernen (jetzt greift die Kaskade auf Noten/Karten/…). Läuft bei jedem Start.
    async with async_session() as db:
        for tbl, wort in (("school_classes", "Klasse(n)"), ("card_decks", "Deck(s)"), ("learning_paths", "Lernpfad(e)"), ("kurse", "Kurs(e)")):
            try:
                res = await db.execute(text(
                    f"DELETE FROM {tbl} WHERE deleted_at IS NOT NULL AND deleted_at < now() - interval '30 days'"
                ))
                if res.rowcount:
                    print(f"[STARTUP] Papierkorb: {res.rowcount} {wort} endgültig gelöscht (>30 Tage).", flush=True)
            except Exception:
                pass
        await db.commit()

    # Mandantentrennung: owner_id IS NULL galt historisch als „für alle sichtbar"
    # (Einzelmandant nach der Datenübernahme). Bei öffentlichem Betrieb ist das ein
    # Leck. Alle Alt-Zeilen ohne Owner gehören dem ersten Konto (Admin) — einmalig
    # zuweisen; danach existiert kein NULL-Owner mehr und die alten IS-NULL-Regeln
    # matchen nichts. Idempotent.
    async with async_session() as db:
        admin = (await db.execute(text("SELECT id FROM users ORDER BY id LIMIT 1"))).scalar()
        if admin:
            total = 0
            for tbl in ("school_classes", "folders", "questions", "sessions", "topics",
                        "exercises", "learning_paths", "grade_sections", "grade_categories",
                        "grade_overrides", "card_decks", "quartal_dividers", "plan_weeks"):
                try:
                    r = await db.execute(text(f"UPDATE {tbl} SET owner_id = :a WHERE owner_id IS NULL"), {"a": admin})
                    total += r.rowcount or 0
                except Exception:
                    pass  # Tabelle existiert (noch) nicht — überspringen
            if total:
                print(f"[STARTUP] Mandanten-Backfill: {total} Alt-Zeile(n) ohne Owner dem Admin zugewiesen.", flush=True)
            await db.commit()

    # Noten: Kategorien ohne Abschnitt an einen Standard-Abschnitt haengen
    # (zweistufiges Modell kam spaeter). Pro Klasse ein "Sonstige Mitarbeit"
    # mit 100 %, damit der gewichtete Schnitt sofort rechnet.
    async with async_session() as db:
        rows = (await db.execute(text(
            "SELECT DISTINCT class_id, owner_id FROM grade_categories WHERE section_id IS NULL"
        ))).all()
        for class_id, owner_id in rows:
            sec = (await db.execute(text(
                "INSERT INTO grade_sections (owner_id, class_id, name, weight, position) "
                "VALUES (:o, :c, 'Sonstige Mitarbeit', 100, 0) RETURNING id"
            ), {"o": owner_id, "c": class_id})).scalar()
            await db.execute(text(
                "UPDATE grade_categories SET section_id = :s WHERE class_id = :c AND section_id IS NULL"
            ), {"s": sec, "c": class_id})
        await db.commit()

    # Admin-Konto genau EINMAL anlegen. Frueher lief das bei jedem Start anhand
    # ADMIN_EMAIL — aendert der Admin danach seine Mail, wurde das Original neu
    # erzeugt. Ein Marker in app_settings verhindert das dauerhaft.
    admin_email = os.environ.get("ADMIN_EMAIL", "")
    admin_pw = os.environ.get("ADMIN_PASSWORD", "")
    if admin_email and admin_pw:
        from .models import AppSetting
        async with async_session() as db:
            done = await db.get(AppSetting, "admin_bootstrapped")
            if not done:
                # Bestandsinstallationen haben schon Konten — dann nur markieren,
                # nicht erneut anlegen (die Mail koennte laengst geaendert sein).
                any_user = (await db.execute(select(User).limit(1))).scalar_one_or_none()
                exists = (await db.execute(select(User).where(User.email == admin_email))).scalar_one_or_none()
                if not any_user and not exists:
                    db.add(User(email=admin_email, password_hash=_hash_pw(admin_pw), name="Admin", email_verified=True))
                db.add(AppSetting(key="admin_bootstrapped", value="1"))
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
    "GITHUB_VERSION_URL", "https://raw.githubusercontent.com/norbert-me/Nuvora/main/apps/api/VERSION"
)
# Stable = letztes veroeffentlichtes Nicht-Prerelease-Release. GitHubs
# /releases/latest schliesst Prereleases (= Beta-Kanal) und Entwuerfe aus.
GITHUB_RELEASE_URL = os.environ.get(
    "GITHUB_RELEASE_URL", "https://api.github.com/repos/norbert-me/Nuvora/releases/latest"
)
# Beta liest die VERSION-Datei ueber die Contents-API (frischer als der Raw-CDN).
GITHUB_CONTENTS_URL = os.environ.get(
    "GITHUB_CONTENTS_URL", "https://api.github.com/repos/norbert-me/Nuvora/contents/apps/api/VERSION?ref=main"
)
# Kanal je Instanz. "stable" = nur bei Major-Releases; "beta" = jeder Commit
# (rohe VERSION von main). Steht in app_settings, hier nur der Fallback.
DEFAULT_CHANNEL = os.environ.get("UPDATE_CHANNEL", "stable")
CHANNELS = ("stable", "beta")
# Cache je Kanal, damit ein Umschalten nicht am alten Wert haengt.
_version_cache = {"stable": {"ts": 0.0, "latest": None}, "beta": {"ts": 0.0, "latest": None}}


def _parse_version(v: str):
    v = (v or "").strip().lstrip("vV")
    out = []
    for part in v.split("."):
        num = "".join(ch for ch in part if ch.isdigit())
        out.append(int(num) if num else 0)
    return tuple(out) or (0,)


from .database import get_db
from pydantic import BaseModel as _BaseModel


def _fetch_latest_beta() -> str:
    # Ueber die GitHub-Contents-API statt raw.githubusercontent: der Raw-CDN
    # cacht die Datei mehrere Minuten, sodass frische Commits verspaetet
    # erschienen. Die API ist deutlich aktueller.
    import urllib.request, json as _json, base64 as _b64
    req = urllib.request.Request(GITHUB_CONTENTS_URL, headers={"User-Agent": "Nuvora", "Accept": "application/vnd.github+json"})
    with urllib.request.urlopen(req, timeout=5) as r:
        data = _json.loads(r.read().decode("utf-8", "ignore"))
    raw = _b64.b64decode(data.get("content", "")).decode("utf-8", "ignore")
    return raw.strip().split("\n")[0].strip()


def _fetch_latest_stable() -> str:
    """Tag des letzten Nicht-Prerelease-Releases. Leer, wenn es noch keins gibt."""
    import urllib.request, urllib.error, json as _json
    req = urllib.request.Request(GITHUB_RELEASE_URL, headers={"User-Agent": "Nuvora", "Accept": "application/vnd.github+json"})
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            data = _json.loads(r.read().decode("utf-8", "ignore"))
        return (data.get("tag_name") or "").strip()
    except urllib.error.HTTPError as e:
        if e.code == 404:  # noch kein Stable-Release veroeffentlicht
            return ""
        raise


async def _get_channel(db) -> str:
    from .models import AppSetting
    row = await db.get(AppSetting, "update_channel")
    ch = row.value if row else DEFAULT_CHANNEL
    return ch if ch in CHANNELS else DEFAULT_CHANNEL


async def _latest_for(channel: str, force: bool = False) -> str:
    cache = _version_cache[channel]
    if force or cache["latest"] is None or (_time.time() - cache["ts"] > 3600):
        try:
            fetch = _fetch_latest_stable if channel == "stable" else _fetch_latest_beta
            cache["latest"] = await asyncio.to_thread(fetch)
            cache["ts"] = _time.time()
        except Exception:
            pass  # alten Cachewert behalten
    return cache["latest"]


@app.get("/api/version")
async def version(refresh: bool = False, user=Depends(_require_admin), db=Depends(get_db)):
    channel = await _get_channel(db)
    latest = await _latest_for(channel, force=refresh)
    update = bool(latest) and _parse_version(latest) > _parse_version(APP_VERSION)
    return {
        "current": APP_VERSION,
        "latest": latest,
        "update_available": update,
        "channel": channel,
        "channels": list(CHANNELS),
        "repo_url": "https://github.com/norbert-me/Nuvora",
    }


class ChannelBody(_BaseModel):
    channel: str


@app.put("/api/version/channel")
async def set_channel(body: ChannelBody, user=Depends(_require_admin), db=Depends(get_db)):
    from .models import AppSetting
    if body.channel not in CHANNELS:
        raise HTTPException(400, "Unbekannter Kanal")
    row = await db.get(AppSetting, "update_channel")
    if row:
        row.value = body.channel
    else:
        db.add(AppSetting(key="update_channel", value=body.channel))
    await db.commit()
    return {"channel": body.channel}


@app.post("/api/mail-test")
async def mail_test(to: str, user=Depends(_require_admin)):
    from . import mailer
    return await mailer.send_test(to)


@app.get("/api/admin/setup")
async def admin_setup(user=Depends(_require_admin)):
    """Einrichtungsstatus fuer das Admin-Profil: was fehlt noch?"""
    from . import mailer
    site = _pathlib.Path("/app/config/site.json")
    return {
        "smtp": mailer.email_configured(),
        "site_json": site.exists(),
        "admin_email": bool(os.environ.get("ADMIN_EMAIL")),
    }


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
