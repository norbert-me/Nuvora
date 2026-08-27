import os

import asyncio
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .netz import client_ip
from .kursmitglieder import schuljahr_aus_name
from .database import engine, async_session
from .models import AppSetting, Base, Kurs, Session as SessionModel, User
# Admin-Pruefung und Programmfassung kommen aus app/admin.py — dem Blatt, das
# den frueheren Ring main -> routers.backup -> main aufloest. Hier nur noch
# hereingeholt, damit die Routen weiter unten `_require_admin` benutzen koennen.
from .admin import _require_admin, APP_VERSION  # noqa: F401 — Routen unten
from .routers import questions, sessions, results, scan_image, classes, folders, cards, export_import, auth, marketplace, modules, topics, lernpfad, noten, karten, kalender, methoden, sitzplan, anwesenheit, codedetektiv, orga, ausleihe, me, zufall, kurse, material, klassenarbeit, todos, notizblock, trash, selftest, backup
from . import websocket as ws
from .routers.auth import _hash_pw, _verify_token, get_current_user, rate_limit, TOKEN_TTL
from .routers.karten import uebernahme_deck_kurse

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


# Stand hier und in auth.py wortgleich; die Rechnung liegt jetzt in app/netz.py.
_req_ip = client_ip


# Zeitpunkt der letzten Auskehr — bewusst in einer Zelle statt als
# `global`-Variable. Gelesen und fortgeschrieben wird beides in
# _global_hits_auskehren (Schranke "hoechstens einmal je Minute"); als
# `global` sah die Zuweisung fuer Codepruefer nach einem toten Wert aus
# (CodeQL py/unused-global-variable), weil sie erst der naechste Aufruf liest.
_global_hits_kehr = {"zuletzt": 0.0}


def _global_hits_auskehren(now: float) -> None:
    """Abgelaufene Zaehler wegwerfen — hoechstens einmal je Minute.

    Der Speicher wuchs sonst unbegrenzt: jede IP legte einen Eintrag an, der
    nie wieder verschwand, und von aussen liess sich das beliebig aufblasen
    (eine Anfrage je Adresse genuegt). Bei IPv6 ist das ein /64 je Client.
    """
    if now - _global_hits_kehr["zuletzt"] < 60:
        return
    _global_hits_kehr["zuletzt"] = now
    for schluessel in [k for k, v in _global_hits.items()
                       if not v or now - v[-1] > GLOBAL_RATE_WINDOW]:
        _global_hits.pop(schluessel, None)


class AbuseGuardMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        # 1) Body-Grösse begrenzen (Schutz vor Speicher-Erschöpfung)
        cl = request.headers.get("Content-Length")
        if cl:
            try:
                if int(cl) > MAX_BODY_BYTES:
                    return JSONResponse(status_code=413, content={"detail": "Anfrage zu gross"})
            except ValueError:
                # Content-Length ist keine Zahl (kaputter Client, Angriffsversuch).
                # Dann laesst sich die Groesse hier nicht beurteilen — durchlassen
                # und den eigentlichen Schutz dem Server/Body-Leser ueberlassen.
                pass
        # 2) Globaler Flood-Schutz pro IP (nur /api/, ohne Health)
        #
        # Die Schueler-Wege sind ausgenommen: eine Schulklasse haengt hinter EINER
        # NAT-Adresse, und 30 Kinder erzeugen dort mehr Anfragen als jede sinnvolle
        # Obergrenze je IP. Ungeschuetzt sind sie deshalb nicht — sie haben eine
        # feinere Drossel je Token bzw. je Sitzungscode plus eine eigene
        # nginx-Zone. Ohne diese Ausnahme bremste die grobe IP-Schranke die ganze
        # Klasse aus, sobald zwei Gruppen gleichzeitig arbeiten.
        path = request.url.path
        schueler_weg = (path.startswith("/api/karten/lernen/")
                        or path.startswith("/api/codedetektiv/sessions/"))
        if path.startswith("/api/") and path != "/api/health" and not schueler_weg:
            ip = _req_ip(request)
            now = _time.time()
            hits = [t for t in _global_hits[ip] if now - t < GLOBAL_RATE_WINDOW]
            if len(hits) >= GLOBAL_RATE_MAX:
                _global_hits[ip] = hits
                return JSONResponse(status_code=429, content={"detail": "Zu viele Anfragen"}, headers={"Retry-After": str(GLOBAL_RATE_WINDOW)})
            hits.append(now)
            _global_hits[ip] = hits
            _global_hits_auskehren(now)
        return await call_next(request)


# Kern-GETs, die sich selten aendern: ETag + 304, damit der Hintergrund-Refresh
# im Client (stale-while-revalidate) bei unveraenderten Daten fast keine Bytes
# kostet. Bewusst nur diese Pfade — kein Caching fuer alles.
import hashlib as _hashlib
from starlette.responses import Response as _Response

# /api/codedetektiv/sessions ist der teuerste Pfad im Haus: eine Klasse mit 30
# Geraeten fragt den Stand alle 1,8 s ab, und die Antwort enthaelt die kompletten
# Raetsel. Solange niemand beigetreten ist und niemand abgegeben hat, ist sie
# Wort fuer Wort dieselbe — als 304 kostet sie dann nur noch die Kopfzeilen.
_ETAG_PREFIXES = ("/api/classes", "/api/topics", "/api/modules", "/api/codedetektiv/sessions")


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
        # "no-cache" heisst NICHT "nicht zwischenspeichern", sondern "vor dem
        # Benutzen nachfragen". Genau das brauchen wir: ohne Cache-Control
        # schaetzt der Browser selbst, wie lange die Antwort frisch ist — er
        # kann sie also ungefragt aus dem eigenen Speicher servieren (veralteter
        # Klassenstand) ODER sie ganz ohne If-None-Match neu holen, womit die
        # 304-Ersparnis ausfaellt. Mit no-cache validiert er jedes Mal, und
        # unveraenderte Daten kosten nur noch die Kopfzeilen.
        headers["cache-control"] = "no-cache, private"
        headers.pop("content-length", None)
        if request.headers.get("if-none-match") == etag:
            return _Response(status_code=304, headers={"etag": etag, "cache-control": "no-cache, private"})
        return _Response(content=body, status_code=200, headers=headers, media_type=response.media_type)


