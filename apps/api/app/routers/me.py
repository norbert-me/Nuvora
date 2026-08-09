"""Konto-Selbstverwaltung: DSGVO-Datenauskunft (Art. 15).

Ein Endpunkt, der ALLE Daten der angemeldeten Lehrkraft als JSON ausliefert —
Profil, Klassen/Schüler (inkl. Förder-/Notizfelder, denn es sind ihre eigenen
Daten) und jede Modultabelle, die ihr gehört. Owner-gefiltert; fremde Daten
sind ausgeschlossen. Marktplatz-Veröffentlichungen zählen dazu (sie stammen von
ihr), Bewertungen anderer nicht.
"""
from datetime import datetime, date

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import inspect as sa_inspect, select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import models as m
from ..database import get_db
from .auth import get_current_user

router = APIRouter(prefix="/api/me", tags=["me"])


def _val(v):
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    return v


def _dump(row) -> dict:
    """Alle Spalten einer Zeile als JSON-sicheres dict.

    Zwei Ausnahmen:

    - Der Passwort-Hash bleibt draussen.
    - Dateiinhalte (Schuelerfotos, Kartenbilder, Material) sind Bytes. Sie
      liessen sich nicht als JSON schreiben, und eine Auskunft mit eingebetteten
      Fotos waere unhandlich. Statt des Inhalts steht die Groesse da; die Datei
      selbst laedt die Lehrkraft im Modul herunter.

    Wichtig: die Blob-Spalten sind im Modell als `deferred` markiert — sie
    werden absichtlich NICHT mitgeladen. Sie hier anzufassen loeste eine
    Nachladung mitten in der Antwort aus, und die scheitert im asynchronen
    Kontext (MissingGreenlet). Deshalb werden ungeladene Spalten uebersprungen.
    """
    ungeladen = sa_inspect(row).unloaded
    out = {}
    for c in row.__table__.columns:
        if c.name in ("password_hash",):
            continue
        if c.name in ungeladen:
            out[c.name] = "(Datei — im Modul herunterladbar)"
            continue
        wert = getattr(row, c.name)
        if isinstance(wert, (bytes, bytearray, memoryview)):
            out[c.name + "_bytes"] = len(wert)
            continue
        out[c.name] = _val(wert)
    return out


async def _rows(db: AsyncSession, model, *where):
    res = await db.execute(select(model).where(*where))
    return [_dump(r) for r in res.scalars().all()]


