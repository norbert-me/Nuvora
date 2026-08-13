"""Regressionstests zum Kern-Datenmodell: Klassen, Kurse, Themen, Papierkorb.

Hier stehen die Fehler, die Daten verloren, falsche Daten gezeigt oder fremde
Daten angefasst haben — je einer pro Test, damit sie nicht zurückkommen.
"""
import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy import event, select, func
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from app import models as m
from app.models import Base, User, SchoolClass, Student
from app.routers import classes as C, kurse as K, topics as T, trash as TR


def _engine(fk: bool = True):
    e = create_async_engine("sqlite+aiosqlite:///:memory:")

    @event.listens_for(e.sync_engine, "connect")
    def _pragma(c, _):
        c.execute("PRAGMA foreign_keys=%s" % ("ON" if fk else "OFF"))

    return e


@pytest_asyncio.fixture
async def s():
    e = _engine()
    async with e.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    async with async_sessionmaker(e, class_=AsyncSession, expire_on_commit=False)() as ss:
        yield ss
    await e.dispose()


@pytest_asyncio.fixture
async def s_ohne_fk():
    """Wie die gewachsene Produktions-DB: Spalten, die _ensure_columns per
    ALTER TABLE nachgezogen hat, tragen dort KEINEN Fremdschlüssel — also auch
    kein ON DELETE SET NULL. Ohne PRAGMA verhält sich SQLite genauso."""
    e = _engine(fk=False)
    async with e.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    async with async_sessionmaker(e, class_=AsyncSession, expire_on_commit=False)() as ss:
        yield ss
    await e.dispose()


async def _user(s, mail="a@b.de"):
    u = User(email=mail, password_hash="x", name="L")
    s.add(u)
    await s.flush()
    return u


async def _klasse(s, u, name, *namen):
    c = await C.create_class(C.ClassCreate(
        name=name, students=[C.StudentIn(card_id=i + 1, name=n) for i, n in enumerate(namen)]
    ), user=u, db=s)
    return c


# ─── Klassen: Eingaben, die still Daten fressen ───

@pytest.mark.asyncio
async def test_doppelte_card_id_wird_abgelehnt(s):
    """Zwei Schüler mit derselben card_id: update_class führt über card_id
    zusammen — der zweite überschrieb den ersten, einer verschwand still."""
    # Kein Nutzer nötig: die Abwehr sitzt schon in der Eingabeprüfung (Pydantic),
    # also vor jedem Datenbankzugriff.
    with pytest.raises(ValueError):
        C.ClassCreate(name="7a", students=[
            C.StudentIn(card_id=1, name="Max"), C.StudentIn(card_id=1, name="Mia")])


@pytest.mark.asyncio
async def test_leerer_klassenname_wird_abgelehnt(s):
    with pytest.raises(ValueError):
        C.ClassCreate(name="   ")


@pytest.mark.asyncio
async def test_klassenname_wird_getrimmt(s):
    u = await _user(s)
    c = await _klasse(s, u, "  7a  ")
    assert c.name == "7a"


# ─── Kurse: Mitgliedschaft ───

@pytest.mark.asyncio
async def test_entfernen_aus_eigenem_kurs_wirkt(s):
    """Jede neue Klasse bekommt ihren Kurs (SchoolClass.kurs_id + KursTag).
    remove_member löschte nur das Tag — über die alte Spalte blieb die Klasse
    Mitglied, teilte weiter SuS und Anwesenheit."""
    u = await _user(s)
    c1 = await _klasse(s, u, "Mathe 7.5", "Max")
    c2 = await _klasse(s, u, "Lernzeit 7.5")
    kurs = (await s.get(SchoolClass, c1.id)).kurs_id
    await K.add_member(kurs, c2.id, user=u, db=s)
    assert await K.member_class_ids(s, [kurs]) == {c1.id, c2.id}

    await K.remove_member(kurs, c1.id, user=u, db=s)
    assert c1.id not in await K.member_class_ids(s, [kurs]), "Klasse trotz Entfernen noch im Kurs"
    assert c1.id not in await K.sibling_class_ids(s, c2.id), "teilt weiter SuS"


