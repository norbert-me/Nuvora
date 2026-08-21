"""Notenverlauf: wie entwickeln sich die Leistungen über das Halbjahr?

Zwei Quellen, ein Verlauf — CardVote-Quizze und Klassenarbeiten. Beide prüfen
dieselben Kinder auf dieselbe Weise (erreichte von möglichen Punkten), also
gehören sie auf dieselbe Achse. Getrennt gezeigt wären es zwei Kurven, die
niemand zusammenrechnet.

Was dieses Modul NICHT tut, und das ist Absicht:

  • **Keine Gesamtnote.** Es zeigt die einzelnen Erhebungen in ihrer zeitlichen
    Folge. Was daraus für das Zeugnis folgt, entscheidet die Lehrkraft — das
    Notenbuch (mit seinen Gewichten) ist der Ort dafür, nicht eine Kurve.
  • **Kein Mittelwert über die Quellen.** Ein Quiz über vier Fragen und eine
    zweistündige Arbeit sind nicht gleich viel wert, und sie ungewichtet zu
    mitteln wäre eine Zahl, die so tut, als wüsste sie etwas.

Die Note je Erhebung kommt aus `scoring.note_aus_pct` — dieselbe Funktion wie
im Notenbuch und im Themenstand. Der Notenschlüssel ist je Erhebung der ihre
(Quiz: `eval_config.grade_scale`, Arbeit: `work.scale`), sonst der aus dem
Profil; ein Schlüssel gilt für eine Erhebung, nicht für ein Halbjahr.

Regel 3: je Quelle wird `is_active` geprüft. Nur CardVote aktiv → nur Quizze,
nur Auswertung → nur Arbeiten, ohne beide eine leere Antwort statt 403 — der
Verlauf ist eine Kern-Sicht und darf nicht mit einem Modul verschwinden.
"""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from . import rueckmeldung
from .models import Session, WorkAnalysis
from .scoring import note_aus_pct


def _arbeit_prozent(w: WorkAnalysis) -> dict:
    """Je Kind der erreichte Anteil an einer Klassenarbeit (0..100).

    Abwesende bleiben draußen — „nicht mitgeschrieben" ist keine Leistung von
    null. Kinder ohne eine einzige eingetragene Zahl ebenso: das ist „noch
    nicht korrigiert", nicht „alles falsch".
    """
    from .routers.klassenarbeit import _units

    umax = {uid: mx for t in (w.tasks or []) for uid, mx in _units(t)}
    gesamt = sum(umax.values())
    if not gesamt:
        return {}
    absent = {str(x) for x in (w.absent or [])}
    out = {}
    for sid, eintrag in (w.results or {}).items():
        if str(sid) in absent or eintrag == "abwesend" or not isinstance(eintrag, dict):
            continue
        if not any(isinstance(v, (int, float)) for v in eintrag.values()):
            continue
        erreicht = sum(float(v) for uid, v in eintrag.items()
                       if uid in umax and isinstance(v, (int, float)))
        out[str(sid)] = max(0.0, min(100.0, erreicht / gesamt * 100))
    return out


async def klasse(db: AsyncSession, user, class_id: int, *, cardvote: bool, auswertung: bool,
                 student_id=None, card_id=None) -> dict:
    """Verlauf je Kind für eine Klasse — chronologisch.

    `student_id` oder `card_id` grenzen auf ein Kind ein; ohne beides kommt die
    ganze Lerngruppe. Zwei Wege, weil die Auswertungsseiten von CardVote über
    die KARTENNUMMER gehen (die steht auf dem gedruckten Bogen) und alles andere
    über die Schüler-ID.
    """
    from .schueler import roster_klasse

    roster = await roster_klasse(db, class_id)
    if student_id is not None:
        roster = [s for s in roster if s.id == student_id]
    elif card_id is not None:
        roster = [s for s in roster if s.card_id == card_id]
    if not roster:
        return {"erhebungen": [], "schueler": []}
    # CardVote rechnet über die KARTENNUMMER, die Klassenarbeit über die
    # Schüler-ID. Beides muss auf dieselbe Person zeigen, sonst stünden zwei
    # halbe Verläufe nebeneinander.
    per_card = {s.card_id: s for s in roster}
    per_id = {str(s.id): s for s in roster}
    werte = {s.id: [] for s in roster}
    erhebungen = []

    if cardvote:
        sessions = (await db.execute(select(Session).where(
            Session.class_id == class_id, Session.question_set_id.is_not(None)
        ).order_by(Session.created_at))).scalars().all()
        for sess in sessions:
            zeilen = await rueckmeldung.quiz(db, sess)
            if not zeilen:
                continue
            erhebungen.append({"quelle": "cardvote", "id": sess.id, "name": sess.name or "Test",
                               "date": sess.created_at.isoformat() if sess.created_at else None})
            for z in zeilen:
                st = per_card.get(z["card_id"])
                if not st:
                    continue
                werte[st.id].append({
                    "quelle": "cardvote", "id": sess.id, "name": sess.name or "Test",
                    "date": sess.created_at.isoformat() if sess.created_at else None,
                    "pct": z["pct"], "note": z["note"],
                })

    if auswertung:
        arbeiten = (await db.execute(select(WorkAnalysis).where(
            WorkAnalysis.owner_id == user.id, WorkAnalysis.class_id == class_id
        ).order_by(WorkAnalysis.created_at))).scalars().all()
        for w in arbeiten:
            prozente = _arbeit_prozent(w)
            if not prozente:
                continue
            skala = w.scale or user.grade_scale
            erhebungen.append({"quelle": "arbeit", "id": w.id, "name": w.name or "Klassenarbeit",
                               "date": w.created_at.isoformat() if w.created_at else None})
            for sid, pct in prozente.items():
                st = per_id.get(sid)
                if not st:
                    continue
                werte[st.id].append({
                    "quelle": "arbeit", "id": w.id, "name": w.name or "Klassenarbeit",
                    "date": w.created_at.isoformat() if w.created_at else None,
                    "pct": round(pct), "note": note_aus_pct(pct, skala),
                })

    # Chronologisch — die Quellen kommen getrennt herein, gezeigt wird eine Achse.
    for liste in werte.values():
        liste.sort(key=lambda x: x["date"] or "")
    erhebungen.sort(key=lambda x: x["date"] or "")

    return {
        "erhebungen": erhebungen,
        "schueler": [{"student_id": s.id, "name": s.name, "werte": werte[s.id]}
                     for s in roster if werte[s.id]],
    }
