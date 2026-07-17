from collections import Counter
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..database import get_db
from ..models import Scan, Session, SchoolClass, Student, QuestionSet, QuestionSetItem, Question, User
from .auth import get_current_user
from .. import websocket as ws

router = APIRouter(prefix="/api", tags=["results"])


class ScanCreate(BaseModel):
    session_id: int
    student_id: int
    answer: str

    @field_validator("student_id")
    @classmethod
    def valid_student_id(cls, v):
        if v < 0 or v > 49:
            raise ValueError("Ungültige Karten-ID (0-49)")
        return v

    @field_validator("answer")
    @classmethod
    def valid_answer(cls, v):
        if v not in ("A", "B", "C", "D", ""):
            raise ValueError("Ungültige Antwort")
        return v


@router.post("/scan", status_code=201)
async def submit_scan(body: ScanCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    session = await db.get(Session, body.session_id)
    if not session or not session.current_question_id:
        raise HTTPException(400, "No active question in session")
    if session.owner_id and session.owner_id != user.id:
        raise HTTPException(403)

    if body.answer not in ("A", "B", "C", "D", ""):
        raise HTTPException(400, "Invalid answer")

    existing = await db.execute(
        select(Scan).where(
            Scan.session_id == body.session_id,
            Scan.question_id == session.current_question_id,
            Scan.student_id == body.student_id,
        )
    )
    scan = existing.scalar_one_or_none()
    if scan:
        scan.answer = body.answer
    else:
        scan = Scan(
            session_id=body.session_id,
            question_id=session.current_question_id,
            student_id=body.student_id,
            answer=body.answer,
        )
        db.add(scan)

    await db.commit()

    await ws.broadcast(body.session_id, {
        "type": "scan",
        "student_id": body.student_id,
        "answer": body.answer,
        "question_id": session.current_question_id,
    })

    all_scans = await db.execute(
        select(Scan).where(
            Scan.session_id == body.session_id,
            Scan.question_id == session.current_question_id,
        )
    )
    counts = Counter(s.answer for s in all_scans.scalars().all())
    await ws.broadcast(body.session_id, {
        "type": "results",
        "question_id": session.current_question_id,
        "counts": {"A": counts.get("A", 0), "B": counts.get("B", 0), "C": counts.get("C", 0), "D": counts.get("D", 0)},
    })

    return {"ok": True}


@router.get("/sessions/{session_id}/results")
async def get_results(session_id: int, question_id: Optional[int] = None, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    session = await db.get(Session, session_id)
    if not session:
        raise HTTPException(404, "Session nicht gefunden")
    if session.owner_id and session.owner_id != user.id:
        raise HTTPException(403, "Kein Zugriff auf diese Session")
    query = select(Scan).where(Scan.session_id == session_id)
    if question_id:
        query = query.where(Scan.question_id == question_id)
    result = await db.execute(query)
    scans = result.scalars().all()
    counts = Counter(s.answer for s in scans)
    return {
        "question_id": question_id,
        "total": len(scans),
        "counts": {"A": counts.get("A", 0), "B": counts.get("B", 0), "C": counts.get("C", 0), "D": counts.get("D", 0)},
        "scans": [{"student_id": s.student_id, "answer": s.answer} for s in scans],
    }


@router.get("/sessions-list")
async def list_sessions(archived: Optional[bool] = None, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    query = select(Session).where((Session.owner_id == user.id) | (Session.owner_id.is_(None))).order_by(Session.created_at.desc())
    if archived is not None:
        query = query.where(Session.archived == archived)
    result = await db.execute(query)
    sessions = result.scalars().all()

    out = []
    for s in sessions:
        class_name = None
        if s.class_id:
            sc = await db.get(SchoolClass, s.class_id)
            if sc:
                class_name = sc.name

        set_name = None
        question_count = 0
        if s.question_set_id:
            qs_result = await db.execute(
                select(QuestionSet)
                .options(selectinload(QuestionSet.items))
                .where(QuestionSet.id == s.question_set_id)
            )
            qs = qs_result.scalar_one_or_none()
            if qs:
                set_name = qs.name
                question_count = len(qs.items)

        scan_count_result = await db.execute(
            select(Scan).where(Scan.session_id == s.id)
        )
        scan_count = len(scan_count_result.scalars().all())

        out.append({
            "id": s.id,
            "name": s.name,
            "class_id": s.class_id,
            "class_name": class_name,
            "set_name": set_name,
            "question_count": question_count,
            "scan_count": scan_count,
            "archived": s.archived,
            "created_at": s.created_at.isoformat() if s.created_at else None,
        })

    return out


@router.get("/sessions/{session_id}/evaluation")
async def get_evaluation(session_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    session = await db.get(Session, session_id)
    if not session:
        raise HTTPException(404)
    if session.owner_id and session.owner_id != user.id:
        raise HTTPException(403, "Kein Zugriff auf diese Session")

    students = []
    if session.class_id:
        result = await db.execute(
            select(Student).where(Student.class_id == session.class_id).order_by(Student.name)
        )
        students = [{"card_id": s.card_id, "name": s.name} for s in result.scalars().all()]

    questions = []
    if session.question_set_id:
        result = await db.execute(
            select(QuestionSetItem)
            .options(selectinload(QuestionSetItem.question))
            .where(QuestionSetItem.question_set_id == session.question_set_id)
            .order_by(QuestionSetItem.position)
        )
        qmap = session.question_map or {}
        for item in result.scalars().all():
            q = item.question
            correct = qmap.get(str(q.id), q.correct_answer)
            questions.append({
                "id": q.id,
                "text": q.text,
                "correct_answer": correct,
                "choices": q.choices,
                "num_choices": q.num_choices or 4,
            })

    result = await db.execute(select(Scan).where(Scan.session_id == session_id))
    all_scans = result.scalars().all()

    scan_map = {}
    for scan in all_scans:
        scan_map[(scan.student_id, scan.question_id)] = scan.answer

    rows = []
    for student in students:
        answers = []
        score = 0
        has_any_scan = any(
            (student["card_id"], q["id"]) in scan_map for q in questions
        )
        for q in questions:
            answer = scan_map.get((student["card_id"], q["id"]))
            correct = q["correct_answer"]
            is_correct = answer is not None and correct is not None and answer in correct
            if is_correct:
                score += 1
            answers.append({
                "question_id": q["id"],
                "answer": answer,
                "correct_answer": correct,
                "is_correct": is_correct,
            })
        rows.append({
            "card_id": student["card_id"],
            "name": student["name"],
            "answers": answers,
            "score": score,
            "total": len([q for q in questions if q["correct_answer"]]),
            "present": has_any_scan,
        })

    return {
        "session_id": session_id,
        "session_name": session.name,
        "questions": questions,
        "students": rows,
    }


@router.get("/questions/{question_id}/stats")
async def get_question_stats(question_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    q = await db.get(Question, question_id)
    if not q:
        raise HTTPException(404)

    result = await db.execute(select(Scan).where(Scan.question_id == question_id))
    scans = result.scalars().all()

    total = len(scans)
    counts = {}
    correct = 0
    for s in scans:
        counts[s.answer] = counts.get(s.answer, 0) + 1
        if q.correct_answer and s.answer in q.correct_answer:
            correct += 1

    import math
    p = correct / total if total > 0 else 0
    item_sd = round(math.sqrt(p * (1 - p)), 3) if total > 0 else None

    # 95%-Konfidenzintervall fuer den Anteil richtiger Antworten (Wilson-Score-Intervall,
    # robuster als die Normalapproximation bei kleinen Stichproben / Anteilen nahe 0 oder 1).
    ci_low = ci_high = None
    if total > 0:
        z = 1.96
        denom = 1 + z * z / total
        center = (p + z * z / (2 * total)) / denom
        margin = (z * math.sqrt((p * (1 - p) + z * z / (4 * total)) / total)) / denom
        ci_low = round(max(0, center - margin) * 100)
        ci_high = round(min(1, center + margin) * 100)

    return {
        "question_id": question_id,
        "total_answers": total,
        "correct": correct,
        "pct_correct": round(correct / total * 100) if total > 0 else None,
        "ci_low": ci_low,
        "ci_high": ci_high,
        "answer_counts": counts,
        "times_used": len(set(s.session_id for s in scans)),
        "item_sd": item_sd,
    }


@router.get("/classes/{class_id}/evaluation")
async def get_class_evaluation(class_id: int, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    school_class = await db.get(SchoolClass, class_id)
    if not school_class:
        raise HTTPException(404)
    if school_class.owner_id and school_class.owner_id != user.id:
        raise HTTPException(403, "Kein Zugriff auf diese Klasse")

    result = await db.execute(
        select(Student).where(Student.class_id == class_id).order_by(Student.name)
    )
    students = [{"card_id": s.card_id, "name": s.name} for s in result.scalars().all()]

    result = await db.execute(
        select(Session).where(Session.class_id == class_id, Session.archived == False).order_by(Session.created_at)
    )
    sessions = result.scalars().all()

    tests = []
    for session in sessions:
        questions = []
        if session.question_set_id:
            q_result = await db.execute(
                select(QuestionSetItem)
                .options(selectinload(QuestionSetItem.question))
                .where(QuestionSetItem.question_set_id == session.question_set_id)
                .order_by(QuestionSetItem.position)
            )
            qmap = session.question_map or {}
            for item in q_result.scalars().all():
                q = item.question
                questions.append({
                    "id": q.id,
                    "correct_answer": qmap.get(str(q.id), q.correct_answer),
                })

        scan_result = await db.execute(select(Scan).where(Scan.session_id == session.id))
        scan_map = {}
        for scan in scan_result.scalars().all():
            scan_map[(scan.student_id, scan.question_id)] = scan.answer

        max_score = len([q for q in questions if q["correct_answer"]])

        set_name = None
        if session.question_set_id:
            qs = await db.get(QuestionSet, session.question_set_id)
            if qs:
                set_name = qs.name

        student_scores = {}
        for student in students:
            has_any = any((student["card_id"], q["id"]) in scan_map for q in questions)
            if not has_any:
                student_scores[student["card_id"]] = {"score": None, "total": max_score, "present": False}
                continue
            score = 0
            for q in questions:
                answer = scan_map.get((student["card_id"], q["id"]))
                if answer and q["correct_answer"] and answer in q["correct_answer"]:
                    score += 1
            student_scores[student["card_id"]] = {"score": score, "total": max_score, "present": True}

        tests.append({
            "session_id": session.id,
            "name": session.name,
            "set_name": set_name,
            "created_at": session.created_at.isoformat() if session.created_at else None,
            "max_score": max_score,
            "student_scores": student_scores,
        })

    return {
        "class_id": class_id,
        "class_name": school_class.name,
        "students": students,
        "tests": tests,
    }


# --- Statistics Dashboard ---

@router.get("/stats/dashboard")
async def stats_dashboard(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    # Nur eigene Daten (bzw. globale ohne Eigentuemer) auswerten
    own_class = (SchoolClass.owner_id == user.id) | (SchoolClass.owner_id.is_(None))
    own_session = (Session.owner_id == user.id) | (Session.owner_id.is_(None))

    classes_result = await db.execute(
        select(SchoolClass).options(selectinload(SchoolClass.students)).where(own_class).order_by(SchoolClass.name)
    )
    classes = classes_result.scalars().all()

    class_count = len(classes)
    student_count = sum(len(c.students) for c in classes)
    session_count = (await db.execute(select(func.count(Session.id)).where(own_session))).scalar()
    scan_count = (await db.execute(
        select(func.count(Scan.id)).where(Scan.session_id.in_(select(Session.id).where(own_session)))
    )).scalar()
    question_count = (await db.execute(select(func.count(Question.id)))).scalar()

    class_stats = []
    for cls in classes:
        sess_result = await db.execute(
            select(Session).where(Session.class_id == cls.id, Session.archived == False)
        )
        sessions = sess_result.scalars().all()
        test_count = len(sessions)

        if not sessions:
            class_stats.append({"id": cls.id, "name": cls.name, "student_count": len(cls.students), "test_count": 0, "avg_pct": None})
            continue

        all_pcts = []
        for session in sessions:
            questions = []
            if session.question_set_id:
                q_result = await db.execute(
                    select(QuestionSetItem).options(selectinload(QuestionSetItem.question))
                    .where(QuestionSetItem.question_set_id == session.question_set_id)
                )
                qmap = session.question_map or {}
                for item in q_result.scalars().all():
                    q = item.question
                    questions.append({"id": q.id, "correct_answer": qmap.get(str(q.id), q.correct_answer)})

            scan_result = await db.execute(select(Scan).where(Scan.session_id == session.id))
            scans_list = scan_result.scalars().all()
            scan_map = {(s.student_id, s.question_id): s.answer for s in scans_list}

            max_score = len([q for q in questions if q["correct_answer"]])
            if max_score == 0:
                continue

            for student in cls.students:
                has_any = any((student.card_id, q["id"]) in scan_map for q in questions)
                if not has_any:
                    continue
                score = sum(1 for q in questions if scan_map.get((student.card_id, q["id"])) and q["correct_answer"] and scan_map[(student.card_id, q["id"])] in q["correct_answer"])
                all_pcts.append(round(score / max_score * 100))

        avg_pct = round(sum(all_pcts) / len(all_pcts)) if all_pcts else None
        class_stats.append({
            "id": cls.id,
            "name": cls.name,
            "student_count": len(cls.students),
            "test_count": test_count,
            "avg_pct": avg_pct,
        })

    # Recent sessions with scores
    recent_result = await db.execute(
        select(Session).where(Session.archived == False).order_by(Session.created_at.desc()).limit(10)
    )
    recent_sessions = recent_result.scalars().all()
    recent = []
    for s in recent_sessions:
        class_name = None
        if s.class_id:
            c = await db.get(SchoolClass, s.class_id)
            class_name = c.name if c else None
        set_name = None
        if s.question_set_id:
            qs = await db.get(QuestionSet, s.question_set_id)
            set_name = qs.name if qs else None

        scan_result = await db.execute(select(func.count(Scan.id)).where(Scan.session_id == s.id))
        sc = scan_result.scalar()

        recent.append({
            "id": s.id,
            "name": s.name,
            "class_name": class_name,
            "set_name": set_name,
            "scan_count": sc,
            "created_at": s.created_at.isoformat() if s.created_at else None,
        })

    # Grade distribution across all sessions
    grade_dist = {1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0}
    for cls in classes:
        sess_result = await db.execute(
            select(Session).where(Session.class_id == cls.id, Session.archived == False)
        )
        for session in sess_result.scalars().all():
            config = session.eval_config or {}
            scale_raw = config.get("grade_scale", {1: 87, 2: 73, 3: 59, 4: 45, 5: 20, 6: 0})
            scale = {int(k): v for k, v in scale_raw.items()}
            weights = config.get("weights", {})

            questions = []
            if session.question_set_id:
                q_result = await db.execute(
                    select(QuestionSetItem).options(selectinload(QuestionSetItem.question))
                    .where(QuestionSetItem.question_set_id == session.question_set_id)
                )
                qmap = session.question_map or {}
                for item in q_result.scalars().all():
                    q = item.question
                    questions.append({"id": q.id, "correct_answer": qmap.get(str(q.id), q.correct_answer)})

            get_w = lambda qid: weights.get(str(qid), weights.get(qid, 1))
            max_score = sum(get_w(q["id"]) for q in questions if q["correct_answer"])
            if max_score == 0:
                continue

            scan_result = await db.execute(select(Scan).where(Scan.session_id == session.id))
            scan_map = {(s.student_id, s.question_id): s.answer for s in scan_result.scalars().all()}

            for student in cls.students:
                has_any = any((student.card_id, q["id"]) in scan_map for q in questions)
                if not has_any:
                    continue
                score = sum(get_w(q["id"]) for q in questions if scan_map.get((student.card_id, q["id"])) and q["correct_answer"] and scan_map[(student.card_id, q["id"])] in q["correct_answer"])
                pct = round(score / max_score * 100)
                for g in range(1, 6):
                    if pct >= scale.get(g, 0):
                        grade_dist[g] += 1
                        break
                else:
                    grade_dist[6] += 1

    return {
        "totals": {
            "classes": class_count,
            "students": student_count,
            "sessions": session_count,
            "scans": scan_count,
            "questions": question_count,
        },
        "class_stats": class_stats,
        "recent_sessions": recent,
        "grade_distribution": grade_dist,
    }