@pytest.mark.asyncio
async def test_geloeschte_klasse_nicht_im_kurs_roster(s):
    """Klasse im Papierkorb: ihre SuS dürfen im Kurs nicht mehr auftauchen —
    sonst zeigt die E/G-Liste Namen, die es nicht mehr gibt."""
    u = await _user(s)
    c1 = await _klasse(s, u, "Mathe 7.5", "Max")
    c2 = await _klasse(s, u, "Lernzeit 7.5", "Mia")
    kurs = (await s.get(SchoolClass, c1.id)).kurs_id
    await K.add_member(kurs, c2.id, user=u, db=s)
    await C.delete_class(c2.id, user=u, db=s)

    namen = {x["name"] for x in await K.kurs_students(kurs, user=u, db=s)}
    assert namen == {"Max"}, f"gelöschte Klasse noch im Kurs: {namen}"
    assert c2.id not in await K.sibling_class_ids(s, c1.id)

    await C.restore_class(c2.id, user=u, db=s)
    namen = {x["name"] for x in await K.kurs_students(kurs, user=u, db=s)}
    assert namen == {"Max", "Mia"}, "nach Wiederherstellen wieder dabei"


@pytest.mark.asyncio
async def test_kurs_restore_holt_auch_geloeschte_klasse_zurueck(s):
    """Klasse im Papierkorb, dann Kurs löschen und wiederherstellen: die
    Mitgliedschaft muss überleben, sonst ist sie nach dem Zurückholen der
    Klasse für immer weg."""
    u = await _user(s)
    c1 = await _klasse(s, u, "Mathe 7.5", "Max")
    kurs = (await s.get(SchoolClass, c1.id)).kurs_id
    await C.delete_class(c1.id, user=u, db=s)
    await K.delete_kurs(kurs, user=u, db=s)
    await K.restore_kurs(kurs, user=u, db=s)
    await C.restore_class(c1.id, user=u, db=s)
    assert c1.id in await K.member_class_ids(s, [kurs]), "Mitgliedschaft verloren"


@pytest.mark.asyncio
async def test_niveau_im_teilkurs_wird_gespeichert(s):
    """Kurs aus Teilen von Klassen (kurs_students): Lesen zeigte die SuS,
    Schreiben griff nur über die Mitgliedsklassen ins Leere — das gesetzte
    E/G war nach dem Neuladen wieder weg."""
    u = await _user(s)
    await _klasse(s, u, "7a", "Max", "Mia")
    kurs = await K.create_kurs(K.KursIn(name="Förderkurs"), user=u, db=s)
    max_id = (await s.execute(select(Student.id).where(Student.name == "Max"))).scalar_one()
    await K.add_student_member(kurs.id, max_id, user=u, db=s)
    assert [x["name"] for x in await K.kurs_students(kurs.id, user=u, db=s)] == ["Max"]

    await K.set_niveau(kurs.id, K.NiveauIn(name="Max", niveau="E"), user=u, db=s)
    assert (await s.get(Student, max_id)).niveau == "E", "Niveau nicht gespeichert"


@pytest.mark.asyncio
async def test_fremde_klasse_kommt_nicht_in_meinen_kurs(s):
    """Eine Klasse ohne Besitzer (Altbestand) gehört niemandem — sie darf nicht
    in einen fremden Kurs wandern, sonst schreibt set_niveau/massnahmen dort."""
    u = await _user(s)
    fremd = SchoolClass(name="herrenlos", owner_id=None)
    s.add(fremd)
    await s.flush()
    kurs = await K.create_kurs(K.KursIn(name="K"), user=u, db=s)
    with pytest.raises(HTTPException):
        await K.add_member(kurs.id, fremd.id, user=u, db=s)


@pytest.mark.asyncio
async def test_fremder_kurs_bleibt_fremd(s):
    u1 = await _user(s, "a@b.de")
    u2 = await _user(s, "c@d.de")
    kurs = await K.create_kurs(K.KursIn(name="K"), user=u1, db=s)
    for call in (
        lambda: K.rename_kurs(kurs.id, K.KursIn(name="X"), user=u2, db=s),
        lambda: K.delete_kurs(kurs.id, user=u2, db=s),
        lambda: K.kurs_students(kurs.id, user=u2, db=s),
    ):
        with pytest.raises(HTTPException):
            await call()


# ─── Themen ───