# Interaktive API-Doku (/docs, /redoc, /openapi.json) nur einschalten, wenn
# NUVORA_DOCS=1 gesetzt ist. In Produktion aus, damit die komplette API-Oberflaeche
# nicht ohne Not offengelegt wird (defensive Härtung).
_docs_on = os.environ.get("NUVORA_DOCS") == "1"
app = FastAPI(
    title="Nuvora API",
    docs_url="/docs" if _docs_on else None,
    redoc_url="/redoc" if _docs_on else None,
    openapi_url="/openapi.json" if _docs_on else None,
)

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
app.include_router(sessions.offen_router)
app.include_router(results.router)
app.include_router(results.kern_router)
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
app.include_router(karten.router)
app.include_router(karten.kern_router)
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
app.include_router(material.router)
app.include_router(klassenarbeit.router)
app.include_router(todos.router)
app.include_router(notizblock.router)
app.include_router(trash.router)
app.include_router(selftest.router)
# Sicherungen: Serververwaltung, kein Modul (steht deshalb nicht in REGISTRY).
# Haengt komplett an _require_admin — die Dateien enthalten Art.-9-Daten.
app.include_router(backup.router)
app.include_router(marketplace.router)

# Im Container /app/uploads (Volume). Ueberschreibbar, damit Tests und die
# lokale Pruefinstanz nicht ins Wurzelverzeichnis schreiben muessen.
UPLOAD_DIR = os.environ.get("NUVORA_UPLOAD_DIR", "/app/uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)
app.mount("/api/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")


def _ensure_columns(sync_conn):
    """Additive Migration: fehlende Spalten auf bestehenden Tabellen ergaenzen (kein Datenverlust)."""
    from sqlalchemy import inspect as sa_inspect, text
    inspector = sa_inspect(sync_conn)
    existing_tables = inspector.get_table_names()
    # (Tabelle, Spalte, DDL-Typ inkl. Default)
    wanted = [
        ("question_sets", "owner_id", "INTEGER"),
        ("card_decks", "folder_id", "INTEGER"),
        ("card_decks", "position", "INTEGER DEFAULT 0 NOT NULL"),
        ("cards", "niveau", "VARCHAR(1) DEFAULT '' NOT NULL"),
        ("users", "external_calendars", "JSON"),
        ("users", "external_hidden", "JSON"),
        ("users", "marketplace_name", "VARCHAR(100) DEFAULT '' NOT NULL"),
        ("users", "grade_tendency", "BOOLEAN DEFAULT true NOT NULL"),
        ("users", "email_verified", "BOOLEAN DEFAULT false NOT NULL"),
        ("users", "pending_email", "VARCHAR(255)"),
        ("questions", "owner_id", "INTEGER"),
        ("users", "modules_initialized", "BOOLEAN DEFAULT false NOT NULL"),
        ("users", "methoden_seeded", "BOOLEAN DEFAULT false NOT NULL"),
        ("users", "karten_kurse_initialized", "BOOLEAN DEFAULT false NOT NULL"),
        ("users", "calendar_token", "VARCHAR(64)"),
        ("users", "calendar_rev", "INTEGER DEFAULT 0 NOT NULL"),
        ("users", "calendar_sig", "VARCHAR(64) DEFAULT '' NOT NULL"),
        ("users", "calendar_changed_at", "TIMESTAMP"),
        ("users", "calendar_fetched_at", "TIMESTAMP"),
        ("users", "external_ics_url", "TEXT"),
        ("users", "untis_server", "VARCHAR(200)"),     # WebUntis-Anbindung (ohne Passwort)
        ("users", "untis_schule", "VARCHAR(120)"),
        ("users", "untis_benutzer", "VARCHAR(120)"),
        ("users", "untis_ics_url", "TEXT"),
        ("users", "external_ics_color", "VARCHAR(9) DEFAULT '' NOT NULL"),
        ("marketplace_quizzes", "copies", "INTEGER DEFAULT 0 NOT NULL"),
        ("methods", "topic_id", "INTEGER"),
        ("methods", "folder_id", "INTEGER"),
        ("kurse", "niveau_aktiv", "BOOLEAN DEFAULT false NOT NULL"),
        ("kurse", "color", "VARCHAR(9) DEFAULT '' NOT NULL"),
        ("seating_plans", "kurs_id", "INTEGER"),
        ("orga_items", "kurs_id", "INTEGER"),
        ("grade_sections", "kurs_id", "INTEGER"),
        ("grade_overrides", "kurs_id", "INTEGER"),
        ("timetable_slots", "kurs_id", "INTEGER"),
        ("timetable_slots", "valid_from", "DATE"),
        ("timetable_slots", "valid_to", "DATE"),
        ("code_sessions", "ended_at", "TIMESTAMPTZ"),
        ("work_analyses", "scale", "JSON"),
        ("work_analyses", "absent", "JSON"),
        ("work_analyses", "fehler", "JSON"),   # Fehlerart je Einheit und Kind
        ("user_modules", "optionen", "JSON"),  # Anzeige-Optionen je Modul und Lehrkraft
        ("exam_dates", "topic_ids", "JSON"),   # Themen der geplanten Klassenarbeit
        ("topics", "fach", "VARCHAR(60) DEFAULT '' NOT NULL"),   # Fach und Jahrgang am Thema …
        ("topics", "jahrgang", "INTEGER"),
        ("kurse", "fach", "VARCHAR(60) DEFAULT '' NOT NULL"),    # … und ihr Gegenstueck am Kurs
        ("kurse", "jahrgang", "INTEGER"),
        ("users", "hj1_start", "DATE"),        # Schuljahr: Halbjahre + Jahresende
        ("users", "hj2_start", "DATE"),
        ("users", "jahr_ende", "DATE"),
        ("stoffplan", "start_date", "DATE"),   # fester Zeitraum statt gerechnetem
        ("stoffplan", "end_date", "DATE"),
        ("stoffplan", "exam_id", "INTEGER"),   # schliesst mit dieser Klassenarbeit ab
        ("stoffplan", "niveau", "VARCHAR(1) DEFAULT '' NOT NULL"),
        ("questions", "topic_id", "INTEGER"),
        ("students", "niveau", "VARCHAR(1) DEFAULT '' NOT NULL"),
        ("students", "foerder", "JSON"),
        ("students", "massnahmen", "JSON"),
        ("question_sets", "niveau_aktiv", "BOOLEAN DEFAULT FALSE NOT NULL"),
        ("question_sets", "minuspunkte", "BOOLEAN DEFAULT FALSE NOT NULL"),
        ("question_set_items", "niveau", "VARCHAR(1) DEFAULT '' NOT NULL"),
        ("topics", "ziel_g", "TEXT DEFAULT '' NOT NULL"),
        ("topics", "ziel_e", "TEXT DEFAULT '' NOT NULL"),
        ("students", "notizen", "TEXT DEFAULT '' NOT NULL"),
        ("students", "klassenlehrer", "VARCHAR(120) DEFAULT '' NOT NULL"),
        # learning_ladders wurde in einem frueheren Deploy ohne diese Spalten
        # angelegt; sie kamen erst spaeter ins Modell. create_all aendert
        # bestehende Tabellen nicht — deshalb hier nachziehen.
        ("learning_ladders", "topic_id", "INTEGER"),
        ("learning_ladders", "assignments", "JSON"),
        ("learning_ladders", "deleted_at", "TIMESTAMPTZ"),
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
        ("card_decks", "niveau", "VARCHAR(1) DEFAULT '' NOT NULL"),
        ("card_decks", "niveau_aktiv", "BOOLEAN DEFAULT false NOT NULL"),
        ("learning_paths", "deleted_at", "TIMESTAMPTZ"),
        ("marketplace_quizzes", "kind", "VARCHAR(30) DEFAULT 'cardvote_questionset' NOT NULL"),
        ("methods", "ablauf", "TEXT DEFAULT '' NOT NULL"),
        ("methods", "material", "TEXT DEFAULT '' NOT NULL"),
        ("methods", "dauer", "INTEGER"),
        ("grade_categories", "source_session_id", "INTEGER"),
        ("grade_categories", "source_kind", "VARCHAR(20) DEFAULT '' NOT NULL"),
        ("grade_categories", "topic_id", "INTEGER"),
        # Tag der Leistung — Eigenschaft der Spalte, nicht Teil ihres Namens.
        ("grade_categories", "date", "DATE"),
        # Kurs-Kette ueber Schuljahre (siehe Kurs in models.py).
        ("kurse", "schuljahr", "VARCHAR(9) DEFAULT '' NOT NULL"),
        ("kurse", "vorgaenger_id", "INTEGER"),
        # Vorschaubild je Kind (siehe Student.photo_thumb).
        ("students", "photo_thumb", "BYTEA"),
        ("attendance", "period", "INTEGER"),
        ("calendar_entries", "method_id", "INTEGER"),
        ("calendar_entries", "kurs_id", "INTEGER"),
        ("calendar_entries", "verlaufsplan", "JSON"),
        ("exam_dates", "entry_id", "INTEGER"),
        ("exam_dates", "work_id", "INTEGER"),
        ("exam_dates", "period", "INTEGER"),
        ("topics", "notes", "TEXT DEFAULT '' NOT NULL"),
        ("students", "photo", "BYTEA"),
        ("students", "photo_mime", "VARCHAR(120) DEFAULT '' NOT NULL"),
        ("materials", "method_id", "INTEGER"),
        ("materials", "work_id", "INTEGER"),
        ("materials", "pdf_data", "BYTEA"),
        ("work_analyses", "source_id", "INTEGER"),
        ("school_classes", "archived_at", "TIMESTAMPTZ"),
        ("students", "position", "INTEGER DEFAULT 0 NOT NULL"),
        ("kurse", "archived_at", "TIMESTAMPTZ"),
        ("materials", "rolle", "VARCHAR(20) DEFAULT '' NOT NULL"),
        ("cards", "deleted_at", "TIMESTAMP WITH TIME ZONE"),
        ("cards", "front_image", "BYTEA"),
        ("cards", "front_image_mime", "VARCHAR(120) DEFAULT '' NOT NULL"),
        ("cards", "back_image", "BYTEA"),
        ("cards", "back_image_mime", "VARCHAR(120) DEFAULT '' NOT NULL"),
        ("calendar_entries", "period", "INTEGER"),
        ("calendar_entries", "cardvote_set_id", "INTEGER"),
        ("calendar_entries", "karten_deck_id", "INTEGER"),
        ("calendar_entries", "lernpfad_ladder_id", "INTEGER"),
        ("calendar_entries", "codedetektiv_puzzle", "VARCHAR(64)"),
        ("calendar_entries", "start_time", "VARCHAR(5) DEFAULT '' NOT NULL"),
        ("calendar_entries", "end_time", "VARCHAR(5) DEFAULT '' NOT NULL"),
        ("exercises", "code", "VARCHAR(20) DEFAULT '' NOT NULL"),
        ("exercises", "sozialform", "VARCHAR(50) DEFAULT '' NOT NULL"),
        ("questions", "deleted_at", "TIMESTAMP WITH TIME ZONE"),
        ("topics", "deleted_at", "TIMESTAMP WITH TIME ZONE"),
        ("topics", "voraussetzungen", "TEXT DEFAULT '' NOT NULL"),
        ("users", "timetable_periods", "INTEGER DEFAULT 6 NOT NULL"),
        ("users", "timetable_times", "JSON"),
        ("notepad_notes", "width", "INTEGER DEFAULT 0 NOT NULL"),
        ("notepad_notes", "height", "INTEGER DEFAULT 0 NOT NULL"),
    ]
    # Fremdschluessel, die das Modell zu diesen Spalten kennt.
    #
    # Das war der teure Teil: ADD COLUMN legte jahrelang ein nacktes INTEGER an,
    # waehrend create_all dieselbe Spalte MIT ihrem ON DELETE angelegt haette.
    # In jedem Test existiert der Constraint deshalb, in der gewachsenen
    # Produktionsdatenbank nicht — und daran haengen zwei Zusagen: Konto loeschen
    # (owner_id CASCADE, Art. 17) und Thema loeschen (questions.topic_id
    # SET NULL, Regel 3). Quelle ist das Modell, nicht eine zweite Liste, damit
    # nichts auseinanderlaufen kann; der Regressionstest vergleicht beides.
    from app.models import Base
    fk_soll = {}
    for table, column, _ in wanted:
        modell = Base.metadata.tables.get(table)
        if modell is None or column not in modell.c:
            continue
        for fk in modell.c[column].foreign_keys:
            if fk.ondelete:
                fk_soll[(table, column)] = (fk.column.table.name, fk.column.name, fk.ondelete.upper())

    for table, column, ddl in wanted:
        if table not in existing_tables:
            continue
        cols = {c["name"] for c in inspector.get_columns(table)}
        if column not in cols:
            # Neue Spalte: der Fremdschluessel kommt inline mit — das koennen
            # Postgres UND SQLite (SQLite erlaubt REFERENCES bei ADD COLUMN,
            # solange der Default NULL ist; alle betroffenen Spalten sind
            # nacktes INTEGER).
            ziel = fk_soll.get((table, column))
            if ziel and ziel[0] in existing_tables:
                ddl = f"{ddl} REFERENCES {ziel[0]}({ziel[1]}) ON DELETE {ziel[2]}"
            sync_conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}"))
            # Bestandsstapel bleiben sichtbar: einmalig als bereits ausgerollt
            # markieren. Laeuft nur beim erstmaligen Anlegen der Spalte, also
            # nicht wieder ueber spaeter angelegte Entwuerfe (released_at NULL).
            if (table, column) == ("card_decks", "released_at"):
                sync_conn.execute(text("UPDATE card_decks SET released_at = now() WHERE released_at IS NULL"))

    # Spalten, die von NOT NULL auf nullable wandern.
    #
    # Die `wanted`-Liste oben kann nur ERGAENZEN, und create_all fasst
    # bestehende Tabellen nicht an — eine Lockerung braucht deshalb ihren
    # eigenen Schritt. Anlass: Kartenstapel liegen jetzt in EINER Sammlung und
    # werden Kursen zugewiesen (card_deck_kurse); Stapel und Ordner entstehen
    # dort ohne Klasse. Die Herkunft (class_id) bleibt an den Bestandszeilen
    # stehen und wird nicht geleert.
    #
    # Idempotent: DROP NOT NULL auf einer bereits nullable Spalte ist ein
    # No-op. Nur Postgres — SQLite kann eine bestehende Spalte nicht aendern,
    # dort entsteht die Tabelle ohnehin frisch aus dem Modell.
    if sync_conn.dialect.name == "postgresql":
        for table, column in (("card_decks", "class_id"), ("card_folders", "class_id")):
            if table not in existing_tables:
                continue
            try:
                with sync_conn.begin_nested():
                    sync_conn.execute(text(f"ALTER TABLE {table} ALTER COLUMN {column} DROP NOT NULL"))
            except Exception as e:  # noqa: BLE001 — darf den Start nicht kosten
                print(f"[STARTUP-WARN] {table}.{column} bleibt NOT NULL: {type(e).__name__}: {e} "
                      f"— Stapel ohne Klasse lassen sich dann nicht anlegen.", flush=True)

    # NULL, wo das Modell NOT NULL sagt — daran scheiterte das Zurueckspielen.
    #
    # Entstanden ist die Luecke bei jedem ADD COLUMN ohne DEFAULT: Postgres
    # laesst Bestandszeilen dann auf NULL stehen, waehrend das Modell die Spalte
    # als NOT NULL kennt (grade_categories.source_kind). Im Betrieb faellt das
    # nie auf — die ORM setzt beim Schreiben ihren Default. Es faellt erst beim
    # Zurueckspielen auf: der Auszug schreibt die NULL mit, die frische
    # Zieldatenbank entsteht aus create_all MIT dem NOT NULL, und der Probelauf
    # bricht mit IntegrityError ab. Also hier nachziehen, Quelle ist das Modell.
    from app.spalten import fuellwert

    frisch_null = sa_inspect(sync_conn)
    gefuellt, offen = [], []
    for tabelle in Base.metadata.sorted_tables:
        if tabelle.name not in existing_tables:
            continue
        db_spalten = {c["name"]: c for c in frisch_null.get_columns(tabelle.name)}
        for col in tabelle.c:
            db = db_spalten.get(col.name)
            if db is None or col.nullable or col.primary_key or db.get("nullable") is False:
                continue
            wert = fuellwert(col)
            if wert is None:
                offen.append(f"{tabelle.name}.{col.name}")
                continue
            ergebnis = sync_conn.execute(
                text(f"UPDATE {tabelle.name} SET {col.name} = :v WHERE {col.name} IS NULL"),
                {"v": wert},
            )
            n = getattr(ergebnis, "rowcount", 0) or 0
            if n:
                gefuellt.append(f"{tabelle.name}.{col.name} ({n})")
            # Die Spalte danach festziehen, damit die Luecke nicht wiederkommt.
            # Nur Postgres: SQLite kann eine bestehende Spalte nicht aendern.
            if sync_conn.dialect.name == "postgresql":
                try:
                    with sync_conn.begin_nested():
                        sync_conn.execute(text(
                            f"ALTER TABLE {tabelle.name} ALTER COLUMN {col.name} SET NOT NULL"))
                except Exception:  # noqa: BLE001 — kein Grund, den Start zu kosten
                    offen.append(f"{tabelle.name}.{col.name}")
    if gefuellt:
        print(f"[STARTUP] NULL-Werte in NOT-NULL-Spalten gefuellt: {', '.join(gefuellt)}", flush=True)
    if offen:
        print(f"[STARTUP-WARN] Spalten bleiben NULL-faehig: {', '.join(sorted(set(offen)))} "
              f"— eine Sicherung daraus laesst sich moeglicherweise nicht zurueckspielen.", flush=True)

    # Der Bestand: Spalten, die ein frueherer Deploy schon nackt nachgezogen hat.
    # Denen fehlt der Constraint bis heute — nachruesten geht nur auf Postgres,
    # SQLite kann einer bestehenden Tabelle keinen Fremdschluessel hinzufuegen
    # (dafuer muesste die Tabelle neu gebaut werden). Produktion ist Postgres;
    # auf SQLite wird sauber uebersprungen, der Selbsttest meldet den Rest.
    #
    # NOT VALID ist Absicht: Bestandsdaten koennen genau die Waisen enthalten,
    # deren Fehlen der Constraint kuenftig verhindert (Zeilen mit toter
    # owner_id/topic_id). Eine pruefende Variante wuerde daran scheitern und den
    # Start abbrechen; NOT VALID greift ab sofort fuer jede weitere Loeschung.
    if sync_conn.dialect.name == "postgresql":
        frisch = sa_inspect(sync_conn)  # der alte Inspector kennt die eben angelegten Spalten nicht
        nachgeruestet, gescheitert = [], []
        for (table, column), (ziel_t, ziel_c, ondelete) in fk_soll.items():
            if table not in existing_tables or ziel_t not in existing_tables:
                continue
            if column not in {c["name"] for c in frisch.get_columns(table)}:
                continue
            # Ein vorhandener Fremdschluessel wird nicht angefasst — auch nicht,
            # wenn sein ON DELETE abweicht. Das waere ein Umbau, keine additive
            # Migration; solche Faelle meldet der Selbsttest als Warnung.
            if any(fk["constrained_columns"] == [column] for fk in frisch.get_foreign_keys(table)):
                continue
            name = f"fk_{table}_{column}"
            try:
                with sync_conn.begin_nested():
                    sync_conn.execute(text(
                        f"ALTER TABLE {table} ADD CONSTRAINT {name} FOREIGN KEY ({column}) "
                        f"REFERENCES {ziel_t}({ziel_c}) ON DELETE {ondelete} NOT VALID"
                    ))
                nachgeruestet.append(f"{table}.{column}")
            except Exception as e:  # eine kaputte Tabelle darf den Start nicht kosten
                gescheitert.append(f"{table}.{column} ({type(e).__name__})")
        if nachgeruestet:
            print(f"[STARTUP] Fremdschluessel nachgeruestet: {', '.join(nachgeruestet)}", flush=True)
        if gescheitert:
            print(f"[STARTUP-WARN] Fremdschluessel nicht nachruestbar: {', '.join(gescheitert)} "
                  f"— ON DELETE greift dort nicht (Kontoloeschung/Themenloeschung pruefen).", flush=True)

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

    # Scans eindeutig je (Sitzung, Frage, Kind).
    #
    # Reihenfolge ist entscheidend: erst entdoppeln, dann den Index anlegen —
    # Bestandsdaten koennen Dubletten enthalten (sie entstanden genau dadurch,
    # dass die Bedingung fehlte), und die Indexanlage wuerde daran scheitern.
    # Behalten wird die JUENGSTE Zeile: submit_scan hat schon immer "letzter
    # Scan gewinnt" gemeint.
    if "scans" in existing_tables:
        sync_conn.execute(text(
            "DELETE FROM scans WHERE id NOT IN ("
            "  SELECT MAX(id) FROM scans GROUP BY session_id, question_id, student_id)"
        ))
        sync_conn.execute(text(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_scan_session_question_student "
            "ON scans (session_id, question_id, student_id)"
        ))

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

    from sqlalchemy import func, select, text

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

    # Schuljahr aus dem Kursnamen uebernehmen — einmalig und idempotent.
    # Bestandskurse heissen „6.5 Mathematik (2025-2026)", weil es bis jetzt kein
    # Feld dafuer gab. Der Name bleibt unangetastet; gesetzt wird nur, was leer
    # ist, damit eine spaetere Korrektur von Hand nicht ueberschrieben wird.
    #
    # In PYTHON, nicht in SQL: der erste Versuch stand als `text()` mit einem
    # regulaeren Ausdruck da, und SQLAlchemy las darin `(?:20)` als
    # Bind-Parameter „:20" — der Start brach ab, der Container blieb unhealthy.
    # Die Regel gibt es ohnehin schon einmal (kursmitglieder.schuljahr_aus_name), samt
    # Test; zweimal dieselbe Regel waere auch ohne den Unfall falsch gewesen.
    async with async_session() as db:

        offen = (await db.execute(
            select(Kurs).where(func.coalesce(Kurs.schuljahr, "") == "")
        )).scalars().all()
        gesetzt = 0
        for k in offen:
            jahr = schuljahr_aus_name(k.name)
            if jahr:
                k.schuljahr = jahr
                gesetzt += 1
        if gesetzt:
            await db.commit()
            print(f"[STARTUP] Schuljahr aus dem Namen uebernommen: {gesetzt} Kurs(e).", flush=True)

    # Beobachtungen und Klassenleitung gibt es nicht mehr als Module: die
        # Beobachtung ist als Kommentar an der Notenzelle aufgegangen, wo sie
        # hingehoert. Die Zuschaltungen fallen weg, sonst stehen sie ewig in
        # user_modules und tauchen bei jedem REGISTRY-Abgleich als Unbekannte
        # auf. Die TABELLEN (observations, parent_contacts) bleiben — dort
        # liegen echte Eintraege, und die vernichtet kein Umbau.
        await db.execute(text(
            "DELETE FROM user_modules WHERE module_key IN ('elternlog', 'klassenleitung', 'notizen')"))
        # Stoffverteilung + Einstiege sind ins Modul „Unterrichtsplanung" (2 Reiter)
        # aufgegangen. Daten (curriculum_items, methods) bleiben. Idempotent.
        await db.execute(text("""
            INSERT INTO user_modules (user_id, module_key)
            SELECT DISTINCT user_id, 'unterrichtsplanung' FROM user_modules WHERE module_key IN ('stoffplan', 'methoden')
            ON CONFLICT ON CONSTRAINT uq_user_module DO NOTHING
        """))
        await db.execute(text("DELETE FROM user_modules WHERE module_key IN ('stoffplan', 'methoden')"))
        # Mathefußball in das Sammelmodul „Mathespiele" umbenannt. Idempotent.
        await db.execute(text("""
            INSERT INTO user_modules (user_id, module_key)
            SELECT DISTINCT user_id, 'mathespiele' FROM user_modules WHERE module_key = 'mathefussball'
            ON CONFLICT ON CONSTRAINT uq_user_module DO NOTHING
        """))
        await db.execute(text("DELETE FROM user_modules WHERE module_key = 'mathefussball'"))
        # Noten + Klassenarbeit sind ins Modul „Auswertung" (Reiter) aufgegangen.
        # Daten (grade_*, exam_*) bleiben. Idempotent.
        await db.execute(text("""
            INSERT INTO user_modules (user_id, module_key)
            SELECT DISTINCT user_id, 'auswertung' FROM user_modules WHERE module_key IN ('noten', 'klassenarbeit')
            ON CONFLICT ON CONSTRAINT uq_user_module DO NOTHING
        """))
        await db.execute(text("DELETE FROM user_modules WHERE module_key IN ('noten', 'klassenarbeit')"))
        await db.commit()

    # Anwesenheit ist jetzt pro Stunde (student, date, period) statt pro Tag.
    # Der alte Unique-Constraint auf (student, date) würde die zweite Stunde
    # blockieren — droppen; das Modell bringt den neuen mit period selbst mit.
    async with async_session() as db:
        try:
            await db.execute(text("ALTER TABLE attendance DROP CONSTRAINT IF EXISTS uq_attendance_student_date"))
            await db.commit()
        except Exception as e:
            # Darf scheitern: SQLite (Pruefinstanz) kennt DROP CONSTRAINT nicht,
            # und vor der ersten create_all gibt es die Tabelle noch nicht. Der
            # Start darf daran nicht abbrechen — aber still bleiben auch nicht,
            # sonst sieht niemand, wenn es auf Postgres wirklich schiefgeht.
            await db.rollback()
            print(f"[STARTUP-WARN] uq_attendance_student_date nicht entfernt: {type(e).__name__}: {e}", flush=True)

    # Sitzplan hängt jetzt am Kurs (kurs_id); der alte Unique-Constraint auf
    # (owner, class_id) würde mehrere Fach-Kurse derselben Klasse blockieren.
    async with async_session() as db:
        try:
            await db.execute(text("ALTER TABLE seating_plans DROP CONSTRAINT IF EXISTS uq_seating_owner_class"))
            await db.commit()
        except Exception as e:
            # Wie oben: auf SQLite erwartbar, auf Postgres ein Befund.
            await db.rollback()
            print(f"[STARTUP-WARN] uq_seating_owner_class nicht entfernt: {type(e).__name__}: {e}", flush=True)

    # Bestandsnoten an den Kurs anschliessen: wo eine Klasse in GENAU EINEM Kurs
    # liegt, bekommen ihre Abschnitte/Endnoten-Overrides dessen kurs_id — sonst
    # (Klasse in mehreren Kursen = mehrdeutig) bleibt NULL und die Lehrkraft
    # ordnet neu zu. Nur Zeilen mit kurs_id IS NULL, damit es idempotent bleibt.
    async with async_session() as db:
        try:
            # Dieselbe Anweisung fuer fuenf Tabellen — sie stand dreimal
            # ausgeschrieben da (grade_sections, grade_overrides und eine
            # Schleife ueber die restlichen drei), Wort fuer Wort gleich bis auf
            # den Tabellennamen. Sitzplan, Orga-Checklisten und Decks muessen
            # mit, sonst „verschwinden" sie, sobald der Selektor den Kurs
            # mitschickt. Karten haben ihre kurs_id schon beim Anlegen bekommen
            # (cls.kurs_id).
            for tbl in ("grade_sections", "grade_overrides", "seating_plans",
                        "orga_items", "card_decks"):
                await db.execute(text(f"""
                    WITH single AS (
                      SELECT class_id, MIN(kurs_id) AS kurs_id FROM (
                        SELECT class_id, kurs_id FROM kurs_tags
                        UNION SELECT id AS class_id, kurs_id FROM school_classes WHERE kurs_id IS NOT NULL
                      ) m GROUP BY class_id HAVING COUNT(DISTINCT kurs_id) = 1
                    )
                    UPDATE {tbl} x SET kurs_id = s.kurs_id
                    FROM single s WHERE x.class_id = s.class_id AND x.kurs_id IS NULL
                """))
            await db.commit()
        except Exception as e:
            # Reiner Backfill (kurs_id nachtragen): scheitert er, laeuft die
            # Installation weiter, die Zeilen bleiben nur ohne Kurs. Deshalb kein
            # Abbruch — aber sichtbar, sonst sucht niemand die Ursache dafuer,
            # dass Sitzplan/Orga/Decks „verschwunden" wirken.
            await db.rollback()
            print(f"[STARTUP-WARN] Kurs-Backfill uebersprungen: {type(e).__name__}: {e}", flush=True)

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

    # Karteikarten: Bestandsstapel in die neue Kurs-Zuweisung heben (einmalig je
    # Konto, siehe karten.uebernahme_deck_kurse). Ohne das stuenden nach dem
    # Umbau alle Stapel als „keinem Kurs zugewiesen" da und kein Kind bekaeme
    # noch Karten.
    async with async_session() as db:
        try:
            n = await uebernahme_deck_kurse(db)
            if n:
                print(f"[STARTUP] Karten: {n} Kurs-Zuweisung(en) aus dem Bestand uebernommen.", flush=True)
        except Exception as e:
            await db.rollback()
            print(f"[STARTUP-WARN] Karten-Zuweisung nicht uebernommen: {type(e).__name__}: {e} "
                  f"— Stapel gelten dann weiter ueber ihre Herkunftsklasse.", flush=True)

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
        except Exception as e:
            # Korrektur am Bestand — darf den Start nicht kosten, muss aber im
            # Log stehen: sonst werden Karten-Decks weiter als Quiz angezeigt und
            # niemand weiss, warum.
            await db.rollback()
            print(f"[STARTUP-WARN] Marktplatz-kind nicht korrigiert: {type(e).__name__}: {e}", flush=True)

    # Papierkorb einmal beim Start leeren; danach uebernimmt die Schleife weiter
    # unten. Nur beim Start reichte nicht: ein Container laeuft monatelang durch,
    # und dann wurde die zugesagte 30-Tage-Frist nie eingehalten.
    await _papierkorb_leeren(laut=True)

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

    # Hintergrund-Tasks: Fristen einhalten, auch ohne Neustart.
    asyncio.create_task(_cleanup_unverified_loop())   # unbestaetigte Konten, 14 Tage
    asyncio.create_task(_papierkorb_loop())           # Papierkorb, 30 Tage
    asyncio.create_task(_codesessions_aufraeumen())   # Code-Detektiv-Sitzungen
    asyncio.create_task(backup.plan_loop())           # geplante Sicherungen, stuendlich geprueft


