"""Rückmeldung zu EINER Erhebung — was saß, was fehlt, je Kind.

Die Auswertung sagt der Lehrkraft, wo es klemmt. Dem Kind sagt sie nichts: es
bekommt eine Zahl und eine Arbeit mit roten Strichen zurück, und die Frage „was
üb ich jetzt eigentlich?" beantwortet niemand. Für die Klassenarbeit steht die
Antwort seit Kurzem auf einem Blatt; hier kommt dieselbe Antwort für ein
CardVote-Quiz dazu.

Warum ein eigenes Modul und nicht im Router: die Rückmeldung wird an ZWEI
Stellen gebraucht — von der Lehrkraft (`results.py`, ganze Klasse zum Drucken)
und vom Kind selbst (`karten.py`, Schülerseite hinter dem QR-Code). Ein Router,
der den anderen importiert, ist genau der Ring, den CLAUDE.md verbietet; beide
holen es deshalb hier.

Die Regeln sind dieselben wie beim Blatt zur Klassenarbeit, und sie dürfen es
bleiben:

  • KEIN Vergleich mit der Klasse — kein Rang, kein Schnitt, kein fremder Name.
    Das Blatt wird ausgeteilt und liegt danach auf einem Küchentisch, und die
    Schülerseite sieht das Kind allein.
  • Nur was saß (≥ SASS) und was fehlt (< OFFEN), nicht jedes Thema. Ein Blatt,
    auf dem alle zwölf Themen kommentiert sind, liest niemand zu Ende.
  • Wer als „krank" gilt, bekommt keine Rückmeldung — er hat nichts abgegeben,
    und eine 0 wäre eine Aussage über nichts.

Gerechnet wird mit `scoring.bewerte` (dieselbe Funktion wie PDF, Excel und die
Notenbuch-Brücke) und `scoring.note_aus_pct` — die Zahl auf dem Blatt muss die
sein, die überall sonst steht.
"""
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import QuestionSet, QuestionSetItem, Scan, Session, Topic
from .scoring import bewerte, note_aus_pct, status_of

# Ab hier gilt ein Thema als gesessen bzw. als offen. Dazwischen steht bewusst
# nichts: „62 % — weder noch" ist keine Rückmeldung, sondern eine Zahl.
SASS = 75
OFFEN = 50
# Unter so vielen Fragen sagt ein Thema nichts. Vier A–D-Fragen gehören zu einer
# Ratequote von einem Viertel; bei einer einzigen Frage ist „Thema sitzt nicht"
# schlicht nicht belegt. Dieselbe Vorsicht wie in fruehwarnung.py.
MINDEST_FRAGEN = 2


async def _themen_labels(db: AsyncSession, topic_ids) -> dict:
    """`{topic_id: "Thema / Unterthema"}` — die Beschriftungsregel des Kerns.

    Steht sie zweimal im Code, heißt dieselbe Auswahl in der einen Ansicht
    „Kürzen" und in der anderen „Brüche / Kürzen".
    """
    ids = [t for t in topic_ids if t]
    if not ids:
        return {}
    themen = (await db.execute(select(Topic).where(Topic.id.in_(ids)))).scalars().all()
    by_id = {t.id: t for t in themen}
    eltern = [t.parent_id for t in themen if t.parent_id]
    if eltern:
        for p in (await db.execute(select(Topic).where(Topic.id.in_(eltern)))).scalars().all():
            by_id[p.id] = p
    out = {}
    for tid in ids:
        t = by_id.get(tid)
        if not t:
            continue
        p = by_id.get(t.parent_id) if t.parent_id else None
        out[tid] = f"{p.name} / {t.name}" if p else t.name
    return out


