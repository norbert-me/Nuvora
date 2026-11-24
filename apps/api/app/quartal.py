"""Quartalsstriche: vom Spaltenbezug zum Datum (einmalig beim Start, idempotent)."""
from sqlalchemy import select

from .models import GradeCategory, QuartalDatum, QuartalDivider


async def striche_zu_daten(db) -> int:
    """Aus „Strich nach Spalte X" (`quartal_dividers`) wird „Strich am Datum der Spalte X" (`quartal_daten`).

    Die Spalte hatte ein Datum der Leistung, sonst ein Anlagedatum — dieselbe Regel wie im Verlauf
    (`spaltenDatum` im Frontend). Gibt es die Spalte nicht mehr, fällt der Strich weg. Gleiche Tage je
    Klasse/Kurs/Halbjahr werden nicht doppelt geführt. Danach ist die alte Zeile gelöscht — ein zweiter Lauf
    findet nichts mehr.
    """
    rows = (await db.execute(select(QuartalDivider))).scalars().all()
    n = 0
    for r in rows:
        cat = await db.get(GradeCategory, r.after_category_id)
        tag = (cat.date or (cat.created_at.date() if cat.created_at else None)) if cat else None
        if tag is not None:
            schon = (await db.execute(select(QuartalDatum.id).where(
                QuartalDatum.class_id == r.class_id, QuartalDatum.owner_id == r.owner_id,
                QuartalDatum.term == r.term, QuartalDatum.datum == tag))).first()
            if not schon:
                db.add(QuartalDatum(owner_id=r.owner_id, class_id=r.class_id, kurs_id=r.kurs_id, term=r.term, datum=tag))
        await db.delete(r)
        n += 1
    if n:
        await db.commit()
    return n