# Arten des gemeinsamen Papierkorbs (routers/trash.py). Kinder zuerst, damit die
# Zaehlung stimmt. Neue Art mit deleted_at gehoert HIER dazu — dafuer gibt es den
# Test test_papierkorb_job.py.
PAPIERKORB_TABELLEN = (
    ("cards", "Karte(n)"), ("learning_ladders", "Lernleiter(n)"),
    ("school_classes", "Klasse(n)"), ("card_decks", "Deck(s)"),
    ("learning_paths", "Lernpfad(e)"), ("kurse", "Kurs(e)"),
    # Fragen vor Themen: eine Frage zeigt per topic_id auf ihr Thema. Andersherum
    # bliebe sie fuer den Rest des Laufs auf eine geloeschte ID zeigen.
    ("questions", "Frage(n)"), ("topics", "Thema/Themen"),
)


async def _papierkorb_leeren(laut: bool = False):
    """Endgueltig loeschen, was laenger als 30 Tage im Papierkorb liegt."""
    from sqlalchemy import text
    async with async_session() as db:
        for tbl, wort in PAPIERKORB_TABELLEN:
            try:
                res = await db.execute(text(
                    f"DELETE FROM {tbl} WHERE deleted_at IS NOT NULL "
                    "AND deleted_at < now() - interval '30 days'"
                ))
                await db.commit()
                if res.rowcount and laut:
                    print(f"[STARTUP] Papierkorb: {res.rowcount} {wort} endgültig gelöscht (>30 Tage).", flush=True)
            except Exception as e:
                # Je Tabelle committen und im Fehlerfall zuruecksetzen: sonst
                # reisst eine fehlende Tabelle die ganze Transaktion in den
                # Abbruchzustand, alle folgenden DELETEs scheitern still mit —
                # und die 30-Tage-Frist aus der Datenschutzerklaerung waere
                # unbemerkt nicht eingehalten.
                await db.rollback()
                print(f"[WARN] Papierkorb: {tbl} nicht geleert: {type(e).__name__}: {e}", flush=True)