async def quiz(db: AsyncSession, session: Session, nur_card_id: Optional[int] = None) -> list:
    """Rückmeldung zu einer CardVote-Session — je Kind ein Eintrag.

    `nur_card_id` grenzt auf ein Kind ein (Schülerseite): dieselbe Rechnung,
    aber der Server schickt auch nur dessen Zeile heraus. Ohne das Argument
    kommt die ganze Lerngruppe (Blatt zum Ausdrucken).
    """
    from .schueler import roster_klasse

    if not session.question_set_id or not session.class_id:
        return []

    qs = await db.get(QuestionSet, session.question_set_id)
    niveau_aktiv = bool(qs and qs.niveau_aktiv)
    minuspunkte = bool(qs and qs.minuspunkte)
    config = session.eval_config or {}
    qmap = session.question_map or {}

    items = (await db.execute(
        select(QuestionSetItem).where(QuestionSetItem.question_set_id == session.question_set_id)
    )).scalars().all()
    # Fragen laden (die Beziehung ist hier nicht vorgeladen — eine Abfrage).
    from .models import Question
    q_ids = [it.question_id for it in items]
    fragen = {q.id: q for q in (await db.execute(
        select(Question).where(Question.id.in_(q_ids)))).scalars().all()} if q_ids else {}

    questions = []
    for it in items:
        q = fragen.get(it.question_id)
        if not q:
            continue
        questions.append({
            "id": q.id,
            "correct_answer": qmap.get(str(q.id), q.correct_answer),
            "topic_id": q.topic_id,
            "niveau": it.niveau or "",
        })

    scans = (await db.execute(select(Scan).where(Scan.session_id == session.id))).scalars().all()
    # Nur die TATSÄCHLICH gestellten Fragen zählen: eine Live-Session läuft oft
    # über einen Teil des Sets, und die übrigen als „falsch" zu werten hieße,
    # dem Kind ein Thema vorzuhalten, das nie drankam.
    gestellt = {s.question_id for s in scans}
    if not gestellt:
        return []
    antwort = {(s.student_id, s.question_id): s.answer for s in scans}

    labels = await _themen_labels(db, {q["topic_id"] for q in questions})
    roster = await roster_klasse(db, session.class_id)
    out = []
    for st in roster:
        if nur_card_id is not None and st.card_id != nur_card_id:
            continue
        eigene = {q["id"]: antwort.get((st.card_id, q["id"])) for q in questions}
        hat_etwas = any(v is not None for v in eigene.values())
        if status_of(st.card_id, hat_etwas, config) == "krank":
            continue          # nichts abgegeben: keine Aussage, keine Rückmeldung
        w = bewerte(questions, eigene, niveau=st.niveau or "", niveau_aktiv=niveau_aktiv,
                    minuspunkte=minuspunkte, weights=config.get("weights"),
                    scale=config.get("grade_scale"))
        # Je Thema: richtige von gestellten Fragen. Bewusst ungewichtet — hier
        # geht es um „sitzt das?", nicht um die Note; Gewichte gehören zur
        # Wertung der ganzen Erhebung.
        proThema = {}
        for q in questions:
            tid = q["topic_id"]
            if not tid or q["id"] not in gestellt:
                continue
            a = proThema.setdefault(tid, [0, 0])
            a[1] += 1
            ans = eigene.get(q["id"])
            if ans is not None and q["correct_answer"] and ans in q["correct_answer"]:
                a[0] += 1
        themen = []
        for tid, (richtig, gesamt) in proThema.items():
            if gesamt < MINDEST_FRAGEN or tid not in labels:
                continue      # eine Frage ist kein Befund
            themen.append({"label": labels[tid], "erreicht": richtig, "max": gesamt,
                           "pct": round(richtig / gesamt * 100)})
        themen.sort(key=lambda x: x["pct"])
        out.append({
            "student_id": st.id, "card_id": st.card_id, "name": st.name,
            "punkte": w["score"], "max": w["max_score"], "pct": round(w["pct"]),
            "note": note_aus_pct(w["pct"], config.get("grade_scale")),
            "sass": [x for x in themen if x["pct"] >= SASS],
            "offen": [x for x in themen if x["pct"] < OFFEN],
        })
    out.sort(key=lambda x: x["name"])
    return out