@pytest.mark.asyncio
async def test_thema_loeschen_loest_fragen_ohne_fremdschluessel(s_ohne_fk):
    """In der gewachsenen DB fehlt der FK auf questions.topic_id (per ALTER
    TABLE nachgezogen). Ohne ihn greift ON DELETE SET NULL nicht: die Frage
    behielt die ID eines Themas, das es nicht mehr gibt."""
    s = s_ohne_fk
    u = await _user(s)
    ober = await T.create_topic(T.TopicIn(name="Bruchrechnung"), user=u, db=s)
    unter = await T.create_topic(T.TopicIn(name="Kürzen", parent_id=ober.id), user=u, db=s)
    kl = SchoolClass(name="7a", owner_id=u.id)
    s.add(kl)
    await s.flush()
    q = m.Question(owner_id=u.id, text="1/2 + 1/4?", topic_id=unter.id)
    d = m.CardDeck(owner_id=u.id, name="Stapel", class_id=kl.id, topic_id=ober.id)
    s.add_all([q, d])
    await s.commit()

    # Loeschen ist jetzt weich: das Thema liegt im Papierkorb, und genau
    # deshalb behalten die Inhalte ihre topic_id — ein zurueckgeholtes Thema
    # waere sonst leer.
    await T.delete_topic(ober.id, user=u, db=s)
    await s.refresh(q)
    await s.refresh(d)
    assert q.topic_id == unter.id and d.topic_id == ober.id, "Papierkorb hat schon geloest"

    # Erst endgueltig: hier muss es greifen, sonst zeigen Frage und Stapel auf
    # ein Thema, das es nicht mehr gibt (ohne Fremdschluessel greift kein
    # ON DELETE SET NULL).
    await T.purge_topic(ober.id, user=u, db=s)
    await s.refresh(q)
    await s.refresh(d)
    assert q.topic_id is None, "Frage zeigt auf ein gelöschtes Unterthema"
    assert d.topic_id is None, "Stapel zeigt auf ein gelöschtes Thema"
    assert (await s.execute(select(func.count()).select_from(m.Question))).scalar() == 1


@pytest.mark.asyncio
async def test_fremdes_thema_bleibt_fremd(s):
    u1 = await _user(s, "a@b.de")
    u2 = await _user(s, "c@d.de")
    t = await T.create_topic(T.TopicIn(name="Bruch"), user=u1, db=s)
    with pytest.raises(HTTPException):
        await T.delete_topic(t.id, user=u2, db=s)
    with pytest.raises(HTTPException):
        await T.update_topic(t.id, T.TopicIn(name="X"), user=u2, db=s)


# ─── Papierkorb ───

async def _deck_mit_karte(s, u, class_id=None):
    if class_id is None:
        kl = SchoolClass(name="7a", owner_id=u.id)
        s.add(kl)
        await s.flush()
        class_id = kl.id
    d = m.CardDeck(owner_id=u.id, name="Stapel", class_id=class_id)
    s.add(d)
    await s.flush()
    k = m.Card(deck_id=d.id, front="vorn", back="hinten")
    s.add(k)
    await s.commit()
    return d, k


@pytest.mark.asyncio
async def test_purge_nur_aus_dem_papierkorb(s):
    """Über den Papierkorb-Router ließ sich eine LEBENDE Karte endgültig
    löschen — purge_card prüfte kein deleted_at."""
    u = await _user(s)
    d, k = await _deck_mit_karte(s, u)
    with pytest.raises(HTTPException):
        await TR.purge_item("card", k.id, user=u, db=s)
    assert (await s.execute(select(func.count()).select_from(m.Card))).scalar() == 1


@pytest.mark.asyncio
async def test_restore_nur_aus_dem_papierkorb(s):
    u = await _user(s)
    c = await _klasse(s, u, "7a")
    with pytest.raises(HTTPException):
        await TR.restore_item("class", c.id, user=u, db=s)
    await C.delete_class(c.id, user=u, db=s)
    await TR.restore_item("class", c.id, user=u, db=s)
    with pytest.raises(HTTPException):
        await TR.restore_item("class", c.id, user=u, db=s)  # doppelt


@pytest.mark.asyncio
async def test_papierkorb_zeigt_und_loescht_nur_eigenes(s):
    u1 = await _user(s, "a@b.de")
    u2 = await _user(s, "c@d.de")
    c = await _klasse(s, u1, "7a")
    await C.delete_class(c.id, user=u1, db=s)
    assert await TR.list_trash(user=u2, db=s) == []
    with pytest.raises(HTTPException):
        await TR.purge_item("class", c.id, user=u2, db=s)
    with pytest.raises(HTTPException):
        await TR.restore_item("class", c.id, user=u2, db=s)
    assert (await s.execute(select(func.count()).select_from(SchoolClass))).scalar() == 1


@pytest.mark.asyncio
async def test_papierkorb_leeren_raeumt_kind_vor_eltern(s):
    """Karte und ihr Stapel liegen beide im Papierkorb: das Leeren darf nicht
    an der Karte scheitern, die die Kaskade des Stapels schon mitgenommen hat."""
    u = await _user(s)
    c = await _klasse(s, u, "7a", "Max")
    d, k = await _deck_mit_karte(s, u, class_id=c.id)
    from datetime import datetime
    now = datetime.now()   # SQLite gibt Zeiten naiv zurück — hier gleich naiv setzen
    d.deleted_at = now
    k.deleted_at = now
    await C.delete_class(c.id, user=u, db=s)
    await s.commit()
    await s.refresh(await s.get(SchoolClass, c.id))   # SQLite liest Zeiten naiv zurück

    await TR.empty_trash(user=u, db=s)
    assert await TR.list_trash(user=u, db=s) == []
    for model in (m.Card, m.CardDeck, m.SchoolClass, m.Student):
        n = (await s.execute(select(func.count()).select_from(model))).scalar()
        assert n == 0, f"{model.__tablename__} nach Leeren nicht leer"