async def _papierkorb_loop():
    """Die 30-Tage-Frist steht in der Datenschutzerklaerung — also muss sie auch
    laufen, wenn der Container nicht neu startet."""
    while True:
        await asyncio.sleep(6 * 3600)
        await _papierkorb_leeren()


async def _codesessions_aufraeumen():
    """Code-Detektiv-Sitzungen verfallen.

    In einer Sitzung stehen selbst eingegebene Namen und der Loesungsstand aller
    Mitspielenden — abrufbar fuer jeden mit dem sechsstelligen Code. Ohne Ablauf
    blieb diese Liste dauerhaft oeffentlich. Beendete Sitzungen gehen nach einem
    Tag, offen gebliebene nach sieben.
    """
    from sqlalchemy import text
    while True:
        try:
            async with async_session() as db:
                # Die Frist laeuft ab dem ENDE, nicht ab dem Anlegen: eine
                # vorbereitete Runde wird oft Tage spaeter gespielt, und ihr
                # Ergebnis soll bis dahin uebernehmbar bleiben. Beendete
                # Sitzungen ohne Zeitstempel (Bestand) faellt die Sieben-Tage-
                # Regel weiter ab.
                await db.execute(text(
                    "DELETE FROM code_sessions WHERE "
                    "(ended_at IS NOT NULL AND ended_at < now() - interval '1 day') "
                    "OR created_at < now() - interval '7 days'"
                ))
                await db.commit()
        except Exception as e:
            # Die Schleife muss weiterlaufen (ein Ausfall darf die Frist nicht
            # dauerhaft aussetzen), der Fehlschlag aber sichtbar sein: sonst
            # bleiben Sitzungen mit Namen unbegrenzt oeffentlich abrufbar.
            print(f"[WARN] Code-Sitzungen nicht aufgeraeumt: {type(e).__name__}: {e}", flush=True)
        await asyncio.sleep(3600)


