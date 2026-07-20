"""Modul Kalender — Unterrichtsplanung.

Eigenstaendig (Regel 3): eigene Eintraege, aber Klassen und Themen kommen aus
dem Kern. Ein Eintrag kann optional an eine Klasse und ein Thema haengen; das
Thema ist ON DELETE SET NULL, damit das Loeschen eines Themas keinen Eintrag
mitreisst.
"""
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import CalendarBreak, CalendarEntry, CardDeck, SchoolClass, TimetableSlot, Topic, User, Session as TestSession
from .auth import get_current_user, rate_limit
from .modules import is_active

router = APIRouter(prefix="/api/kalender", tags=["kalender"])
MODULE_KEY = "kalender"


async def require_module(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> User:
    if not await is_active(db, user.id, MODULE_KEY):
        raise HTTPException(403, "Modul Kalender ist nicht aktiviert")
    return user


async def _check_class(db: AsyncSession, user: User, class_id: Optional[int]) -> None:
    if class_id is None:
        return
    r = await db.execute(select(SchoolClass.id).where(SchoolClass.id == class_id, SchoolClass.owner_id == user.id))
    if not r.scalar_one_or_none():
        raise HTTPException(404, "Klasse nicht gefunden")


async def _check_topic(db: AsyncSession, user: User, topic_id: Optional[int]) -> None:
    if topic_id is None:
        return
    r = await db.execute(select(Topic.id).where(Topic.id == topic_id, Topic.owner_id == user.id))
    if not r.scalar_one_or_none():
        raise HTTPException(404, "Thema nicht gefunden")


class EntryIn(BaseModel):
    date: datetime
    title: str = ""
    notes: str = ""
    class_id: Optional[int] = None
    topic_id: Optional[int] = None
    method_id: Optional[int] = None
    period: Optional[int] = None
    cardvote_set_id: Optional[int] = None
    karten_deck_id: Optional[int] = None
    lernpfad_ladder_id: Optional[int] = None
    codedetektiv_puzzle: Optional[str] = None


class EntryOut(EntryIn):
    id: int
    model_config = {"from_attributes": True}


@router.get("/entries", response_model=List[EntryOut])
async def list_entries(frm: Optional[datetime] = None, to: Optional[datetime] = None,
                       user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Eintraege, optional auf einen Zeitraum (frm..to) eingegrenzt."""
    q = select(CalendarEntry).where(CalendarEntry.owner_id == user.id)
    if frm is not None:
        q = q.where(CalendarEntry.date >= frm)
    if to is not None:
        q = q.where(CalendarEntry.date <= to)
    rows = (await db.execute(q.order_by(CalendarEntry.date))).scalars().all()
    return rows


@router.post("/entries", response_model=EntryOut, status_code=201)
async def create_entry(body: EntryIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    rate_limit("kalender_entry", f"u{user.id}", 300, 60, "Zu viele Eintraege. Bitte kurz warten.")
    await _check_class(db, user, body.class_id)
    await _check_topic(db, user, body.topic_id)
    e = CalendarEntry(owner_id=user.id, **body.model_dump())
    db.add(e)
    await db.commit()
    await db.refresh(e)
    await _release_matching_decks(db, user, e)
    return e


@router.put("/entries/{entry_id}", response_model=EntryOut)
async def update_entry(entry_id: int, body: EntryIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    e = await db.get(CalendarEntry, entry_id)
    if not e or e.owner_id != user.id:
        raise HTTPException(404, "Eintrag nicht gefunden")
    await _check_class(db, user, body.class_id)
    await _check_topic(db, user, body.topic_id)
    for k, v in body.model_dump().items():
        setattr(e, k, v)
    await db.commit()
    await db.refresh(e)
    await _release_matching_decks(db, user, e)
    return e


async def _release_matching_decks(db: AsyncSession, user: User, e: CalendarEntry) -> None:
    """Zusatz (Regel 3): plant der Kalender ein Thema, wird ein passender, noch
    nicht ausgerollter Karten-Stapel automatisch zum Termin freigeschaltet.
    Nur Entwuerfe (released_at NULL) — eine manuelle Freigabe bleibt unberuehrt.
    """
    # Explizit verknuepftes Deck: am Kalendertag freischalten, falls noch Entwurf.
    if e.karten_deck_id:
        deck = await db.get(CardDeck, e.karten_deck_id)
        if deck and deck.owner_id == user.id and deck.released_at is None:
            deck.released_at = e.date
            await db.commit()
    if not e.topic_id:
        return
    q = select(CardDeck).where(
        CardDeck.owner_id == user.id,
        CardDeck.topic_id == e.topic_id,
        CardDeck.released_at.is_(None),
        CardDeck.deleted_at.is_(None),
    )
    if e.class_id:
        q = q.where(CardDeck.class_id == e.class_id)
    for deck in (await db.execute(q)).scalars().all():
        deck.released_at = e.date
    await db.commit()


async def _class_maps(db, user):
    rows = (await db.execute(select(SchoolClass).where((SchoolClass.owner_id == user.id) | (SchoolClass.owner_id.is_(None))))).scalars().all()
    id2name = {c.id: c.name for c in rows}
    name2id = {c.name: c.id for c in rows}
    return id2name, name2id


async def _topic_maps(db, user):
    rows = (await db.execute(select(Topic).where(Topic.owner_id == user.id))).scalars().all()
    by_id = {t.id: t for t in rows}
    def path(tid):
        t = by_id.get(tid)
        if not t:
            return ""
        p = by_id.get(t.parent_id) if t.parent_id else None
        return f"{p.name} / {t.name}" if p else t.name
    path2id = {path(t.id): t.id for t in rows}
    return path, path2id


@router.get("/export")
async def export_kalender(user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    id2name, _ = await _class_maps(db, user)
    tpath, _ = await _topic_maps(db, user)
    slots = (await db.execute(select(TimetableSlot).where(TimetableSlot.owner_id == user.id))).scalars().all()
    entries = (await db.execute(select(CalendarEntry).where(CalendarEntry.owner_id == user.id).order_by(CalendarEntry.date))).scalars().all()
    breaks = (await db.execute(select(CalendarBreak).where(CalendarBreak.owner_id == user.id).order_by(CalendarBreak.start_date))).scalars().all()
    return {
        "type": "nuvora_kalender", "version": 1,
        "timetable": {
            "periods": user.timetable_periods or 6,
            "times": user.timetable_times or [],
            "slots": [{"weekday": s.weekday, "period": s.period, "class": id2name.get(s.class_id), "title": s.title} for s in slots],
        },
        "breaks": [{"start_date": b.start_date.isoformat(), "end_date": b.end_date.isoformat(), "label": b.label} for b in breaks],
        "entries": [{"date": e.date.isoformat(), "period": e.period, "title": e.title, "notes": e.notes,
                     "class": id2name.get(e.class_id), "topic": tpath(e.topic_id) if e.topic_id else ""} for e in entries],
    }


@router.post("/import")
async def import_kalender(body: dict, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    if body.get("type") != "nuvora_kalender":
        raise HTTPException(400, "Falsches Dateiformat")
    _, name2id = await _class_maps(db, user)
    _, path2id = await _topic_maps(db, user)
    tt = body.get("timetable") or {}
    if tt.get("periods"):
        user.timetable_periods = int(tt["periods"])
    if isinstance(tt.get("times"), list):
        user.timetable_times = tt["times"]
    # Stundenplan-Slots ersetzen (Wochentag+Stunde eindeutig).
    if isinstance(tt.get("slots"), list):
        for s in (await db.execute(select(TimetableSlot).where(TimetableSlot.owner_id == user.id))).scalars().all():
            await db.delete(s)
        for s in tt["slots"]:
            db.add(TimetableSlot(owner_id=user.id, weekday=int(s.get("weekday", 0)), period=int(s.get("period", 1)),
                                 class_id=name2id.get(s.get("class")), title=s.get("title") or ""))
    for b in (body.get("breaks") or []):
        try:
            db.add(CalendarBreak(owner_id=user.id, start_date=datetime.fromisoformat(b["start_date"]),
                                 end_date=datetime.fromisoformat(b["end_date"]), label=(b.get("label") or "")[:120]))
        except (KeyError, ValueError):
            continue
    n = 0
    for e in (body.get("entries") or []):
        try:
            dt = datetime.fromisoformat(e["date"])
        except (KeyError, ValueError):
            continue
        db.add(CalendarEntry(owner_id=user.id, date=dt, period=e.get("period"), title=(e.get("title") or "")[:200],
                             notes=e.get("notes") or "", class_id=name2id.get(e.get("class")), topic_id=path2id.get(e.get("topic"))))
        n += 1
    await db.commit()
    return {"imported": n}


@router.get("/quiz-session")
async def quiz_session(set_id: int, class_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Neueste CardVote-Session, die dieses Quiz für diese Klasse gelaufen ist —
    für den Sprung „Ergebnis als Note" aus einem Kalender-Eintrag."""
    q = select(TestSession).where(
        TestSession.owner_id == user.id,
        TestSession.question_set_id == set_id,
        TestSession.class_id == class_id,
    ).order_by(TestSession.created_at.desc())
    s = (await db.execute(q)).scalars().first()
    return {"session_id": s.id if s else None}


class BreakIn(BaseModel):
    start_date: datetime
    end_date: datetime
    label: str = ""


class BreakOut(BreakIn):
    id: int
    model_config = {"from_attributes": True}


@router.get("/breaks", response_model=List[BreakOut])
async def list_breaks(user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    q = select(CalendarBreak).where(CalendarBreak.owner_id == user.id).order_by(CalendarBreak.start_date)
    return (await db.execute(q)).scalars().all()


@router.post("/breaks", response_model=BreakOut, status_code=201)
async def create_break(body: BreakIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    rate_limit("kalender_break", f"u{user.id}", 100, 60, "Zu viele Eintraege. Bitte kurz warten.")
    if body.end_date < body.start_date:
        raise HTTPException(400, "Ende liegt vor dem Anfang")
    b = CalendarBreak(owner_id=user.id, start_date=body.start_date, end_date=body.end_date, label=body.label or "")
    db.add(b)
    await db.commit()
    await db.refresh(b)
    return b


@router.delete("/breaks/{break_id}", status_code=204)
async def delete_break(break_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    b = await db.get(CalendarBreak, break_id)
    if not b or b.owner_id != user.id:
        raise HTTPException(404, "Zeitraum nicht gefunden")
    await db.delete(b)
    await db.commit()


@router.delete("/entries/{entry_id}", status_code=204)
async def delete_entry(entry_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    e = await db.get(CalendarEntry, entry_id)
    if not e or e.owner_id != user.id:
        raise HTTPException(404, "Eintrag nicht gefunden")
    await db.delete(e)
    await db.commit()


# ─── Stundenplan (wiederkehrendes Wochenraster, Vorlage fuer Termine) ───

class SlotIn(BaseModel):
    weekday: int
    period: int
    class_id: Optional[int] = None
    title: str = ""
    topic_id: Optional[int] = None


class SlotOut(SlotIn):
    id: int
    model_config = {"from_attributes": True}


class Timetable(BaseModel):
    periods: int
    slots: List[SlotOut]
    times: list = []


class PeriodsIn(BaseModel):
    periods: int


class TimesIn(BaseModel):
    times: list  # [{start, end}] je Stunde


@router.get("/timetable", response_model=Timetable)
async def get_timetable(user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(TimetableSlot).where(TimetableSlot.owner_id == user.id)
        .order_by(TimetableSlot.weekday, TimetableSlot.period)
    )).scalars().all()
    return {"periods": user.timetable_periods or 6, "slots": rows, "times": user.timetable_times or []}


@router.put("/timetable/times", response_model=Timetable)
async def set_times(body: TimesIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Uhrzeiten je Stunde setzen: Liste [{start,end}]."""
    user.timetable_times = body.times
    await db.commit()
    return await get_timetable(user, db)


@router.put("/timetable/periods", response_model=Timetable)
async def set_periods(body: PeriodsIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    if not 1 <= body.periods <= 16:
        raise HTTPException(400, "Stundenzahl muss zwischen 1 und 16 liegen")
    user.timetable_periods = body.periods
    await db.commit()
    return await get_timetable(user, db)


@router.put("/timetable/slot", response_model=SlotOut)
async def upsert_slot(body: SlotIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Setzt die Stunde an (weekday, period) — legt an oder aktualisiert."""
    if not 0 <= body.weekday <= 6 or body.period < 1:
        raise HTTPException(400, "Ungueltige Stunde")
    await _check_class(db, user, body.class_id)
    await _check_topic(db, user, body.topic_id)
    s = (await db.execute(select(TimetableSlot).where(
        TimetableSlot.owner_id == user.id,
        TimetableSlot.weekday == body.weekday,
        TimetableSlot.period == body.period,
    ))).scalar_one_or_none()
    if s is None:
        s = TimetableSlot(owner_id=user.id, **body.model_dump())
        db.add(s)
    else:
        for k, v in body.model_dump().items():
            setattr(s, k, v)
    await db.commit()
    await db.refresh(s)
    return s


@router.delete("/timetable/slot/{slot_id}", status_code=204)
async def delete_slot(slot_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    s = await db.get(TimetableSlot, slot_id)
    if not s or s.owner_id != user.id:
        raise HTTPException(404, "Stunde nicht gefunden")
    await db.delete(s)
    await db.commit()


# ─── Kalender abonnieren (ICS-Feed fuer Apple/Google, dauerhaft) ───
import secrets as _secrets
from fastapi import Request as _Request
from fastapi.responses import PlainTextResponse as _Plain


@router.get("/subscribe")
async def subscribe_url(request: _Request, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Gibt die Abo-URL zurueck (erzeugt bei Bedarf ein Token). Der Kalender
    wird per URL abonniert — kein Login, kein Einzel-Download."""
    if not user.calendar_token:
        user.calendar_token = _secrets.token_urlsafe(24)
        await db.commit()
    base = str(request.base_url).rstrip("/")  # z.B. https://host
    path = f"/api/kalender/feed/{user.calendar_token}.ics"
    return {"url": base + path, "webcal": ("webcal://" + base.split("://", 1)[-1] + path) if "://" in base else base + path}


@router.delete("/subscribe", status_code=204)
async def revoke_subscribe(user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Abo-Token zuruecksetzen — alte Abo-URLs werden ungueltig."""
    user.calendar_token = None
    await db.commit()


def _ics_escape(s: str) -> str:
    return (s or "").replace("\\", "\\\\").replace(";", r"\;").replace(",", r"\,").replace("\n", r"\n")


@router.get("/feed/{token}.ics")
async def ics_feed(token: str, db: AsyncSession = Depends(get_db)):
    """ICS-Feed eines Kontos (Token statt Login). Kalender-Eintraege als
    Ganztags-Events, freie Zeitraeume (Ferien) als mehrtaegige Events."""
    from datetime import date, timedelta
    u = (await db.execute(select(User).where(User.calendar_token == token))).scalar_one_or_none()
    if not u:
        raise HTTPException(404, "Kalender nicht gefunden")
    entries = (await db.execute(select(CalendarEntry).where(CalendarEntry.owner_id == u.id).order_by(CalendarEntry.date))).scalars().all()
    breaks = (await db.execute(select(CalendarBreak).where(CalendarBreak.owner_id == u.id))).scalars().all()
    classes = {c.id: c.name for c in (await db.execute(select(SchoolClass).where(SchoolClass.owner_id == u.id))).scalars().all()}

    def d8(d):
        return d.strftime("%Y%m%d")
    now = datetime.now().strftime("%Y%m%dT%H%M%SZ")
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Nuvora//Kalender//DE", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:Nuvora"]
    for e in entries:
        day = e.date.date() if hasattr(e.date, "date") else e.date
        title = e.title or (classes.get(e.class_id) or "Termin")
        lines += [
            "BEGIN:VEVENT",
            f"UID:nuvora-entry-{e.id}@nuvora",
            f"DTSTAMP:{now}",
            f"DTSTART;VALUE=DATE:{d8(day)}",
            f"DTEND;VALUE=DATE:{d8(day + timedelta(days=1))}",
            f"SUMMARY:{_ics_escape(title)}",
        ]
        if e.notes:
            lines.append(f"DESCRIPTION:{_ics_escape(e.notes)}")
        lines.append("END:VEVENT")
    for b in breaks:
        s = b.start_date.date() if hasattr(b.start_date, "date") else b.start_date
        en = b.end_date.date() if hasattr(b.end_date, "date") else b.end_date
        lines += [
            "BEGIN:VEVENT",
            f"UID:nuvora-break-{b.id}@nuvora",
            f"DTSTAMP:{now}",
            f"DTSTART;VALUE=DATE:{d8(s)}",
            f"DTEND;VALUE=DATE:{d8(en + timedelta(days=1))}",
            f"SUMMARY:{_ics_escape(b.label or 'Unterrichtsfrei')}",
            "END:VEVENT",
        ]
    lines.append("END:VCALENDAR")
    return _Plain("\r\n".join(lines), media_type="text/calendar; charset=utf-8")


# ─── Externer Kalender (ICS-URL read-only einblenden — „andere Richtung") ───
class ExtIn(BaseModel):
    url: str = ""


@router.get("/external")
async def get_external(user: User = Depends(require_module)):
    return {"url": user.external_ics_url or ""}


@router.put("/external")
async def set_external(body: ExtIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    url = (body.url or "").strip()
    if url and not (url.startswith("http://") or url.startswith("https://") or url.startswith("webcal://")):
        raise HTTPException(400, "URL muss mit http(s):// oder webcal:// beginnen")
    user.external_ics_url = url.replace("webcal://", "https://", 1) if url else None
    await db.commit()
    return {"url": user.external_ics_url or ""}


def _parse_ics(text: str):
    """Sehr einfacher ICS-Parser: VEVENTs mit DTSTART/DTEND/SUMMARY."""
    import re
    # Gefaltete Zeilen (Fortsetzung mit Leerzeichen/Tab) zusammenführen.
    text = re.sub(r"\r?\n[ \t]", "", text)
    events = []
    cur = None
    for line in text.split("\n"):
        line = line.rstrip("\r")
        if line == "BEGIN:VEVENT":
            cur = {}
        elif line == "END:VEVENT":
            if cur and cur.get("start"):
                events.append(cur)
            cur = None
        elif cur is not None and ":" in line:
            key, val = line.split(":", 1)
            k = key.split(";", 1)[0].upper()
            if k == "DTSTART":
                cur["start"] = val.strip()[:8]  # YYYYMMDD (Datum-Teil reicht)
            elif k == "DTEND":
                cur["end"] = val.strip()[:8]
            elif k == "SUMMARY":
                cur["title"] = val.strip().replace("\\,", ",").replace(r"\;", ";").replace("\\n", " ")
    return events


# Kleiner Prozess-Cache für externe Feeds: pro Nutzer ein Eintrag
# (url, verfaellt_ts, ergebnis). Ein fremder Kalender ändert sich selten, jeder
# Seitenaufruf holte ihn bisher neu — bei großen Feeds spürbar. Key enthält die
# URL, damit ein Wechsel den alten Eintrag nicht wiederverwendet.
_EXT_CACHE: dict[int, tuple[str, float, list]] = {}
_EXT_TTL = 600  # 10 Minuten


@router.get("/external-events")
async def external_events(user: User = Depends(require_module)):
    """Holt den externen ICS-Feed (falls gesetzt) und liefert Events als
    {date: YYYY-MM-DD, title}. Read-only, nur zur Anzeige. 10-Min-Cache."""
    if not user.external_ics_url:
        _EXT_CACHE.pop(user.id, None)
        return []
    import time
    hit = _EXT_CACHE.get(user.id)
    if hit and hit[0] == user.external_ics_url and hit[1] > time.time():
        return hit[2]
    import asyncio, urllib.request, urllib.parse, socket, ipaddress
    def _fetch():
        url = user.external_ics_url
        # SSRF-Schutz: Ziel-Host darf nicht auf eine private/lokale IP zeigen
        # (kein Zugriff auf interne Dienste/Metadaten). Nur http(s).
        parsed = urllib.parse.urlparse(url)
        if parsed.scheme not in ("http", "https") or not parsed.hostname:
            return ""
        for res in socket.getaddrinfo(parsed.hostname, parsed.port or (443 if parsed.scheme == "https" else 80)):
            ip = ipaddress.ip_address(res[4][0])
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
                raise ValueError("Ziel-IP nicht erlaubt")
        # Redirects sperren: ein Redirect koennte nach dem IP-Check auf eine
        # private IP umleiten (SSRF). Feeds (Google/iCloud) liefern direkt.
        class _NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *a, **k):
                return None
        opener = urllib.request.build_opener(_NoRedirect)
        req = urllib.request.Request(url, headers={"User-Agent": "Nuvora"})
        with opener.open(req, timeout=6) as r:
            return r.read(2_000_000).decode("utf-8", "replace")  # max 2 MB
    try:
        text = await asyncio.get_event_loop().run_in_executor(None, _fetch)
    except Exception:
        return []
    from datetime import date, timedelta
    def _d(v):
        return date(int(v[0:4]), int(v[4:6]), int(v[6:8])) if v and len(v) >= 8 and v[:8].isdigit() else None
    out = []
    for e in _parse_ics(text):
        d0 = _d(e.get("start"))
        if not d0:
            continue
        title = e.get("title", "")[:200]
        d1 = _d(e.get("end"))
        # Mehrtägige (Ganztags-)Events über alle Tage anzeigen; DTEND ist bei
        # Ganztags exklusiv. Ohne/gleiches Ende: nur der eine Tag. Max 60 Tage.
        if d1 and d1 > d0:
            cur = d0
            n = 0
            while cur < d1 and n < 60:
                out.append({"date": cur.isoformat(), "title": title})
                cur += timedelta(days=1); n += 1
        else:
            out.append({"date": d0.isoformat(), "title": title})
    result = out[:2000]
    _EXT_CACHE[user.id] = (user.external_ics_url, time.time() + _EXT_TTL, result)
    return result