# ─── Was die Datenbank hält und was der Code hält ───
#
# Rund 30 Spalten sind per ALTER TABLE nachgezogen (wanted-Liste in main.py) und
# trugen in gewachsenen Datenbanken jahrelang KEINEN Fremdschlüssel — also auch
# kein ON DELETE. `create_all` legt sie dagegen immer mitsamt Constraint an,
# weshalb jeder Test eine Welt sieht, die es in Produktion nicht gab. Die Fixture
# `s_ohne_fk` stellt die Produktionslage nach. Was hier grün ist, hält der Code
# selbst; was xfail ist, hielt allein der Constraint — genau den rüstet
# `_ensure_columns` seit dem Fremdschlüssel-Nachzug wieder nach (Postgres).

@pytest.mark.asyncio
async def test_notenabschnitt_loeschen_raeumt_spalten_ohne_fremdschluessel(s_ohne_fk):
    """`grade_categories.section_id` (ON DELETE CASCADE) steht in der
    wanted-Liste. Verließe sich das Löschen eines Abschnitts allein darauf,
    blieben Spalten und Noten eines Abschnitts stehen, den es nicht mehr gibt."""
    from app.routers import noten as N
    s = s_ohne_fk
    u = await _user(s)
    kl = SchoolClass(name="7a", owner_id=u.id)
    s.add(kl)
    await s.flush()
    sec = m.GradeSection(owner_id=u.id, class_id=kl.id, name="1. Halbjahr")
    s.add(sec)
    await s.flush()
    s.add(m.GradeCategory(owner_id=u.id, class_id=kl.id, section_id=sec.id, name="Test", weight=50))
    await s.commit()

    await N.delete_section(sec.id, user=u, db=s)
    assert (await s.execute(select(func.count()).select_from(m.GradeCategory))).scalar() == 0


@pytest.mark.xfail(strict=True, reason=(
    "Art. 17 hängt am Constraint, nicht am Code: User hat keine ORM-Beziehung zu "
    "questions/question_sets, delete_account verlässt sich auf owner_id ON DELETE "
    "CASCADE. Fehlt der (nachgezogene Spalte ohne Fremdschlüssel), bleibt Inhalt "
    "mit toter owner_id stehen. _ensure_columns rüstet ihn auf Postgres nach."))
@pytest.mark.asyncio
async def test_konto_loeschen_tilgt_inhalt_ohne_fremdschluessel(s_ohne_fk):
    from app.routers import auth as A
    s = s_ohne_fk
    u = await _user(s)
    s.add_all([m.Question(owner_id=u.id, text="1+1?"), m.QuestionSet(owner_id=u.id, name="Test")])
    await s.commit()

    await A._purge_user_content(s, u.id)
    await s.delete(u)
    await s.commit()
    for modell in (m.Question, m.QuestionSet):
        n = (await s.execute(select(func.count()).select_from(modell))).scalar()
        assert n == 0, f"{modell.__tablename__} mit toter owner_id nach Kontolöschung"


@pytest.mark.xfail(strict=True, reason=(
    "students.kurs_id (ON DELETE SET NULL) steht in der wanted-Liste. Das "
    "endgültige Löschen eines Kurses löst die Klasse ausdrücklich, den Schüler "
    "nicht — ohne Constraint zeigt er auf einen Kurs, den es nicht mehr gibt."))
@pytest.mark.asyncio
async def test_kurs_purge_loest_schueler_ohne_fremdschluessel(s_ohne_fk):
    s = s_ohne_fk
    u = await _user(s)
    c = await _klasse(s, u, "Mathe 7a", "Max")
    kurs_id = (await s.get(SchoolClass, c.id)).kurs_id
    await K.delete_kurs(kurs_id, user=u, db=s)
    await TR.purge_item("kurs", kurs_id, user=u, db=s)

    kl = await s.get(SchoolClass, c.id)
    await s.refresh(kl)
    assert kl.kurs_id is None
    for st in (await s.execute(select(Student))).scalars().all():
        assert st.kurs_id is None, "Schüler zeigt auf einen gelöschten Kurs"