async def _cleanup_unverified_loop():
    from sqlalchemy import text
    while True:
        try:
            async with async_session() as db:
                await db.execute(text(
                    "DELETE FROM users "
                    "WHERE email_verified = false AND created_at < NOW() - INTERVAL '14 days'"
                ))
                await db.commit()
        except Exception as e:
            # Weiterlaufen ja, schweigen nein — die 14-Tage-Frist fuer
            # unbestaetigte Konten ist zugesagt.
            print(f"[WARN] Unbestaetigte Konten nicht aufgeraeumt: {type(e).__name__}: {e}", flush=True)
        await asyncio.sleep(6 * 3600)  # alle 6 Stunden


async def _ws_is_session_owner(token: str, session_id: int) -> bool:
    """Prueft, ob das Token zur Besitzer-Person der Session gehoert (fuer Steuerbefehle)."""
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


# Letztes gutes Ergebnis der Datenbankprobe mit Zeitstempel.
# /api/health ist der am haeufigsten gerufene Endpunkt der ganzen Installation:
# jeder offene Tab fragt ihn regelmaessig, dazu der Container-Healthcheck. Jede
# Anfrage holte eine Verbindung aus dem Pool und schickte ein SELECT 1 — bei
# einem Kollegium mit vielen offenen Tabs dauerhaft Grundlast, die nichts sagt,
# was sie zwei Sekunden vorher nicht schon gesagt hat.
_HEALTH_TTL = 3.0
_health_ok_bis = 0.0


