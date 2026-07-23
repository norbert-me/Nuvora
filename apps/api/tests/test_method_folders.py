"""Einstiege-Ordner (wie CardVote): anlegen, verschachteln, Einstieg zuordnen.
Löschen eines Ordners kaskadiert Unterordner; Einstiege darin wandern in die
Wurzel (method.folder_id SET NULL)."""
import pytest
import pytest_asyncio
from sqlalchemy import event, select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from app.models import Base, User, Method, MethodFolder, UserModule
from app.routers import methoden as M


@pytest_asyncio.fixture
async def s():
    e = create_async_engine("sqlite+aiosqlite:///:memory:")

    @event.listens_for(e.sync_engine, "connect")
    def _fk(c, _):
        c.execute("PRAGMA foreign_keys=ON")

    async with e.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    async with async_sessionmaker(e, class_=AsyncSession, expire_on_commit=False)() as ss:
        yield ss
    await e.dispose()


@pytest.mark.asyncio
async def test_method_folder_crud_and_delete(s):
    u = User(email="a@b.de", password_hash="x", name="L"); s.add(u); await s.flush()
    s.add(UserModule(user_id=u.id, module_key="methoden"))
    await s.commit()

    root = await M.create_folder(M.FolderIn(name="Mathe"), user=u, db=s)
    sub = await M.create_folder(M.FolderIn(name="Einstiege", parent_id=root.id), user=u, db=s)
    lst = await M.list_folders(user=u, db=s)
    assert {f.name for f in lst} == {"Mathe", "Einstiege"}

    # Einstieg im Unterordner.
    m = await M.create_method(M.MethodIn(title="Blitzlicht", folder_id=sub.id), user=u, db=s)
    assert m.folder_id == sub.id

    # Wurzel löschen -> Unterordner weg, Einstieg bleibt mit genulltem folder_id.
    await M.delete_folder(root.id, user=u, db=s)
    folders = (await s.execute(select(MethodFolder.id))).scalars().all()
    assert folders == []
    fid = (await s.execute(select(Method.folder_id).where(Method.id == m.id))).scalar_one()
    assert fid is None   # Einstieg bleibt, Ordner-Zuordnung genullt


@pytest.mark.asyncio
async def test_method_folder_foreign_owner_rejected(s):
    u1 = User(email="a@b.de", password_hash="x", name="L1"); s.add(u1)
    u2 = User(email="c@d.de", password_hash="x", name="L2"); s.add(u2); await s.flush()
    s.add(UserModule(user_id=u1.id, module_key="methoden"))
    s.add(UserModule(user_id=u2.id, module_key="methoden"))
    await s.commit()
    f = await M.create_folder(M.FolderIn(name="privat"), user=u1, db=s)
    # Fremder darf den Ordner weder benennen noch als Ziel nutzen.
    with pytest.raises(Exception):
        await M.update_folder(f.id, M.FolderIn(name="hack"), user=u2, db=s)
    with pytest.raises(Exception):
        await M.create_method(M.MethodIn(title="X", folder_id=f.id), user=u2, db=s)
