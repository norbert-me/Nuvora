"""Eine Session laesst sich einem anderen Kurs DERSELBEN Klasse zuweisen."""
import pytest
from fastapi import HTTPException

from app.models import Kurs, KursTag, SchoolClass, Session, User
from app.routers import sessions as R


@pytest.mark.asyncio
async def test_session_kurs_nur_innerhalb_der_klasse(s):
    u = User(email="k@b.de", password_hash="x", name="L")
    s.add(u)
    await s.flush()
    c = SchoolClass(name="7.5", owner_id=u.id)
    k1 = Kurs(owner_id=u.id, name="Mathe")
    k2 = Kurs(owner_id=u.id, name="Lernzeit")
    fremd = Kurs(owner_id=u.id, name="Anderer")
    s.add_all([c, k1, k2, fremd])
    await s.flush()
    s.add_all([KursTag(kurs_id=k1.id, class_id=c.id), KursTag(kurs_id=k2.id, class_id=c.id)])
    sess = Session(owner_id=u.id, class_id=c.id, name="Test", code="ABC123")
    s.add(sess)
    await s.commit()
    assert (await R.session_kurs(sess.id, R.KursIn(kurs_id=k2.id), user=u, db=s))["kurs_id"] == k2.id
    with pytest.raises(HTTPException) as f:
        await R.session_kurs(sess.id, R.KursIn(kurs_id=fremd.id), user=u, db=s)
    assert f.value.status_code == 400
    assert (await R.session_kurs(sess.id, R.KursIn(kurs_id=None), user=u, db=s))["kurs_id"] is None