@app.get("/api/health")
async def health():
    # Prüft auch die Datenbank — sonst wäre "ok", obwohl keine Daten gespeichert werden können
    global _health_ok_bis
    from sqlalchemy import text
    from fastapi.responses import JSONResponse
    # Nur das GUTE Ergebnis wird kurz gemerkt. Ein Fehler nie: faellt die
    # Datenbank aus, soll der naechste Aufruf das sofort sehen, nicht erst nach
    # Ablauf einer Frist.
    if _time.time() < _health_ok_bis:
        return {"status": "ok"}
    try:
        async with async_session() as db:
            await db.execute(text("SELECT 1"))
        _health_ok_bis = _time.time() + _HEALTH_TTL
        return {"status": "ok"}
    except Exception:
        # Kein Zuruecksetzen noetig: hierher kommt nur, wessen Frist ohnehin
        # abgelaufen ist. Gemerkt wird weiter nur das gute Ergebnis.
        return JSONResponse(status_code=503, content={"status": "db_down"})


# --- Version / Update-Check ---
# `_require_admin` und `APP_VERSION` stehen in app/admin.py, nicht hier: dort
# importiert nichts einen Router, und nur deshalb kann backup.py sie oben
# holen statt mitten in der Funktion (siehe Modulkopf von admin.py).
import pathlib as _pathlib

