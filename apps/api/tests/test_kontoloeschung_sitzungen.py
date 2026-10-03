"""Ein Konto mit CardVote-Sitzungen laesst sich loeschen.

Sitzungen haengen doppelt am Konto: ueber owner_id (CASCADE) und ueber ihre
Klasse (class_id, ohne Loeschregel). In Postgres scheiterte das Loeschen des
Kontos je nach Reihenfolge der beiden Ketten an „sessions_class_id_fkey" —
gesehen beim Aufraeumen eines Wegwerf-Kontos des Selbsttests. Deshalb raeumt
`_purge_user_content` die Sitzungen vorher selbst weg.
"""
import pytest
from sqlalchemy import select

from app.models import SchoolClass, Session, User
from app.routers.auth import _purge_user_content


@pytest.mark.asyncio
async def test_sitzungen_sind_vor_dem_konto_weg(s):
    u = User(email="weg@b.de", password_hash="x", name="L"); s.add(u); await s.flush()
    c = SchoolClass(name="7a", owner_id=u.id); s.add(c); await s.flush()
    s.add_all([Session(owner_id=u.id, class_id=c.id, code="ABC1"),
               # Altbestand ohne Besitzer an der eigenen Klasse — haengt nur ueber die Klasse.
               Session(owner_id=None, class_id=c.id, code="ABC2")])
    await s.commit()
    await _purge_user_content(s, u.id)
    await s.commit()
    assert (await s.execute(select(Session))).scalars().all() == []
