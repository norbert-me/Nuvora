"""Ganze Ordner-Struktur löschen: ein Ordner mit Unterordnern (rekursiv) und
Fragensets verschwindet komplett — die DB kaskadiert über parent_id/folder_id.
Regression: der ORM-Objekt-Delete scheiterte in async an Lazy-Load der Kinder."""
import pytest
from sqlalchemy import select

from app.models import User, Folder, QuestionSet
from app.routers import folders as F


@pytest.mark.asyncio
async def test_delete_folder_structure(s):
    u = User(email="a@b.de", password_hash="x", name="L"); s.add(u); await s.flush()
    root = Folder(name="Root", owner_id=u.id); s.add(root); await s.flush()
    sub = Folder(name="Sub", parent_id=root.id, owner_id=u.id); s.add(sub); await s.flush()
    subsub = Folder(name="SubSub", parent_id=sub.id, owner_id=u.id); s.add(subsub); await s.flush()
    s.add(QuestionSet(name="Set A", folder_id=root.id))
    s.add(QuestionSet(name="Set B", folder_id=subsub.id))
    await s.commit()

    # Den Wurzel-Ordner löschen -> alles darunter muss weg sein.
    await F.delete_folder(root.id, user=u, db=s)

    folders = (await s.execute(select(Folder))).scalars().all()
    sets = (await s.execute(select(QuestionSet))).scalars().all()
    assert folders == []
    assert sets == []


@pytest.mark.asyncio
async def test_delete_set_nulls_calendar_link(s):
    """Wird ein Frageset gelöscht, muss die Verknüpfung im Kalender-Eintrag
    verschwinden (cardvote_set_id ON DELETE SET NULL)."""
    from datetime import datetime, timezone
    from app.models import QuestionSet, CalendarEntry
    u = User(email="c@d.de", password_hash="x", name="L"); s.add(u); await s.flush()
    qs = QuestionSet(name="Quiz", owner_id=u.id); s.add(qs); await s.flush()
    e = CalendarEntry(owner_id=u.id, date=datetime(2026, 9, 3, 12, tzinfo=timezone.utc), cardvote_set_id=qs.id)
    s.add(e); await s.commit()

    await F.delete_question_set(qs.id, user=u, db=s)

    await s.refresh(e)
    assert e.cardvote_set_id is None