GITHUB_VERSION_URL = os.environ.get(
    "GITHUB_VERSION_URL", "https://raw.githubusercontent.com/norbert-me/Nuvora/main/apps/api/VERSION"
)
# Stable = letztes veroeffentlichtes Nicht-Prerelease-Release. GitHubs
# /releases/latest schliesst Prereleases (= Beta-Kanal) und Entwuerfe aus.
GITHUB_RELEASE_URL = os.environ.get(
    "GITHUB_RELEASE_URL", "https://api.github.com/repos/norbert-me/Nuvora/releases/latest"
)
# Beta = neuestes Release inkl. Prerelease. GitHubs /releases ist nach Erstellzeit
# absteigend sortiert; das erste nicht-Entwurf-Release ist das aktuellste (Pre-)Release.
GITHUB_RELEASES_URL = os.environ.get(
    "GITHUB_RELEASES_URL", "https://api.github.com/repos/norbert-me/Nuvora/releases?per_page=20"
)
# Kanal je Instanz. "stable" = nur letztes echtes Release (kein Prerelease);
# "beta" = neuestes Release inkl. Prerelease. Steht in app_settings, hier nur der Fallback.
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
    """Tag des neuesten Releases inkl. Prerelease (Beta-Kanal). Die Liste kommt
    nach Erstellzeit absteigend; das erste veroeffentlichte (kein Entwurf)
    Release ist das aktuellste — egal ob Prerelease oder Vollrelease, damit Beta
    auch ein neueres Stable nicht verpasst. Leer, wenn es noch keins gibt."""
    import urllib.request, json as _json
    req = urllib.request.Request(GITHUB_RELEASES_URL, headers={"User-Agent": "Nuvora", "Accept": "application/vnd.github+json"})
    with urllib.request.urlopen(req, timeout=5) as r:
        data = _json.loads(r.read().decode("utf-8", "ignore"))
    for rel in (data if isinstance(data, list) else []):
        if rel.get("draft"):
            continue
        return (rel.get("tag_name") or "").strip()
    return ""


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
    admin_email = (os.environ.get("ADMIN_EMAIL") or "").strip()
    contact_to = contact_recipient()  # ADMIN_EMAIL (echte Adresse) sonst SMTP_FROM
    # Faellt der Empfaenger auf SMTP_FROM zurueck? Diese Adresse ist oft eine
    # reine Versand-Adresse OHNE Postfach (z.B. Cloudflare "welcome@…") — SMTP
    # nimmt die Mail an (250 OK), zugestellt wird sie an niemanden. Haeufigster
    # Grund fuer "wird gesendet, kommt aber nie an".
    smtp_from = (os.environ.get("SMTP_FROM") or "").strip()
    contact_fallback = bool(contact_to) and contact_to == smtp_from and "@" not in admin_email
    return {
        "smtp": mailer.email_configured(),
        "site_json": site.exists(),
        "admin_email": bool(admin_email),
        # Kann das Kontaktformular wirklich zustellen? (echte Empfaengeradresse + SMTP)
        "contact_deliverable": bool(contact_to) and mailer.email_configured(),
        "contact_to": contact_to,
        "contact_fallback": contact_fallback,
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


def contact_recipient() -> str:
    """Zustellbare Empfaengeradresse fuers Kontaktformular.

    ADMIN_EMAIL ist zugleich der Admin-LOGIN und oft KEINE echte Mailadresse
    (z.B. "admin"). Dann faellt der Empfaenger auf SMTP_FROM (das eigene Postfach
    des Betreibers) zurueck. Ist auch das keine Adresse, gibt es keinen Empfaenger
    (leerer String) — genau hier scheiterte der Versand bisher lautlos.
    """
    to = (os.environ.get("ADMIN_EMAIL") or "").strip()
    if "@" not in to:
        to = (os.environ.get("SMTP_FROM") or "").strip()
    return to if "@" in to else ""


class BugBody(_BaseModel):
    message: str
    log: str = ""
    seite: str = ""
    # Technische Eckdaten des Geraets (Fenstergroesse, Browser, Netz, aktive
    # Module) — von der Oberflaeche zusammengestellt und dort VOR dem Absenden
    # im Klartext gezeigt. Inhaltsfrei wie das Protokoll; siehe
    # apps/web/src/core/protokoll.js (umgebung()).
    umgebung: str = ""


@app.post("/api/bugreport")
async def bugreport(body: BugBody, request: Request, user=Depends(get_current_user)):
    """Fehlermeldung aus der Oberflaeche — mit dem Protokoll der letzten Minuten.

    Nur fuer ANGEMELDETE: das ist der erste und wirksamste Spam-Schutz. Ein
    offenes Formular an einer festen Adresse wird gefunden und zugemuellt; hier
    braucht es ein bestaetigtes Konto, und wer eins missbraucht, ist bekannt.

    Darueber hinaus drei Bremsen, weil ein Konto auch aus Versehen Unfug
    schicken kann (ein Knopf, der klemmt, ein Skript in einer Schleife):

      1. je Konto 5 Meldungen je Stunde,
      2. zusaetzlich je IP 10 je Stunde — ein Angreifer mit zehn Konten sitzt
         meist auf einer Leitung,
      3. harte Laengen: alles darueber wird abgeschnitten, nicht abgelehnt —
         eine abgeschnittene Meldung ist besser als keine.

    Kopfzeilen-Injektion ist ausgeschlossen (Zeilenumbrueche raus, siehe unten);
    der Absender der Mail bleibt SMTP_FROM, Reply-To zeigt auf das Konto.
    """
    from . import mailer

    rate_limit("bug_user", f"u{user.id}", 5, 3600, "Zu viele Meldungen. Bitte spaeter erneut.")
    rate_limit("bug_ip", client_ip(request), 10, 3600, "Zu viele Meldungen. Bitte spaeter erneut.")

    to = contact_recipient()
    if not to:
        raise HTTPException(503, "Fehlermeldung derzeit nicht moeglich")

    def _hdr(s: str) -> str:
        return (s or "").replace("\r", " ").replace("\n", " ").strip()

    text = (body.message or "").strip()[:3000]
    if not text:
        raise HTTPException(400, "Bitte beschreibe kurz, was passiert ist")
    log = (body.log or "").strip()[:20000]
    umgebung = (body.umgebung or "").strip()[:2000]
    # Der User-Agent sagt, welcher Browser — das ist bei einer Anzeigefrage oft
    # die halbe Antwort und steht ohnehin in jedem Request.
    browser = _hdr(request.headers.get("user-agent", ""))[:200]

    rumpf = (
        f"Konto: {user.email} (#{user.id})\n"
        f"Seite: {_hdr(body.seite)[:200]}\n"
        f"Fassung: {APP_VERSION}\n"
        f"Browser: {browser}\n\n"
        f"{text}\n"
    )
    if umgebung:
        rumpf += f"\n--- Umgebung (vom Melder freigegeben) ---\n{umgebung}\n"
    if log:
        rumpf += f"\n--- Protokoll (vom Melder freigegeben) ---\n{log}\n"

    ok = await mailer.send_email(to, f"Nuvora Fehlermeldung von {user.email}", rumpf,
                                 reply_to=_hdr(user.email))
    if not ok:
        raise HTTPException(503, "Meldung konnte nicht gesendet werden")
    return {"ok": True}


@app.post("/api/contact")
async def contact(body: ContactBody, request: Request):
    from . import mailer
    rate_limit("contact", client_ip(request), 5, 3600, "Zu viele Nachrichten. Bitte später erneut versuchen.")
    to = contact_recipient()
    if not to:
        raise HTTPException(503, "Kontaktformular derzeit nicht verfügbar")
    # Zeilenumbrueche aus Nutzereingaben strippen — verhindert E-Mail-Header-Injection im Subject
    def _hdr(s: str) -> str:
        return s.replace("\r", " ").replace("\n", " ").strip()
    sender = _hdr(body.name) or _hdr(body.email)
    # Reply-To auf den Absender, damit der Betreiber direkt antworten kann
    # (die Mail selbst kommt von SMTP_FROM, nicht vom Besucher).
    ok = await mailer.send_email(
        to,
        f"Nuvora Kontaktanfrage von {sender}",
        f"Von: {sender} <{_hdr(body.email)}>\n\n{body.message.strip()}",
        reply_to=_hdr(body.email),
    )
    if not ok:
        raise HTTPException(503, "Nachricht konnte nicht gesendet werden")
    return {"ok": True}