@router.get("/export")
async def export_me(user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    uid = user.id
    # IDs der eigenen Klassen/Schüler — für klassen-/schülergebundene Tabellen,
    # die kein eigenes owner_id tragen (Student, GradeEntry, Card, ...).
    class_ids = [c.id for c in (await db.execute(select(m.SchoolClass).where(m.SchoolClass.owner_id == uid))).scalars().all()]
    student_ids = []
    if class_ids:
        student_ids = [s.id for s in (await db.execute(select(m.Student).where(m.Student.class_id.in_(class_ids)))).scalars().all()]
    folder_ids = [f.id for f in (await db.execute(select(m.Folder).where(m.Folder.owner_id == uid))).scalars().all()]
    qset_ids = []
    if folder_ids:
        qset_ids = [q.id for q in (await db.execute(select(m.QuestionSet).where(m.QuestionSet.folder_id.in_(folder_ids)))).scalars().all()]
    deck_ids = [d.id for d in (await db.execute(select(m.CardDeck).where(m.CardDeck.owner_id == uid))).scalars().all()]
    item_ids = [i.id for i in (await db.execute(select(m.MaterialItem).where(m.MaterialItem.owner_id == uid))).scalars().all()]
    cat_ids = [c.id for c in (await db.execute(select(m.GradeCategory).where(m.GradeCategory.owner_id == uid))).scalars().all()]
    session_ids = [s.id for s in (await db.execute(select(m.Session).where(m.Session.owner_id == uid))).scalars().all()]
    path_ids = [p.id for p in (await db.execute(select(m.LearningPath).where(m.LearningPath.owner_id == uid))).scalars().all()]
    kurs_ids = [k.id for k in (await db.execute(select(m.Kurs).where(m.Kurs.owner_id == uid))).scalars().all()]
    week_ids = [w.id for w in (await db.execute(select(m.PlanWeek).where(m.PlanWeek.owner_id == uid))).scalars().all()]

    def in_(model, col, ids):
        return getattr(model, col).in_(ids) if ids else getattr(model, col).in_([-1])

    data = {
        "exportiert_am": datetime.utcnow().isoformat() + "Z",
        "hinweis": "Vollständige Kopie deiner Nuvora-Daten (DSGVO Art. 15). "
                   "Enthält besonders schützenswerte Schülerdaten (Förderschwerpunkte, Notizen) — vertraulich behandeln.",
        "profil": _dump(user),
        "module_aktiv": await _rows(db, m.UserModule, m.UserModule.user_id == uid),
        "klassen": await _rows(db, m.SchoolClass, m.SchoolClass.owner_id == uid),
        "schueler": await _rows(db, m.Student, in_(m.Student, "class_id", class_ids)),
        "themen": await _rows(db, m.Topic, m.Topic.owner_id == uid),
        "fragen": await _rows(db, m.Question, m.Question.owner_id == uid),
        "ordner": await _rows(db, m.Folder, m.Folder.owner_id == uid),
        "fragensets": await _rows(db, m.QuestionSet, in_(m.QuestionSet, "id", qset_ids)),
        "fragenset_items": await _rows(db, m.QuestionSetItem, in_(m.QuestionSetItem, "question_set_id", qset_ids)),
        "sessions": await _rows(db, m.Session, m.Session.owner_id == uid),
        "scans": await _rows(db, m.Scan, in_(m.Scan, "session_id", session_ids)),
        "noten_abschnitte": await _rows(db, m.GradeSection, m.GradeSection.owner_id == uid),
        "noten_spalten": await _rows(db, m.GradeCategory, m.GradeCategory.owner_id == uid),
        "noten_eintraege": await _rows(db, m.GradeEntry, in_(m.GradeEntry, "category_id", cat_ids)),
        "noten_overrides": await _rows(db, m.GradeOverride, m.GradeOverride.owner_id == uid),
        "quartalsstriche": await _rows(db, m.QuartalDivider, m.QuartalDivider.owner_id == uid),
        "karten_decks": await _rows(db, m.CardDeck, m.CardDeck.owner_id == uid),
        "karten": await _rows(db, m.Card, in_(m.Card, "deck_id", deck_ids)),
        "kalender_eintraege": await _rows(db, m.CalendarEntry, m.CalendarEntry.owner_id == uid),
        "kalender_freie_zeiten": await _rows(db, m.CalendarBreak, m.CalendarBreak.owner_id == uid),
        "stundenplan": await _rows(db, m.TimetableSlot, m.TimetableSlot.owner_id == uid),
        "anwesenheit": await _rows(db, m.Attendance, m.Attendance.owner_id == uid),
        "sitzplaene": await _rows(db, m.SeatingPlan, m.SeatingPlan.owner_id == uid),
        "orga": await _rows(db, m.OrgaItem, m.OrgaItem.owner_id == uid),
        "material": await _rows(db, m.MaterialItem, m.MaterialItem.owner_id == uid),
        "material_ausleihen": await _rows(db, m.MaterialLoan, m.MaterialLoan.owner_id == uid),
        "einstiege": await _rows(db, m.Method, m.Method.owner_id == uid),
        "lernpfade": await _rows(db, m.LearningPath, m.LearningPath.owner_id == uid),
        "lernleitern": await _rows(db, m.LearningLadder, in_(m.LearningLadder, "path_id", path_ids)),
        "aufgaben": await _rows(db, m.Exercise, m.Exercise.owner_id == uid),
        "code_puzzles": await _rows(db, m.CodePuzzle, m.CodePuzzle.owner_id == uid),
        "marktplatz_veroeffentlichungen": await _rows(db, m.MarketplaceQuiz, m.MarketplaceQuiz.author_id == uid),
        "marktplatz_bewertungen": await _rows(db, m.MarketplaceRating, m.MarketplaceRating.user_id == uid),
        # Nachgetragen: diese Tabellen fehlten in der Auskunft, obwohl sie zum Teil
        # das Persoenlichste enthalten, was Nuvora speichert (Beobachtungen,
        # Elterngespraeche, Lernfortschritt je Kind). Art. 15 verlangt Vollstaendigkeit
        # — test_export_vollstaendig.py haelt das ab jetzt nach.
        "beobachtungen": await _rows(db, m.Observation, m.Observation.owner_id == uid),
        "elternkontakte": await _rows(db, m.ParentContact, m.ParentContact.owner_id == uid),
        "notizzettel": await _rows(db, m.NotepadNote, m.NotepadNote.owner_id == uid),
        "karten_fortschritt": await _rows(db, m.CardReview, in_(m.CardReview, "student_id", student_ids)),
        "karten_ordner": await _rows(db, m.CardFolder, m.CardFolder.owner_id == uid),
        "kurse": await _rows(db, m.Kurs, m.Kurs.owner_id == uid),
        "kurs_klassen": await _rows(db, m.KursTag, in_(m.KursTag, "kurs_id", kurs_ids)),
        "kurs_mitglieder": await _rows(db, m.KursStudent, in_(m.KursStudent, "kurs_id", kurs_ids)),
        "klassenarbeiten": await _rows(db, m.WorkAnalysis, m.WorkAnalysis.owner_id == uid),
        "klassenarbeitstermine": await _rows(db, m.ExamDate, m.ExamDate.owner_id == uid),
        "segel_stufen": await _rows(db, m.SegelStatus, m.SegelStatus.owner_id == uid),
        "ausgefallene_stunden": await _rows(db, m.SlotCancellation, m.SlotCancellation.owner_id == uid),
        "planungs_wochen": await _rows(db, m.PlanWeek, m.PlanWeek.owner_id == uid),
        "planungs_bloecke": await _rows(db, m.PlanBlock, in_(m.PlanBlock, "week_id", week_ids)),
        "einstiege_ordner": await _rows(db, m.MethodFolder, m.MethodFolder.owner_id == uid),
        "todos": await _rows(db, m.Todo, m.Todo.owner_id == uid),
        "zufall_ziehungen": await _rows(db, m.ZufallDraw, m.ZufallDraw.owner_id == uid),
        "code_sessions": await _rows(db, m.CodeSession, m.CodeSession.owner_id == uid),
        # Materialablage: Metadaten (Name, Typ, Groesse, Zuordnung). Die Datei
        # selbst laedt die Lehrkraft im Modul herunter.
        "material_dateien": await _rows(db, m.Material, m.Material.owner_id == uid),
    }
    return JSONResponse(
        content=data,
        headers={"Content-Disposition": f'attachment; filename="nuvora-export-{date.today().isoformat()}.json"'},
    )
