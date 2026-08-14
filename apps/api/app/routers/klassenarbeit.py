"""Modul „Klassenarbeit auswerten".

Eine Arbeit als Aufgaben-Raster (je Aufgabe ein Thema, je SuS richtig/falsch).
Daraus je SuS ein Fehlerprofil nach Thema → gezielte Wiederholung.

Eigenständig (Regel 3): eigene Tabelle, keine Abhängigkeit. Themen aus dem Kern;
Karten (wieder fällig setzen) sind eine optionale Brücke — ohne das Modul Karten
passiert dort nichts.
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import WorkAnalysis, SchoolClass, Student, Topic, User
from .auth import rate_limit
from .modules import is_active, modul_pflicht

router = APIRouter(prefix="/api/klassenarbeit", tags=["klassenarbeit"])
MODULE_KEY = "auswertung"


require_module = modul_pflicht(MODULE_KEY)


async def _owned_class(db, user, class_id) -> SchoolClass:
    sc = await db.get(SchoolClass, class_id)
    if not sc:
        raise HTTPException(404, "Klasse nicht gefunden")
    if sc.owner_id and sc.owner_id != user.id:
        raise HTTPException(403, "Keine Berechtigung")
    return sc


async def _owned_work(db, user, work_id) -> WorkAnalysis:
    w = await db.get(WorkAnalysis, work_id)
    if not w or w.owner_id != user.id:
        raise HTTPException(404, "Arbeit nicht gefunden")
    return w


async def _roster(db, class_id):
    """Kanonische SuS des Kurses (gleichnamige Fach-Klassen-SuS dedupliziert)."""
    from .kurse import sibling_class_ids
    sib = await sibling_class_ids(db, class_id)
    studs = (await db.execute(select(Student).where(Student.class_id.in_(sib)).order_by(Student.position, Student.card_id, Student.id))).scalars().all()
    canon = {}
    for s in studs:
        canon.setdefault(s.name.strip(), s)
    return sorted(canon.values(), key=lambda s: (s.position or 0, s.card_id, s.id))


class WorkIn(BaseModel):
    class_id: int
    kurs_id: Optional[int] = None
    name: str = ""
    # Tag der Arbeit — nur, um die Abwesenden vorzubelegen (Bruecke zu Orga).
    datum: Optional[str] = None


class WorkPut(BaseModel):
    name: Optional[str] = None
    tasks: Optional[list] = None       # [{id,label,topic_id}]
    results: Optional[dict] = None      # {student_id: [wrong_task_id]}
    scale: Optional[dict] = None        # Notenschlüssel {"1":87,…} oder null = Profil
    absent: Optional[list] = None       # abwesende student_ids (Punkte bleiben)


class WorkOut(BaseModel):
    id: int
    source_id: Optional[int] = None
    class_id: int
    kurs_id: Optional[int] = None
    name: str
    tasks: list = []
    results: dict = {}
    scale: Optional[dict] = None
    absent: list = []
    model_config = {"from_attributes": True}


def _keyw(user, class_id, kurs_id):
    """Liste von WHERE-Bedingungen (unterschiedlich lang) — immer per * entpackt."""
    if kurs_id is not None:
        return [WorkAnalysis.owner_id == user.id, WorkAnalysis.kurs_id == kurs_id]
    return [WorkAnalysis.owner_id == user.id, WorkAnalysis.class_id == class_id, WorkAnalysis.kurs_id.is_(None)]


@router.get("/classes/{class_id}/students")
async def roster(class_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    await _owned_class(db, user, class_id)
    return [{"id": s.id, "name": s.name} for s in await _roster(db, class_id)]


@router.get("/kurse/{kurs_id}/students")
async def roster_kurs(kurs_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """SuS eines Kurses — inkl. der EINZELN hinzugefügten (Kurse aus Teilen von
    Klassen). Deduplikat per Name wie beim Klassen-Roster."""
    from .kurse import _owned_kurs, member_student_ids
    await _owned_kurs(db, user, kurs_id)
    sids = list(await member_student_ids(db, kurs_id))
    if not sids:
        return []
    studs = (await db.execute(select(Student).where(Student.id.in_(sids)).order_by(Student.position, Student.card_id, Student.id))).scalars().all()
    canon = {}
    for s in studs:
        canon.setdefault(s.name.strip(), s)
    return [{"id": s.id, "name": s.name, "class_id": s.class_id} for s in sorted(canon.values(), key=lambda s: (s.position or 0, s.card_id, s.id))]


@router.get("/classes/{class_id}/works", response_model=List[WorkOut])
async def list_works(class_id: int, kurs_id: Optional[int] = None, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    await _owned_class(db, user, class_id)
    rows = (await db.execute(select(WorkAnalysis).where(*_keyw(user, class_id, kurs_id)).order_by(WorkAnalysis.created_at.desc()))).scalars().all()
    return [WorkOut(id=w.id, source_id=w.source_id, class_id=w.class_id, kurs_id=w.kurs_id, name=w.name, tasks=w.tasks or [], results=w.results or {}, scale=w.scale, absent=w.absent or []) for w in rows]


@router.post("/works", response_model=WorkOut, status_code=201)
async def create_work(body: WorkIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    rate_limit("ka_work", f"u{user.id}", 100, 60, "Zu viele Arbeiten. Bitte kurz warten.")
    await _owned_class(db, user, body.class_id)
    w = WorkAnalysis(owner_id=user.id, class_id=body.class_id, kurs_id=body.kurs_id, name=(body.name or "Klassenarbeit").strip()[:200], tasks=[], results={})

    # Wer am Tag der Arbeit gefehlt hat, ist hier gleich als abwesend markiert
    # (Bruecke zu Orga, nur mit aktivem Modul). Vergisst man das, rutschen
    # Nullen in die Wertung und verfaelschen Schnitt, Trennschaerfe und
    # Notenverteilung — genau die Zahlen, wegen derer man die Arbeit auswertet.
    # Es bleibt ein Vorschlag: die Markierung laesst sich je Kind umschalten.
    w.absent = await _abwesende_am_tag(db, user, body.class_id, body.datum) or None

    db.add(w)
    await db.commit()
    await db.refresh(w)
    return WorkOut(id=w.id, source_id=w.source_id, class_id=w.class_id, kurs_id=w.kurs_id,
                   name=w.name, tasks=[], results={}, absent=w.absent or [])


async def _abwesende_am_tag(db, user, class_id: int, datum: Optional[str]) -> list:
    """student_ids, die an diesem Tag als fehlend erfasst sind (leer ohne Orga)."""
    from datetime import datetime as _dt
    from .modules import is_active

    if not datum or not await is_active(db, user.id, "orga"):
        return []
    try:
        tag = _dt.fromisoformat(datum.replace("Z", "+00:00"))
    except ValueError:
        return []
    try:
        from .anwesenheit import get_day as _tag
        stand = await _tag(class_id, date=tag, period=None, user=user, db=db) or {}
    except Exception:
        return []
    # „entsch" (entschuldigt) zaehlt mit: das Kind war nicht da und hat die
    # Arbeit nicht geschrieben. „spaet" nicht — es war da.
    return [sid for sid, eintrag in stand.items()
            if (eintrag or {}).get("status") in ("fehlt", "entsch")]


class WorkCopyIn(BaseModel):
    class_id: int
    kurs_id: Optional[int] = None
    name: Optional[str] = None


@router.post("/works/{work_id}/copy", response_model=WorkOut, status_code=201)
async def copy_work(work_id: int, body: WorkCopyIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Dieselbe Arbeit in einer anderen Klasse — als Vorlage, ohne Punkte.

    Parallelklassen schreiben dieselbe Arbeit; sie zweimal einzutippen ist
    dieselbe Arbeit zweimal. Kopiert wird alles, was die Arbeit AUSMACHT:
    Aufgaben samt Teilaufgaben, Themen, Maximalpunkte, der Notenschluessel und
    die Anhaenge (Arbeit + Erwartungshorizont).

    NICHT kopiert werden Punkte und Abwesende — die gehoeren zu Kindern, die es
    in der anderen Klasse nicht gibt. Eine Kopie mit fremden Punkten waere im
    besten Fall Muell und im schlimmsten eine Note am falschen Kind.

    Nach dem Kopieren sind es zwei unabhaengige Arbeiten: eine Korrektur an den
    Aufgaben gilt nur dort, wo sie gemacht wird.
    """
    rate_limit("ka_copy", f"u{user.id}", 60, 60, "Zu viele Kopien. Bitte kurz warten.")
    from ..models import Material

    quelle = await _owned_work(db, user, work_id)
    await _owned_class(db, user, body.class_id)
    if body.kurs_id is not None:
        from .kurse import _owned_kurs
        await _owned_kurs(db, user, body.kurs_id)

    import copy as _copy
    ziel = WorkAnalysis(
        owner_id=user.id, class_id=body.class_id, kurs_id=body.kurs_id,
        # Kette flach halten: die Kopie einer Kopie zeigt auf denselben Ursprung.
        # So ist die Gruppe „dieselbe Arbeit" eine ID-Abfrage und keine Suche.
        source_id=quelle.source_id or quelle.id,
        name=((body.name or quelle.name or "Klassenarbeit").strip()[:200]),
        # Tief kopieren: sonst zeigen beide Arbeiten auf dieselben Listen, und
        # eine geaenderte Aufgabe waere still in beiden geaendert.
        tasks=_copy.deepcopy(quelle.tasks or []),
        results={}, absent=None,
        scale=_copy.deepcopy(quelle.scale) if quelle.scale else None,
    )
    db.add(ziel)
    await db.flush()

    # Anhaenge mitnehmen: der Erwartungshorizont gilt fuer beide Klassen, und
    # ihn zweimal hochzuladen waere derselbe Handgriff zweimal.
    anhaenge = (await db.execute(select(Material).where(
        Material.owner_id == user.id, Material.work_id == quelle.id))).scalars().all()
    for a in anhaenge:
        db.add(Material(owner_id=user.id, work_id=ziel.id, rolle=a.rolle,
                        filename=a.filename, mime=a.mime, size=a.size, data=a.data))

    await db.commit()
    await db.refresh(ziel)
    return WorkOut(id=ziel.id, source_id=ziel.source_id, class_id=ziel.class_id, kurs_id=ziel.kurs_id, name=ziel.name,
                   tasks=ziel.tasks or [], results={}, scale=ziel.scale, absent=[])


