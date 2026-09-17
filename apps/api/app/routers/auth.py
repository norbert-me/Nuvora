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
from sqlalchemy import String, cast, delete, or_, select, update as sa_update
from sqlalchemy.ext.asyncio import AsyncSession

from ..netz import client_ip as _client_ip
from ..seed import seed_new_account
from ..rollen import ist_admin
from ..database import get_db
from ..models import BugReport, CaldavToken, User, Question, MarketplaceQuiz
from .. import mailer

# Im Container /app/uploads (Volume). Ueberschreibbar, damit Tests und die
# lokale Pruefinstanz nicht ins Wurzelverzeichnis schreiben muessen.
UPLOAD_DIR = os.environ.get("NUVORA_UPLOAD_DIR", "/app/uploads")


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
    # 2b) Fehlermeldungen bleiben stehen (SET NULL, damit ein Bericht nicht mit
    #     dem Konto verschwindet) — die E-Mail-Adresse darin nicht. Sie ist die
    #     einzige Personenangabe im Datensatz und hat nach dem Löschen des
    #     Kontos keinen Zweck mehr; die Meldung bleibt ohne sie lesbar.
    #     Dasselbe gilt fuer Anhang und Protokoll: der Anhang ist ein von der
    #     Lehrkraft gewaehlter Screenshot (darauf stehen Namen), das Protokoll
    #     ihre letzten Seitenwechsel. Beides gehoert der Person, nicht dem
    #     Bericht — der Meldungstext bleibt fuer die Bearbeitung stehen.
    await db.execute(sa_update(BugReport).where(BugReport.user_id == user_id).values(
        email="", anhang=None, anhang_name="", anhang_typ="", log=""))
    # 3) Dateien löschen — aber nur, wenn sie AUSSCHLIESSLICH diesem Konto
    #    gehoeren. Uebernommene Kopien referenzieren dieselbe URL — als
    #    Fragebild, als Antwortbild (choice_images) und in besitzlosen
    #    Bestandsfragen (owner_id NULL, fuer alle lesbar). Vorher zaehlte nur
    #    das Fragebild eines fremden Kontos; ein Antwortbild oder eine
    #    Bestandsfrage verlor ihr Bild mit dem Konto eines anderen.
    fremd = or_(Question.owner_id != user_id, Question.owner_id.is_(None))
    for url in urls:
        if not url.startswith("/api/uploads/"):
            continue
        andere = (await db.execute(
            select(Question.id).where(fremd, or_(
                Question.image_url == url,
                cast(Question.choice_images, String).contains(url),
            )).limit(1)
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
from ..oeffentlich import site_url as _site_url  # eine Quelle fuer die oeffentliche Adresse

SITE_URL = _site_url()

router = APIRouter(prefix="/api/auth", tags=["auth"])

SECRET = os.environ.get("TOKEN_SECRET", secrets.token_hex(32))
TOKEN_TTL = 86400 * 30  # 30 Tage; per Sliding-Renewal (siehe get_current_user)
                        # bekommt ein aktiver Nutzer laufend einen frischen Token,
                        # laeuft also praktisch nie ab. Nur echtes Nichtstun > 30 Tage
                        # (oder token_version-Wechsel) meldet ab.

# Hoechstdauer einer Sitzung, gerechnet ab der ANMELDUNG. Die gleitende
# Verlaengerung oben traegt den Beginn der Ursprungssitzung mit (vierter Teil
# des Tokens) — ohne diese Grenze haette ein einmal abgegriffener Token bei
# regelmaessiger Benutzung ewig gegolten. Nach 90 Tagen meldet man sich neu an.
TOKEN_MAX = 86400 * 90

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
# Gegen das Zeit-Orakel bei der Anmeldung: eine unbekannte Adresse sprang
# frueher am Argon2-Aufruf vorbei und war nach ~0 ms beantwortet, eine bekannte
# nach ~14 ms. Das ist ein Erkennungskanal ohne jede Grenze — er verraet, WER
# ein Konto hat, und das Rate-Limit deckt ihn nicht, weil die Antwort in beiden
# Faellen „falsch" lautet. `_verify_pw` prueft deshalb bei unbekannter Adresse
# gegen diesen Blindwert.
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


# Einmal beim Start gerechnet (~14 ms) — nicht je Anmeldung.
_DUMMY_PW_HASH = _hasher.hash("nuvora-blindpruefung")


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


def _make_token(user_id: int, token_version: int = 0, beginn: Optional[int] = None) -> str:
    """`beginn` ist der Zeitpunkt der Anmeldung, zu der dieser Token gehoert —
    bei der gleitenden Verlaengerung der alte, sonst jetzt."""
    ts = int(time.time())
    payload = f"{user_id}:{token_version}:{ts}:{int(beginn if beginn is not None else ts)}"
    sig = hmac.new(SECRET.encode(), payload.encode(), "sha256").hexdigest()[:32]
    return f"{payload}:{sig}"


def _token_teile(token: str) -> Optional[tuple[int, int, int, int]]:
    """(user_id, token_version, ausgestellt, anmeldung) — oder None.

    Aeltere Tokens tragen keinen Anmeldezeitpunkt; fuer sie gilt der
    Ausstellungszeitpunkt (die Hoechstdauer zaehlt dann ab der letzten
    Verlaengerung, danach traegt der neue Token den Beginn mit)."""
    try:
        parts = token.rsplit(":", 1)
        if len(parts) != 2:
            return None
        payload, sig = parts
        expected = hmac.new(SECRET.encode(), payload.encode(), "sha256").hexdigest()[:32]
        if not hmac.compare_digest(sig, expected):
            return None
        segments = payload.split(":")
        if len(segments) == 4:
            user_id, tv, ts, beginn = segments
            return int(user_id), int(tv), int(ts), int(beginn)
        if len(segments) == 3:
            user_id, tv, ts = segments
            return int(user_id), int(tv), int(ts), int(ts)
        elif len(segments) == 2:
            user_id, ts = segments
            return int(user_id), 0, int(ts), int(ts)
        return None
    except Exception:
        return None


def _verify_token(token: str) -> Optional[tuple[int, int, int]]:
    teile = _token_teile(token)
    return teile[:3] if teile else None


def token_gueltig_bis(teile: tuple[int, int, int, int], jetzt: Optional[int] = None) -> bool:
    """Frist UND Hoechstdauer — eine Stelle fuer HTTP und WebSocket."""
    jetzt = int(time.time()) if jetzt is None else jetzt
    _uid, _tv, ts, beginn = teile
    return jetzt - ts <= TOKEN_TTL and jetzt - beginn <= TOKEN_MAX


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


# Ein Bestaetigungslink hatte bisher WEDER Frist NOCH Verbrauch: derselbe Link
# aktivierte das Konto noch Monate spaeter, und ein Adresswechsel hin und
# zurueck machte alte Links wieder gueltig. Die Frist ist dieselbe, nach der ein
# unbestaetigtes Konto ohnehin geloescht wird (siehe Mailtext) — laenger kann
# ein Link nicht sinnvoll gelten. Wer ihn verpasst, fordert unter
# `/api/auth/resend-verification` einen neuen an; der Weg sagt wie bisher
# nichts darueber, ob es die Adresse gibt.
VERIFY_TTL = 86400 * 14


def _make_verify_token(user: User) -> str:
    ts = int(time.time())
    payload = f"{user.id}:{ts}"
    sig = hmac.new(SECRET.encode(), _verify_msg(payload, user), "sha256").hexdigest()[:32]
    return base64.urlsafe_b64encode(f"{payload}:{sig}".encode()).decode().rstrip("=")


def _verify_msg(payload: str, user: User) -> bytes:
    """Der Link haengt am PASSWORT des Kontos, nicht nur an der Adresse.

    Registriert jemand eine fremde Adresse, bekommt die echte Besitzerin die
    Bestaetigungsmail. Registriert sie sich danach selbst, gilt ihr Passwort
    (siehe `register`) — und nur noch der Link, der zu DIESEM Passwort
    gehoert. Vorher bestaetigte ihr Klick das Konto des anderen, samt dessen
    Passwort."""
    return f"verify:{payload}:{user.email}:{(user.password_hash or '')[-24:]}".encode()


# Der Link zum Adresswechsel galt unbegrenzt: wer ihn Monate spaeter in einem
# alten Postfach fand, stellte das Konto noch um. Jetzt mit Zeitstempel in der
# Signatur (dieselbe Bauform wie VERIFY_TTL) — ein Tag reicht fuer eine Mail,
# die man gerade selbst angefordert hat.
EMAIL_CHANGE_TTL = 86400


def _email_change_sig(user_id: int, ts: int, pending: str) -> str:
    return hmac.new(SECRET.encode(), f"emailchange:{user_id}:{ts}:{pending}".encode(),
                    "sha256").hexdigest()[:32]


def _make_email_change_token(user: User) -> str:
    ts = int(time.time())
    sig = _email_change_sig(user.id, ts, user.pending_email or "")
    return base64.urlsafe_b64encode(f"{user.id}:{ts}:{sig}".encode()).decode().rstrip("=")


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


async def _send_schon_vergeben_mail(user: User):
    """Antwort auf eine Registrierung mit einer Adresse, die es schon gibt.

    Sie geht an die EIGENTUEMERIN der Adresse, nicht an die anfragende Seite —
    deshalb verraet sie niemandem etwas, den es nichts angeht, und sagt der
    richtigen Person genau das, was sie wissen muss.
    """
    link = f"{SITE_URL}/forgot-password" if SITE_URL else "/forgot-password"
    await mailer.send_email(
        user.email,
        "Nuvora — Konto besteht bereits",
        "Hallo,\n\n"
        "mit dieser Adresse wurde gerade versucht, ein Nuvora-Konto anzulegen — "
        "es gibt aber schon eines.\n\n"
        "Warst du das und hast dein Passwort vergessen, setze es hier zurück:\n\n"
        f"{link}\n\n"
        "Warst du das nicht, kannst du diese Nachricht ignorieren. "
        "Es wurde nichts angelegt und nichts geändert.\n\n"
        "Viele Grüße\nDein Nuvora-Team",
    )


async def get_current_user(request: Request, response: Response, db: AsyncSession = Depends(get_db)) -> User:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(401, "Nicht angemeldet")
    result = _token_teile(auth[7:])
    if result is None:
        raise HTTPException(401, "Token ungültig oder abgelaufen")
    user_id, tv, ts, beginn = result
    if not token_gueltig_bis(result):
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
        response.headers["X-Refresh-Token"] = _make_token(user.id, user.token_version, beginn)
    return user


def _check_rate_limit(ip: str):
    """Anmeldeversuche je Adresse.

    Lief frueher ueber ein eigenes `_login_attempts`, das NIE ausgekehrt wurde:
    jede neue Adresse legte einen Eintrag an, der fuer immer blieb — Speicher,
    den man von aussen beliebig aufblasen kann. Jetzt derselbe Eimer wie
    ueberall sonst, samt Kehrmaschine.
    """
    rate_limit("login", ip, MAX_LOGIN_ATTEMPTS, LOGIN_WINDOW,
               "Zu viele Anmeldeversuche. Bitte warte eine Minute.")


# Generischer, wiederverwendbarer Sliding-Window-Limiter (pro IP + Bucket)
_buckets: dict[str, list[float]] = defaultdict(list)


def fehlversuche_pruefen(bucket: str, kennung: str, max_hits: int, window: int,
                         msg: str = "Zu viele Fehlversuche. Bitte kurz warten."):
    """Wie `rate_limit`, zaehlt aber NICHT mit — gezaehlt wird nur ueber
    `fehlversuch_merken`, also nach einem falschen Passwort.

    Fuer die Bremse je KONTO: zaehlte sie jede Anmeldung, reichte ein
    fremdes Skript mit beliebigen Passwoertern, um die echte Lehrkraft
    auszusperren — und deren eigene erfolgreiche Anmeldungen (mehrere Geraete,
    CalDAV alle paar Minuten) trieben den Zaehler zusaetzlich hoch.
    """
    now = time.time()
    _buckets_auskehren(now)
    key = f"{bucket}:{kennung}"
    hits = [t for t in _buckets.get(key, ()) if now - t < window]
    if hits:
        _buckets[key] = hits
    if len(hits) >= max_hits:
        retry = max(1, int(window - (now - min(hits))))
        raise HTTPException(429, msg, headers={"Retry-After": str(retry)})


def fehlversuch_merken(bucket: str, kennung: str):
    _buckets[f"{bucket}:{kennung}"].append(time.time())


# Adressen, von denen aus sich ein Konto zuletzt erfolgreich angemeldet hat.
# Die Konto-Bremse zaehlt nur Fehlversuche — die kann ein Fremder trotzdem
# anhaeufen und die Lehrkraft damit fuer ein paar Minuten aussperren. Von
# einer Adresse, die fuer dieses Konto schon einmal das richtige Passwort
# kannte, gilt die Konto-Bremse deshalb nicht (die Bremse je Adresse gilt
# weiter). Nur im Arbeitsspeicher und begrenzt: nach einem Neustart greift die
# Bremse eben wieder fuer alle, bis zur ersten Anmeldung.
_BEKANNT_TTL = 86400 * 30
_BEKANNT_MAX = 20_000
_bekannte_adressen: dict[tuple[str, str], float] = {}


def _adresse_bekannt(email: str, ip: str) -> bool:
    t = _bekannte_adressen.get((email, ip))
    return bool(t) and time.time() - t < _BEKANNT_TTL


def _adresse_merken(email: str, ip: str):
    if len(_bekannte_adressen) >= _BEKANNT_MAX:
        for k in sorted(_bekannte_adressen, key=_bekannte_adressen.get)[: _BEKANNT_MAX // 2]:
            _bekannte_adressen.pop(k, None)
    _bekannte_adressen[(email, ip)] = time.time()


# Stand hier und in main.py wortgleich; die Rechnung liegt jetzt in app/netz.py.
# Der Name bleibt: die Router holen ihn seit jeher aus auth.
client_ip = _client_ip


def rate_limit(bucket: str, ip: str, max_hits: int, window: int, msg: str = "Zu viele Anfragen. Bitte kurz warten."):
    """Gleitendes Fenster je Bucket + Kennung.

    Die Kennung ist NICHT immer eine IP: auf den Schueler-Wegen (Karten-Token,
    Code-Detektiv-Sitzungscode) waere sie die falsche Einheit — eine Schulklasse
    haengt hinter EINER Adresse, 30 Kinder waeren fuer den Server ein Client.
    Dort wird je Token bzw. je Sitzungscode gezaehlt; siehe karten.py und
    codedetektiv.py.

    `_buckets` waechst sonst unbegrenzt: jede neue Adresse, jeder Token und jeder
    erratene Sitzungscode legt einen Eintrag an, der nie wieder verschwindet —
    Speicher, der sich von aussen beliebig aufblasen laesst. Darum wird
    regelmaessig ausgekehrt.
    """
    now = time.time()
    _buckets_auskehren(now)
    key = f"{bucket}:{ip}"
    hits = [t for t in _buckets.get(key, ()) if now - t < window]
    if len(hits) >= max_hits:
        hits_sorted = sorted(hits)
        retry = max(1, int(window - (now - hits_sorted[0])))
        _buckets[key] = hits
        raise HTTPException(429, msg, headers={"Retry-After": str(retry)})
    hits.append(now)
    _buckets[key] = hits


# Laengstes im Code benutztes Fenster (cd_session/changeemail: 3600 s). Wer
# laenger nicht aufgefallen ist, braucht keinen Eintrag mehr.
_BUCKET_MAX_ALTER = 3600
_BUCKET_MAX_SCHLUESSEL = 50_000


def _buckets_auskehren(now: float):
    """Alte Eintraege wegwerfen — hoechstens einmal je Minute, damit das Kehren
    nicht teurer wird als das Zaehlen."""
    if now - _buckets_auskehren.zuletzt < 60:
        return
    _buckets_auskehren.zuletzt = now
    for k in [k for k, v in list(_buckets.items()) if not v or now - v[-1] > _BUCKET_MAX_ALTER]:
        _buckets.pop(k, None)
    # Notbremse: bleibt es trotzdem gross (Flut vieler frischer Kennungen),
    # fliegt die aeltere Haelfte raus. Lieber ein zu grosszuegiges Limit als
    # ein Prozess, der am Speicher stirbt.
    if len(_buckets) > _BUCKET_MAX_SCHLUESSEL:
        nach_alter = sorted(_buckets.items(), key=lambda kv: kv[1][-1] if kv[1] else 0)
        for k, _ in nach_alter[: len(nach_alter) // 2]:
            _buckets.pop(k, None)


_buckets_auskehren.zuletzt = 0.0


def _check_pw_length(v: str) -> str:
    """Laengenregel fuer ein NEUES Passwort (min. 8, max. 256).

    War dreimal wortgleich als Validator da (Register, ChangePassword, Reset).
    LoginBody bleibt aussen vor: dort nur die Obergrenze (ein Bestandspasswort
    darf kuerzer sein) und mit anderer Meldung.
    """
    if len(v) < 8:
        raise ValueError("Passwort muss mindestens 8 Zeichen lang sein")
    if len(v) > 256:
        raise ValueError("Passwort zu lang (max. 256 Zeichen)")
    return v


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
        return _check_pw_length(v)

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
        return _check_pw_length(v)


class UpdateProfileBody(BaseModel):
    name: str
    salutation: str
    grade_scale: Optional[dict] = None
    grade_tendency: Optional[bool] = None
    # "da" (anwesend) oder "fehlt" (abwesend) — alles andere wird ignoriert.
    anwesenheit_default: Optional[str] = None
    marketplace_name: Optional[str] = None
    # Schuljahr: Beginn der Halbjahre und Jahresende, als "JJJJ-MM-TT" oder ""
    # zum Loeschen. Am Konto, weil das Schuljahr fuer alle Klassen dieser
    # Lehrkraft dasselbe ist (siehe models.User).
    hj1_start: Optional[str] = None
    hj2_start: Optional[str] = None
    jahr_ende: Optional[str] = None

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
        # Die Oberflaeche blendet daran den Verwaltungsbereich ein — Konto 1
        # oder ernannt (app/rollen.py).
        "is_admin": ist_admin(user),
        "display_name": display or user.email, "grade_scale": user.grade_scale, "grade_tendency": user.grade_tendency,
        # Vorauswahl in der Anwesenheit ("da" | "fehlt") — siehe models.User.
        "anwesenheit_default": getattr(user, "anwesenheit_default", "da") or "da",
        # Gesehene Touren: am Konto, damit sie nicht auf jedem Geraet neu laufen.
        "tours_done": list(getattr(user, "tours_done", None) or []),
        # Ansichts-Einstellungen (Startseite, Kalender) — siehe models.User.
        "ansichten": dict(getattr(user, "ansichten", None) or {}),
        "marketplace_name": getattr(user, "marketplace_name", "") or "",
        "pending_email": getattr(user, "pending_email", None),
        # Schuljahr — die Shell braucht es fuer alles, was „dieses Halbjahr" sagt.
        "hj1_start": user.hj1_start.isoformat() if getattr(user, "hj1_start", None) else "",
        "hj2_start": user.hj2_start.isoformat() if getattr(user, "hj2_start", None) else "",
        "jahr_ende": user.jahr_ende.isoformat() if getattr(user, "jahr_ende", None) else "",
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
    email = body.email.lower().strip()
    # Zweite Bremse, und zwar je KONTO: das Limit je Adresse allein hilft nicht
    # gegen verteiltes Ausprobieren — wer ueber viele Adressen kommt, hat gegen
    # ein bekanntes Konto beliebig viele Versuche. Gezaehlt werden nur
    # FEHLversuche (siehe fehlversuche_pruefen), und von einer Adresse, die
    # dieses Konto schon erfolgreich benutzt hat, gilt sie nicht.
    if not _adresse_bekannt(email, ip):
        fehlversuche_pruefen("login_konto", email, 20, 300,
                             "Zu viele Anmeldeversuche für dieses Konto. Bitte kurz warten.")
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if not user:
        # Blindpruefung, damit eine unbekannte Adresse genauso lange braucht
        # wie eine bekannte (siehe _DUMMY_PW_HASH).
        _verify_pw(body.password, _DUMMY_PW_HASH)
        fehlversuch_merken("login_konto", email)
        raise HTTPException(401, "E-Mail oder Passwort falsch")
    if not _verify_pw(body.password, user.password_hash):
        fehlversuch_merken("login_konto", email)
        raise HTTPException(401, "E-Mail oder Passwort falsch")
    _adresse_merken(email, ip)
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
    vorhanden = result.scalar_one_or_none()
    if vorhanden:
        # KEINE Auskunft darueber, ob es dieses Konto gibt. Vorher stand hier
        # „E-Mail bereits registriert" — eine Adresse je Anfrage, und damit ein
        # sauberer Weg, Konten aufzuzaehlen. „Passwort vergessen" nebenan haelt
        # sich seit jeher heraus; hier hob es dieselbe Zurueckhaltung wieder auf.
        #
        # Wer WIRKLICH dieses Konto besitzt, erfaehrt es trotzdem — per Mail an
        # die Adresse, die es schon gibt. Ein Konto wird dabei nicht angelegt
        # und kein Passwort geaendert.
        if vorhanden.email_verified:
            await _send_schon_vergeben_mail(vorhanden)
        else:
            # Noch unbestaetigt: die NEUE Anmeldung gilt. Sonst bestaetigte die
            # echte Besitzerin mit ihrem Klick das Konto, das ein Fremder mit
            # seinem Passwort unter ihrer Adresse angelegt hat. Frueher
            # ausgestellte Links verfallen damit (sie haengen am Passwort).
            vorhanden.password_hash = _hash_pw(body.password)
            vorhanden.name = body.name
            vorhanden.salutation = body.salutation
            vorhanden.token_version = (vorhanden.token_version or 0) + 1
            await db.commit()
            await _send_verify_mail(vorhanden)
        return {"ok": True}
    # changelog_seen von Anfang an auf die laufende Fassung: ein neues Konto
    # soll beim ersten Anmelden nicht die Aenderungsliste der letzten zwanzig
    # Fassungen sehen — fuer diese Person ist daran nichts neu.
    from ..admin import APP_VERSION as _fassung
    user = User(email=email, password_hash=_hash_pw(body.password), name=body.name,
                salutation=body.salutation, email_verified=False, changelog_seen=_fassung)
    db.add(user)
    await db.commit()
    await db.refresh(user)

    # Beispielinhalt anlegen: ein leeres Konto zeigt nicht, was das Werkzeug
    # kann. Best-effort — scheitert das, ist das Konto trotzdem gueltig; eine
    # Registrierung darf nicht an einer Demo haengen.
    try:
        await seed_new_account(db, user.id)
    except Exception as e:
        logger.warning("Beispielinhalt für %s konnte nicht angelegt werden: %s", user.id, e)
        await db.rollback()

    # Bestätigungs-Mail (best-effort). Login erst nach Bestätigung möglich.
    await _send_verify_mail(user)
    return {"ok": True}


async def _zugaenge_widerrufen(db: AsyncSession, user: User):
    """Alles, was NEBEN dem Passwort ohne Anmeldung Zugang gibt, zuruecknehmen.

    Ein Passwortwechsel ist fast immer die Antwort auf „jemand anderes koennte
    es kennen". Wer es kannte, konnte sich aber auch ein CalDAV-Geraete-
    Passwort anlegen oder die Kalender-Abo-Adresse abschreiben — beides galt
    nach dem Wechsel unveraendert weiter, und beides liefert Kurs- und
    Klassennamen. Die Geraete-Passwoerter werden geloescht (jedes Geraet
    bekommt ein neues), die Abo-Adresse wird neu gewuerfelt, wenn es eine gibt
    (ohne Abo bleibt es ohne).
    """
    await db.execute(delete(CaldavToken).where(CaldavToken.owner_id == user.id))
    if user.calendar_token:
        user.calendar_token = secrets.token_urlsafe(24)


@router.post("/change-password")
async def change_password(body: ChangePasswordBody, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if not _verify_pw(body.old_password, user.password_hash):
        raise HTTPException(400, "Altes Passwort falsch")
    user.password_hash = _hash_pw(body.new_password)
    # Alle anderen Sitzungen fliegen raus; die eigene bekommt in der Antwort
    # einen frischen Token (die Oberflaeche uebernimmt ihn).
    user.token_version = (user.token_version or 0) + 1
    await _zugaenge_widerrufen(db, user)
    await db.commit()
    return {"ok": True, "token": _make_token(user.id, user.token_version)}


@router.post("/logout")
async def logout(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Serverseitig abmelden: `token_version` steigt, jeder ausgestellte Token
    dieses Kontos ist danach wertlos.

    Die Tokens sind zustandslos — einen EINZELNEN zurueckzunehmen hiesse, eine
    Sperrliste zu fuehren. Deshalb gilt das Abmelden fuer alle Geraete dieses
    Kontos. Vorher raeumte der Knopf nur den Browser; ein abgegriffener Token
    galt danach unveraendert bis zu seiner Frist weiter.
    """
    user.token_version = (user.token_version or 0) + 1
    await db.commit()
    return {"ok": True}


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
        return _check_pw_length(v)


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
    await _zugaenge_widerrufen(db, user)
    await db.commit()
    return {"ok": True}


class VerifyEmailBody(BaseModel):
    token: str


@router.get("/basis")
async def oeffentliche_adresse():
    """Die oeffentliche Adresse dieser Installation ("" = nicht konfiguriert).

    Die Oberflaeche baut daraus Links, die AUS DEM HAUS gehen (Beitrittslink
    fuers Kind, QR-Zettel). `location.origin` taugt dafuer nicht: wer im
    Schulnetz ueber die LAN-Adresse arbeitet, verteilt sonst Links, die
    ausserhalb tot sind. Ohne Anmeldung, weil hier nichts steht, was nicht in
    jeder Bestaetigungsmail schon stuende.
    """
    return {"url": SITE_URL}


@router.post("/verify-email")
async def verify_email(body: VerifyEmailBody, request: Request, db: AsyncSession = Depends(get_db)):
    rate_limit("verify", client_ip(request), 20, 600)
    dec = _decode_reset_token(body.token)   # gleiche Form: id:ts:sig
    if not dec:
        raise HTTPException(400, "Ungültiger Bestätigungslink")
    user_id, ts, sig = dec
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(400, "Ungültiger Link")
    expected = hmac.new(SECRET.encode(), _verify_msg(f"{user.id}:{ts}", user),
                        "sha256").hexdigest()[:32]
    if not hmac.compare_digest(sig, expected):
        raise HTTPException(400, "Ungültiger Bestätigungslink")
    if int(time.time()) - ts > VERIFY_TTL:
        raise HTTPException(400, "Der Bestätigungslink ist abgelaufen. Fordere unter „E-Mail erneut senden\" einen neuen an.")
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
    # Form „id:ts:sig" wie beim Zuruecksetzen. Die alte Form ohne Zeitstempel
    # zerlegt das gar nicht erst — sie hatte keine Frist und wird neu angefordert.
    dec = _decode_reset_token(body.token)
    if not dec:
        raise HTTPException(400, "Ungültiger Bestätigungslink")
    user_id, ts, sig = dec
    user = await db.get(User, user_id)
    if not user or not user.pending_email:
        raise HTTPException(400, "Kein offener Änderungswunsch gefunden")
    if not hmac.compare_digest(sig, _email_change_sig(user.id, ts, user.pending_email)):
        raise HTTPException(400, "Ungültiger Bestätigungslink")
    if int(time.time()) - ts > EMAIL_CHANGE_TTL:
        raise HTTPException(400, "Der Bestätigungslink ist abgelaufen. Bitte die Änderung erneut anfordern.")
    # Zieladresse koennte inzwischen von jemand anderem belegt worden sein
    result = await db.execute(select(User).where(User.email == user.pending_email, User.id != user.id))
    if result.scalar_one_or_none():
        raise HTTPException(400, "Diese E-Mail-Adresse wird inzwischen bereits verwendet")
    user.email = user.pending_email
    user.pending_email = None
    user.token_version = (user.token_version or 0) + 1  # meldet bestehende Sitzungen ab
    await db.commit()
    return {"ok": True}


class TourBody(BaseModel):
    tour: str


@router.post("/tour-done")
async def tour_done(body: TourBody, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Eine gefuehrte Tour als gesehen merken — am Konto, nicht am Geraet.

    Vorher stand das nur im localStorage: wer zwei Geraete benutzt, sah die
    Tour auf jedem einmal, und auf dem Handy immer wieder, weil Safari den
    Speicher einer Seite nach ein paar Tagen ohne Besuch loescht.
    """
    key = (body.tour or "").strip()[:40]
    if not key:
        raise HTTPException(400, "Keine Tour angegeben")
    done = list(getattr(user, "tours_done", None) or [])
    if key not in done:
        # Neue Liste statt anhaengen: die ORM erkennt eine Aenderung an einer
        # JSON-Spalte sonst nicht (kein Mutable-Tracking) und schriebe nichts.
        user.tours_done = [*done, key][:100]
        await db.commit()
    return {"ok": True, "tours_done": list(user.tours_done or [])}


class AnsichtenBody(BaseModel):
    """Ein Bereich mit seinen Einstellungen: {"bereich": "dash", "wert": {...}}."""
    bereich: str
    wert: dict


@router.put("/ansichten")
async def set_ansichten(body: AnsichtenBody, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Eine Ansichts-Einstellung am KONTO ablegen (Startseite, Kalender).

    Frueher lag beides im localStorage — „es ist eine Ansicht, kein Inhalt".
    Im Gebrauch war das falsch: wer die Startseite am Rechner einrichtet und
    abends am Tablet weiterarbeitet, fand dort die alte Anordnung vor und hielt
    sie fuer nicht gespeichert.

    Je Bereich EIN Schluessel; andere Bereiche bleiben unberuehrt. Groesse
    begrenzt, damit hier keine Inhalte landen: das ist eine Einstellung, kein
    Ablageplatz.
    """
    bereich = (body.bereich or "").strip()[:40]
    if not bereich or not bereich.isidentifier():
        raise HTTPException(400, "Unbekannter Bereich")
    import json as _json
    if len(_json.dumps(body.wert)) > 8000:
        raise HTTPException(413, "Einstellung zu groß")
    alle = dict(getattr(user, "ansichten", None) or {})
    alle[bereich] = body.wert
    # Neues dict statt Mutieren: eine JSON-Spalte merkt sich eine Aenderung am
    # Objekt sonst nicht (kein Mutable-Tracking) und schriebe nichts.
    user.ansichten = alle
    await db.commit()
    return {"ok": True, "ansichten": alle}


@router.put("/profile")
async def update_profile(body: UpdateProfileBody, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    user.name = body.name.strip()
    user.salutation = body.salutation
    if body.grade_scale is not None:
        user.grade_scale = body.grade_scale
    if body.grade_tendency is not None:
        user.grade_tendency = bool(body.grade_tendency)
    if body.anwesenheit_default in ("da", "fehlt"):
        user.anwesenheit_default = body.anwesenheit_default
    if body.marketplace_name is not None:
        user.marketplace_name = body.marketplace_name.strip()[:100]
    # Datumsfelder: leerer Text loescht. Unlesbares wird ignoriert statt mit
    # einem Fehler quittiert — sonst kaeme man beim Speichern des Namens nicht
    # mehr durch, nur weil in einem Datumsfeld Unsinn steht.
    from datetime import date as _date
    for feld in ("hj1_start", "hj2_start", "jahr_ende"):
        wert = getattr(body, feld)
        if wert is None:
            continue
        wert = (wert or "").strip()
        if not wert:
            setattr(user, feld, None)
            continue
        try:
            setattr(user, feld, _date.fromisoformat(wert[:10]))
        except ValueError:
            # Unlesbares Datum still uebergehen (siehe oben): sonst kaeme man
            # wegen eines Tippfehlers im Schuljahr nicht mehr an den Namen.
            continue
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
    if not ist_admin(user):
        raise HTTPException(403, "Nur Admin")
    result = await db.execute(select(User).order_by(User.id))
    # Kein `name`: der ist ein freies Anzeigefeld der Lehrkraft und stuetzt
    # keine Verwaltungsentscheidung — in der Liste las er sich wie eine Rolle
    # ("Admin"), war aber nur ein Selbstgewaehlter Text. Was niemand braucht,
    # wird nicht herausgegeben.
    # Die Rolle haengt allein an der ID: Konto 1 ist die Administration
    # (siehe _require_admin in main.py) — hier einmal ausgerechnet, damit die
    # Oberflaeche die Regel nicht nachbaut.
    return [{"id": u.id, "email": u.email, "admin": ist_admin(u),
             # Konto 1 laesst sich nicht herabstufen — die Oberflaeche zeigt
             # dort deshalb keinen Schalter statt einen, der immer scheitert.
             "fest": u.id == 1,
             "email_verified": u.email_verified} for u in result.scalars().all()]


class AdminRolleIn(BaseModel):
    admin: bool
    # Das EIGENE Passwort der Administration (wie beim Loeschen eines Kontos).
    password: str = ""


@router.put("/admin/users/{user_id}/admin")
async def admin_set_role(user_id: int, body: AdminRolleIn, user: User = Depends(get_current_user),
                         db: AsyncSession = Depends(get_db)):
    """Eine Lehrkraft zur Administration ernennen — oder wieder zurueck.

    Konto 1 bleibt aussen vor: IDs werden nicht wiederverwendet, und ohne
    dieses Konto koennte sich eine Installation vollstaendig aussperren.

    Dieselben Riegel wie `admin_delete_user`: das eigene Passwort und eine
    Bremse. Eine Ernennung gibt einem fremden Konto die Kontenverwaltung samt
    Loeschen — mit einer uebernommenen Sitzung allein darf das nicht gehen.
    """
    if not ist_admin(user):
        raise HTTPException(403, "Nur Admin")
    rate_limit("admin_set_role", f"u{user.id}", 10, 600,
               "Zu viele Rollenänderungen in kurzer Zeit. Bitte kurz warten.")
    if user_id == 1:
        raise HTTPException(400, "Das erste Konto bleibt die Administration")
    if not _verify_pw(body.password, user.password_hash):
        raise HTTPException(400, "Passwort falsch")
    ziel = await db.get(User, user_id)
    if not ziel:
        raise HTTPException(404)
    ziel.is_admin = bool(body.admin)
    await db.commit()
    return {"ok": True, "admin": ziel.is_admin}


class AdminDeleteUserBody(BaseModel):
    """Das EIGENE Passwort der Administration — nicht das des Kontos."""
    password: str = ""


@router.post("/admin/users/{user_id}/delete")
async def admin_delete_user(user_id: int, body: AdminDeleteUserBody,
                            user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Ein fremdes Konto tilgen — mit denselben Riegeln wie die Selbstloeschung.

    Das ist der Loeschweg mit dem groessten Wirkradius, den eine angemeldete
    Person hat: Konto, alle Klassen, Noten, Karten, Sitzungen und die Dateien
    auf der Platte, unwiederbringlich und ohne Papierkorb. Trotzdem stand er
    lange als blosses `DELETE` ohne Passwort und ohne Bremse da, waehrend die
    SELBSTloeschung daneben das Passwort verlangt — die schwaechere Huerde lag
    also auf der schwereren Tat.

    Drei Riegel, alle drei aus dem Haus:

    * **Das eigene Passwort.** Eine uebernommene Sitzung (gestohlener Token,
      offener Rechner im Lehrerzimmer) reicht damit nicht mehr aus. Geprueft
      wird das der ADMINISTRATION, nicht das des Ziels — sie bestaetigt sich,
      nicht das Opfer.
    * **Eine Bremse** (3 in 10 Minuten): wer eine Installation leerraeumen
      will, kommt nicht in einem Rutsch durch, und im Protokoll steht es.
    * **POST statt DELETE**, weil ein Rumpf dazugehoert — und nebenbei faellt
      damit jeder alte Client auf 405 statt still weiterzuloeschen.
    """
    if not ist_admin(user):
        raise HTTPException(403, "Nur Admin")
    rate_limit("admin_del_user", f"u{user.id}", 3, 600,
               "Zu viele Kontoloeschungen in kurzer Zeit. Bitte kurz warten.")
    if user_id == 1:
        raise HTTPException(400, "Admin-Konto kann nicht gelöscht werden")
    if user_id == user.id:
        # „Konto loeschen" im eigenen Profil ist der richtige Weg dafuer —
        # dort steht auch, was dabei verloren geht.
        raise HTTPException(400, "Das eigene Konto wird im Profil gelöscht")
    if not _verify_pw(body.password, user.password_hash):
        raise HTTPException(400, "Passwort falsch")
    target = await db.get(User, user_id)
    if not target:
        raise HTTPException(404)
    await _purge_user_content(db, target.id)
    await db.delete(target)
    await db.commit()
    return {"ok": True}