@router.put("/works/{work_id}", response_model=WorkOut)
async def update_work(work_id: int, body: WorkPut, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    w = await _owned_work(db, user, work_id)
    if body.name is not None:
        w.name = body.name.strip()[:200]
    if body.tasks is not None:
        # Themenbindung nur aufs eigene Thema; fremdes/unbekanntes → None.
        own = {t for (t,) in (await db.execute(select(Topic.id).where(Topic.owner_id == user.id))).all()}
        def _num(x, default):
            return float(x) if isinstance(x, (int, float)) and 0 < x <= 1000 else default
        clean = []
        for t in body.tasks[:100]:
            if not isinstance(t, dict) or not t.get("id"):
                continue
            tid = t.get("topic_id")
            ct = {"id": str(t["id"])[:40], "label": str(t.get("label") or "")[:200],
                  "topic_id": tid if (isinstance(tid, int) and tid in own) else None,
                  "max": _num(t.get("max"), 1),   # Maximalpunkte (Halbpunkte erlaubt)
                  # „Darstellung" (Form, Sauberkeit, saubere Rechenwege): zaehlt
                  # zur NOTE, aber nicht zur inhaltlichen Auswertung. Sie misst
                  # keine Kompetenz in einem Thema — im Aufgabenvergleich stuende
                  # sie neben Sachaufgaben und wuerde mit ihnen verglichen,
                  # obwohl beide nichts miteinander zu tun haben.
                  "form": bool(t.get("form"))}
            # Teilaufgaben (a, b, c …) mit eigenem Maximum — optional.
            parts = t.get("parts")
            if isinstance(parts, list) and parts:
                # Thema JE TEILAUFGABE: eine „Aufgabe 1: Wiederholung" enthaelt
                # in a) Kopfrechnen, in b) Bruch/Dezimal/Prozent, in c) Runden.
                # Haengt das Thema nur an der Aufgabe, wird all das zu einem
                # Topf, und die Auswertung sagt „Wiederholung schwach" statt
                # „Runden schwach". Ohne eigenes Thema erbt die Teilaufgabe das
                # der Aufgabe (der haeufige Fall bleibt einfach).
                cp = [{"id": str(p["id"])[:40], "label": str(p.get("label") or "")[:40], "max": _num(p.get("max"), 1),
                       "topic_id": p.get("topic_id") if (isinstance(p.get("topic_id"), int) and p.get("topic_id") in own) else None}
                      for p in parts[:50] if isinstance(p, dict) and p.get("id")]
                if cp:
                    ct["parts"] = cp
            clean.append(ct)
        w.tasks = clean
    if body.results is not None:
        # {student_id: {task_id: erreichte Punkte}}. Altformat (Liste falscher
        # Aufgaben) wird beim Lesen (_profile) mitübersetzt, hier nur Punkte-Maps.
        # Punkte bleiben in 0..Maximum der Wertungseinheit: ein Vertipper (77
        # statt 7) ergäbe sonst über 100 % und damit einen Notenwert unter 1,0 —
        # den die Übernahme ins Notenbuch stillschweigend wegwirft.
        umax = {uid: mx for t in (w.tasks or []) for uid, mx in _units(t)}
        def _punkte(uid, p):
            if isinstance(p, bool) or not isinstance(p, (int, float)):
                return 0
            return max(0.0, min(float(p), umax[uid])) if uid in umax else max(0.0, float(p))
        out = {}
        for k, v in list(body.results.items())[:400]:
            if v == "abwesend":
                out[str(k)] = "abwesend"                 # abwesend: zählt nicht in die Auswertung
            elif isinstance(v, dict):
                out[str(k)] = {str(tid)[:40]: _punkte(str(tid)[:40], p) for tid, p in list(v.items())[:200]}
            elif isinstance(v, list):
                out[str(k)] = [str(x)[:40] for x in v]  # Altformat unverändert durchreichen
        w.results = out
    if body.scale is not None:
        # Notenschlüssel {grade: min-prozent}. Leeres/ungueltiges dict -> null
        # (zurueck zur Profil-Voreinstellung). Werte auf 0..100 begrenzen.
        clean = {}
        for g in ("1", "2", "3", "4", "5", "6"):
            v = body.scale.get(g, body.scale.get(int(g))) if isinstance(body.scale, dict) else None
            if isinstance(v, (int, float)):
                clean[g] = max(0, min(100, float(v)))
        w.scale = clean or None
    if body.absent is not None:
        # Abwesende als eindeutige String-IDs; Punkte in results bleiben unberuehrt.
        w.absent = list({str(x)[:40] for x in body.absent[:400]}) or None
    await db.commit()
    await db.refresh(w)
    return WorkOut(id=w.id, source_id=w.source_id, class_id=w.class_id, kurs_id=w.kurs_id, name=w.name, tasks=w.tasks or [], results=w.results or {}, scale=w.scale, absent=w.absent or [])


@router.delete("/works/{work_id}", status_code=204)
async def delete_work(work_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    from sqlalchemy import delete as sa_delete
    from ..models import Material

    w = await _owned_work(db, user, work_id)
    # Die Anhaenge (Arbeit, Erwartungshorizont) gehen mit. Der Fremdschluessel
    # steht bewusst auf SET NULL — ohne dieses Aufraeumen bliebe die Datei als
    # Karteileiche in der Ablage liegen: sie taucht in keiner Ansicht mehr auf
    # (die zeigen immer einen Bezug) und belegt trotzdem das Speicherkonto.
    await db.execute(sa_delete(Material).where(Material.work_id == work_id, Material.owner_id == user.id))
    await db.delete(w)
    await db.commit()


# ─── Auswertung + Wiederholung ───

class RemediateIn(BaseModel):
    # Anteil falscher Aufgaben eines Themas, ab dem das Thema für den SuS "schwach" ist.
    threshold: float = 0.5
    cards: bool = True       # Karten des Themas wieder fällig (nur mit Modul Karten)
    exercises: bool = True   # Lernpfad-Wiederholungsaufgabe je Thema (nur mit Modul Lernpfad)


def _units(t):
    """Wertungseinheiten einer Aufgabe: ihre Teilaufgaben (a, b, c …) oder — ohne
    Teile — die Aufgabe selbst. Liefert [(unit_id, max), …]."""
    return [(uid, mx) for uid, mx, _ in _units_mit_thema(t)]


def _units_mit_thema(t):
    """Dasselbe, aber mit dem Thema JE Einheit: [(unit_id, max, topic_id), …].

    Die Teilaufgabe gewinnt, die Aufgabe erbt sie weiter. So kann eine
    Wiederholungsaufgabe vier verschiedene Themen pruefen, ohne dass jemand vier
    Aufgaben daraus machen muss.
    """
    erbe = t.get("topic_id")
    parts = t.get("parts")
    if isinstance(parts, list) and parts:
        return [(str(p.get("id")),
                 (float(p["max"]) if isinstance(p.get("max"), (int, float)) and p["max"] > 0 else 1),
                 p.get("topic_id") or erbe)
                for p in parts if p.get("id")]
    return [(t["id"], (float(t["max"]) if isinstance(t.get("max"), (int, float)) and t["max"] > 0 else 1), erbe)]


def _profile(work: WorkAnalysis):
    """Je SuS je Thema: (erreichte Punkte, Maximalpunkte) über die Aufgaben des
    Themas — inkl. Teilaufgaben. Altformat (Liste falscher Aufgaben) wird
    übersetzt (gelistet = 0, sonst volle Punkte)."""
    tasks = work.tasks or []
    # Gruppiert wird nach Thema JE WERTUNGSEINHEIT (Teilaufgabe schlaegt Aufgabe).
    # Frueher lief die Gruppierung ueber die Aufgabe — eine Aufgabe mit vier
    # Teilaufgaben zu vier Themen landete komplett unter einem davon.
    topic_units = {}   # topic_id -> [(unit_id, max), …]
    topic_tasks = {}   # topic_id -> [Aufgaben-ids]  (fuer die Rueckgabe)
    for t in tasks:
        for uid, umax, tid in _units_mit_thema(t):
            if not tid:
                continue
            topic_units.setdefault(tid, []).append((uid, umax))
            if t["id"] not in topic_tasks.setdefault(tid, []):
                topic_tasks[tid].append(t["id"])
    results = work.results or {}

    def unit_pts(entry, uid, umax):
        if isinstance(entry, list):
            return 0 if uid in entry else umax   # Altformat (keine Teilaufgaben)
        v = (entry or {}).get(uid)
        return float(v) if isinstance(v, (int, float)) else 0    # nicht bewertet = 0

    absent = {str(x) for x in (work.absent or [])}
    out = {}  # student_id -> {topic_id: [erreicht, max]}
    for sid, entry in results.items():
        if entry == "abwesend" or str(sid) in absent:   # abwesend: raus aus der Statistik
            continue
        prof = {}
        for topic_id, einheiten in topic_units.items():
            erreicht = 0.0
            mx = 0.0
            for uid, umax in einheiten:
                erreicht += unit_pts(entry, uid, umax)
                mx += umax
            prof[topic_id] = [erreicht, mx]
        out[sid] = prof
    return out, topic_tasks


@router.get("/works/{work_id}/analysis")
async def analysis(work_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Auswertung: je Thema Trefferquote der Klasse + je SuS die schwachen Themen."""
    w = await _owned_work(db, user, work_id)
    prof, topic_tasks = _profile(w)
    names = {t.id: t.name for t in (await db.execute(select(Topic).where(Topic.owner_id == user.id))).scalars().all()}
    parents = {t.id: t.parent_id for t in (await db.execute(select(Topic).where(Topic.owner_id == user.id))).scalars().all()}
    def label(tid):
        nm = names.get(tid, "?"); p = parents.get(tid)
        return f"{names.get(p)} / {nm}" if p and names.get(p) else nm
    # Klassenweit je Thema: erreichte / maximale Punkte.
    klass = {}
    for tid in topic_tasks:
        erreicht = mx = 0
        for sid, pr in prof.items():
            e, m = pr.get(tid, [0, 0]); erreicht += e; mx += m
        klass[tid] = {"topic_id": tid, "label": label(tid), "pct": round(erreicht / mx * 100) if mx else 0}
    # Je SuS schwache Themen (< 50 % der Punkte erreicht). Zeilen ohne saubere
    # Schueler-ID (Altbestand) werden uebergangen, nicht mit einem Fehler quittiert.
    ids = {sid: int(sid) for sid in prof if str(sid).lstrip("-").isdigit()}
    studs = {s.id: s.name for s in (await db.execute(select(Student).where(Student.id.in_(list(ids.values()))))).scalars().all()} if ids else {}
    per_student = []
    for sid, pr in prof.items():
        if sid not in ids:
            continue
        schwach = [label(tid) for tid, (e, m) in pr.items() if m and e / m < 0.5]
        if schwach:
            per_student.append({"student_id": ids[sid], "name": studs.get(ids[sid], "?"), "weak": sorted(schwach)})
    return {"topics": sorted(klass.values(), key=lambda x: x["pct"]), "students": sorted(per_student, key=lambda x: x["name"])}


@router.post("/works/{work_id}/remediate")
async def remediate(work_id: int, body: RemediateIn, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Gezielte Wiederholung aus dem Fehlerprofil (Anteil falscher Aufgaben eines
    Themas ≥ Schwelle = schwach). Je aktivem Modul:
    - Karten: je SuS die Karten seiner schwachen Themen wieder fällig.
    - Lernpfad: je schwachem Thema eine Wiederholungs-Aufgabe im Pool anlegen.
    Beides Brücke (Regel 3) — ohne das jeweilige Modul passiert dort nichts.
    Bestehende Daten bleiben unberührt (nur Fälligkeiten vorziehen / neue Aufgabe)."""
    from datetime import datetime, timezone
    from sqlalchemy import update as _update
    from ..models import CardDeck, Card, CardReview, Exercise
    w = await _owned_work(db, user, work_id)
    prof, _ = _profile(w)
    weak_by_student = {}
    for sid, pr in prof.items():
        if not str(sid).lstrip("-").isdigit():
            continue
        weak = {tid for tid, (e, m) in pr.items() if m and e / m < body.threshold}
        if weak:
            weak_by_student[int(sid)] = weak
    all_topics = set().union(*weak_by_student.values()) if weak_by_student else set()

    requeued = 0
    if body.cards and weak_by_student and await is_active(db, user.id, "karten"):
        deck_by_topic = {}
        for tid in all_topics:
            ids = (await db.execute(select(CardDeck.id).where(
                CardDeck.owner_id == user.id, CardDeck.topic_id == tid, CardDeck.deleted_at.is_(None)))).scalars().all()
            if ids:
                deck_by_topic[tid] = ids
        now = datetime.now(timezone.utc)
        for sid, topics in weak_by_student.items():
            deck_ids = [d for tid in topics for d in deck_by_topic.get(tid, [])]
            if not deck_ids:
                continue
            card_ids = (await db.execute(select(Card.id).where(Card.deck_id.in_(deck_ids)))).scalars().all()
            if not card_ids:
                continue
            res = await db.execute(_update(CardReview).where(
                CardReview.student_id == sid, CardReview.card_id.in_(card_ids), CardReview.reps > 0).values(due=now))
            requeued += res.rowcount or 0

    exercises = 0
    if body.exercises and all_topics and await is_active(db, user.id, "lernpfad"):
        names = {t.id: t.name for t in (await db.execute(select(Topic).where(Topic.id.in_(list(all_topics))))).scalars().all()}
        for tid in all_topics:
            text = f"Wiederholung: {names.get(tid, '')} (aus {w.name})"
            # Dedup: dieselbe Wiederholungsaufgabe nicht doppelt anlegen.
            exists = (await db.execute(select(Exercise.id).where(
                Exercise.owner_id == user.id, Exercise.topic_id == tid, Exercise.aufgabentext == text))).scalar_one_or_none()
            if exists:
                continue
            db.add(Exercise(owner_id=user.id, topic_id=tid, kategorie="Wiederholung", aufgabentext=text))
            exercises += 1

    await db.commit()
    return {"students": len(weak_by_student), "cards_requeued": requeued, "exercises_created": exercises}


# ─── Vergleich: dieselbe Arbeit über mehrere Klassen ───
#
# Zwei Fragen, die eine Einzelauswertung nicht beantwortet:
#   1. Wie hat sich meine andere Klasse in derselben Arbeit geschlagen?
#   2. Welche Aufgabe lief wo schlecht — und lag es an der Aufgabe oder an der
#      Klasse? (Genau die Sicht, die CardVote je Frage längst hat.)
#
# Zusammengehalten wird die Gruppe über `source_id` (Kopien einer Arbeit).
# Ältere Arbeiten, die vor dem Kopier-Knopf von Hand doppelt angelegt wurden,
# haben keine Herkunft — für sie zählt zusätzlich der gleiche NAME. Beides
# zusammen deckt Bestand und Zukunft ab, ohne dass jemand etwas nachpflegt.

def _pct_liste(w: WorkAnalysis) -> list[float]:
    """Erreichte Prozent je gewertetem Kind — dieselbe Rechnung wie im Vergleich
    der Oberfläche, nur an einer Stelle."""
    tasks = w.tasks or []
    gesamt = sum(mx for t in tasks for _, mx in _units(t))
    if not gesamt:
        return []
    absent = {str(x) for x in (w.absent or [])}
    aus = []
    for sid, r in (w.results or {}).items():
        if not r or r == "abwesend" or str(sid) in absent:
            continue
        erreicht = 0.0
        for t in tasks:
            for uid, umax in _units(t):
                if isinstance(r, list):
                    erreicht += 0 if uid in r else umax     # Altformat
                else:
                    v = r.get(uid)
                    erreicht += float(v) if isinstance(v, (int, float)) else 0
        aus.append(round(erreicht / gesamt * 100, 1))
    return aus


def _punkte_je_kind(w: WorkAnalysis) -> tuple[list[str], dict]:
    """(gewertete Kinder, {unit_id: {sid: Punkte}}) — Grundlage aller Kennzahlen."""
    absent = {str(x) for x in (w.absent or [])}
    kinder = [str(sid) for sid, r in (w.results or {}).items()
              if r and r != "abwesend" and str(sid) not in absent]
    punkte: dict = {}
    for t in (w.tasks or []):
        for uid, umax in _units(t):
            je = {}
            for sid in kinder:
                r = (w.results or {}).get(sid) or (w.results or {}).get(int(sid) if sid.isdigit() else sid)
                if isinstance(r, list):
                    je[sid] = 0.0 if uid in r else float(umax)      # Altformat
                else:
                    v = (r or {}).get(uid)
                    je[sid] = float(v) if isinstance(v, (int, float)) else 0.0
            punkte[uid] = je
    return kinder, punkte


def _korrelation(xs: list[float], ys: list[float]) -> Optional[float]:
    n = len(xs)
    if n < 3:
        return None
    mx = sum(xs) / n
    my = sum(ys) / n
    sx = (sum((x - mx) ** 2 for x in xs) / (n - 1)) ** 0.5
    sy = (sum((y - my) ** 2 for y in ys) / (n - 1)) ** 0.5
    if sx == 0 or sy == 0:
        return None          # alle gleich — Trennschaerfe nicht definiert
    cov = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / (n - 1)
    return round(cov / (sx * sy), 2)


def _je_einheit(w: WorkAnalysis) -> list[dict]:
    """Je Wertungseinheit die Zahlen, an denen man eine misslungene Aufgabe
    erkennt — nicht nur die Trefferquote.

    * `pct`      Schwierigkeit: wie viel Prozent der Punkte kamen an.
    * `null`     Anteil Kinder mit 0 Punkten. Ein hoher Wert bei mittlerer Quote
                 heisst: die Aufgabe wurde von vielen gar nicht angefasst —
                 typisch fuer eine unklare Aufgabenstellung.
    * `voll`     Anteil mit voller Punktzahl (Deckeneffekt).
    * `sd`       Streuung der Punkte.
    * `trenn`    Trennschaerfe: Korrelation der Aufgabenpunkte mit der
                 GESAMTleistung ohne diese Aufgabe (part-whole-korrigiert).
                 Unter etwa 0,2 misst die Aufgabe etwas anderes als der Rest der
                 Arbeit, negativ heisst: die Guten scheitern daran. Das ist der
                 Wert, an dem eine schlecht gestellte Aufgabe auffaellt — die
                 blosse Trefferquote kann eine schwere Aufgabe nicht von einer
                 missverstaendlichen unterscheiden.
    """
    kinder, punkte = _punkte_je_kind(w)
    gesamt = {sid: sum(je.get(sid, 0.0) for je in punkte.values()) for sid in kinder}

    aus = []
    for t in (w.tasks or []):
        teile = _units_mit_thema(t)
        for i, (uid, umax, topic_id) in enumerate(teile):
            xs = [punkte.get(uid, {}).get(sid, 0.0) for sid in kinder]
            n = len(xs)
            summe = sum(xs)
            moeglich = umax * n
            mitte = summe / n if n else 0.0
            sd = ((sum((x - mitte) ** 2 for x in xs) / (n - 1)) ** 0.5) if n > 1 else 0.0
            # part-whole-korrigiert: die eigene Aufgabe aus der Gesamtleistung
            # herausrechnen, sonst korreliert jede Aufgabe mit sich selbst.
            rest = [gesamt[sid] - punkte.get(uid, {}).get(sid, 0.0) for sid in kinder]
            teil_label = (t.get("parts") or [{}])[i].get("label") if t.get("parts") else ""
            aus.append({
                "unit_id": uid,
                "task_id": t.get("id"),
                "label": f"{t.get('label') or ''}".strip(),
                "teil": (teil_label or "").strip(),
                "topic_id": topic_id,
                "form": bool(t.get("form")),
                "max": umax,
                "n": n,
                "punkte": [round(x, 2) for x in xs],
                "schnitt": round(mitte, 2) if n else None,
                "pct": round(summe / moeglich * 100) if moeglich else None,
                "sd": round(sd, 2) if n > 1 else None,
                "null": round(sum(1 for x in xs if x == 0) / n * 100) if n else None,
                "voll": round(sum(1 for x in xs if x >= umax) / n * 100) if n else None,
                "trenn": _korrelation(xs, rest),
            })
    return aus


@router.get("/works/{work_id}/vergleich")
async def vergleich(work_id: int, user: User = Depends(require_module), db: AsyncSession = Depends(get_db)):
    """Dieselbe Arbeit über alle Klassen, in denen sie geschrieben wurde."""
    from datetime import datetime, timezone
    from ..models import SchoolClass

    w = await _owned_work(db, user, work_id)
    wurzel = w.source_id or w.id
    name = (w.name or "").strip().lower()

    alle = (await db.execute(select(WorkAnalysis).where(WorkAnalysis.owner_id == user.id))).scalars().all()
    gruppe = [x for x in alle
              if (x.id == wurzel or x.source_id == wurzel
                  # Bestand ohne Herkunft: gleicher Name zaehlt mit. Sonst waere
                  # der Vergleich fuer alles blind, was vor dem Kopier-Knopf
                  # entstanden ist — also fuer alles Vorhandene.
                  or (name and (x.name or "").strip().lower() == name))]
    # Sortierschluessel muss zeitzonenbewusst sein — created_at ist es.
    frueh = datetime(1970, 1, 1, tzinfo=timezone.utc)
    gruppe.sort(key=lambda x: (x.created_at or frueh, x.id))

    klassen = {c.id: c.name for c in (await db.execute(
        select(SchoolClass).where(SchoolClass.id.in_([x.class_id for x in gruppe])))).scalars().all()}

    arbeiten = []
    for x in gruppe:
        pl = _pct_liste(x)
        arbeiten.append({
            "id": x.id, "name": x.name, "class_id": x.class_id,
            "class_name": klassen.get(x.class_id, ""),
            "eigene": x.id == w.id,
            "n": len(pl), "pct_liste": pl,
            "schnitt": round(sum(pl) / len(pl), 1) if pl else None,
            "einheiten": _je_einheit(x),
        })
    # Gesamtdaten je Aufgabe ueber ALLE Klassen der Gruppe. Erst hier wird
    # sichtbar, ob eine Aufgabe misslungen ist: eine Klasse kann schwach sein,
    # aber wenn dieselbe Aufgabe in jeder Klasse einbricht, lag es an ihr.
    # Verglichen wird ueber die POSITION — Kopien haben eigene unit_ids, es ist
    # aber dieselbe Aufgabe an derselben Stelle.
    laenge = max((len(a["einheiten"]) for a in arbeiten), default=0)
    gesamt = []
    for i in range(laenge):
        teile = [a["einheiten"][i] for a in arbeiten if i < len(a["einheiten"]) and a["einheiten"][i]["n"]]
        if not teile:
            gesamt.append(None)
            continue
        erste = teile[0]
        alle_punkte = [x for teil in teile for x in teil["punkte"]]
        n = len(alle_punkte)
        umax = erste["max"] or 1
        summe = sum(alle_punkte)
        mitte = summe / n if n else 0
        sd = ((sum((x - mitte) ** 2 for x in alle_punkte) / (n - 1)) ** 0.5) if n > 1 else None
        werte = [teil["pct"] for teil in teile if teil["pct"] is not None]
        gesamt.append({
            "label": erste["label"], "teil": erste["teil"], "max": umax, "form": erste["form"],
            "topic_id": erste["topic_id"],
            "n": n,
            "pct": round(summe / (umax * n) * 100) if n else None,
            "sd": round(sd, 2) if sd is not None else None,
            "null": round(sum(1 for x in alle_punkte if x == 0) / n * 100) if n else None,
            "voll": round(sum(1 for x in alle_punkte if x >= umax) / n * 100) if n else None,
            # Trennschaerfe wird je Klasse gerechnet (die Gesamtleistung ist nur
            # innerhalb einer Arbeit vergleichbar) und dann gemittelt.
            "trenn": (round(sum(teil["trenn"] for teil in teile if teil["trenn"] is not None)
                            / len([1 for teil in teile if teil["trenn"] is not None]), 2)
                      if any(teil["trenn"] is not None for teil in teile) else None),
            "spanne": (max(werte) - min(werte)) if len(werte) > 1 else None,
        })

    # Die Rohpunkte muessen nicht ueber die Leitung: sie waren nur Zwischenschritt.
    for a in arbeiten:
        for e in a["einheiten"]:
            e.pop("punkte", None)

    return {"work_id": w.id, "gruppe": wurzel, "arbeiten": arbeiten, "gesamt": gesamt}
