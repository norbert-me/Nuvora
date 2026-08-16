"""Die zusammengefuehrten Besitz- und Schuelerhelfer, festgenagelt.

`app/besitz.py` und `app/schueler.py` haben eingesammelt, was vorher in jedem
Router noch einmal stand. Dieser Test haelt genau die Unterschiede fest, die
dabei **nicht** eingeebnet werden durften:

* die nachsichtige Klassenpruefung antwortet auf eine fremde Klasse mit 403 und
  laesst eine Klasse ohne owner_id durch,
* die strenge antwortet auf beides mit 404,
* und beide Fassungen sind weiter im Router zu haben, unter ihrem alten Namen.
"""
import pytest
from fastapi import HTTPException

from app.besitz import klasse_oder_403, eigene_klasse, eigenes, kurs_oder_klasse, oder_403
from app.schueler import SORTIERUNG, kanonisch, roster_klasse, roster_kurs, sortiert
from app.models import (User, SchoolClass, Student, Kurs, KursTag, Topic, OrgaItem,
                        Session)


async def _konten(s):
    a = User(email="a@b.de", password_hash="x", name="A")
    b = User(email="b@b.de", password_hash="x", name="B")
    s.add_all([a, b])
    await s.flush()
    return a, b


# ─── Klassenpruefung: zwei Fassungen, zwei Antworten ───

@pytest.mark.asyncio
async def test_nachsichtige_fassung(s):
    a, b = await _konten(s)
    eigen = SchoolClass(name="7a", owner_id=a.id)
    fremd = SchoolClass(name="7b", owner_id=b.id)
    herrenlos = SchoolClass(name="Alt", owner_id=None)
    s.add_all([eigen, fremd, herrenlos])
    await s.commit()

    assert (await klasse_oder_403(s, a, eigen.id)).id == eigen.id
    # Bestand ohne owner_id gehoert allen — das war der Grund fuer diese Fassung.
    assert (await klasse_oder_403(s, a, herrenlos.id)).id == herrenlos.id
    with pytest.raises(HTTPException) as e:
        await klasse_oder_403(s, a, fremd.id)
    assert e.value.status_code == 403
    with pytest.raises(HTTPException) as e:
        await klasse_oder_403(s, a, 9999)
    assert e.value.status_code == 404


@pytest.mark.asyncio
async def test_strenge_fassung(s):
    a, b = await _konten(s)
    eigen = SchoolClass(name="7a", owner_id=a.id)
    fremd = SchoolClass(name="7b", owner_id=b.id)
    herrenlos = SchoolClass(name="Alt", owner_id=None)
    s.add_all([eigen, fremd, herrenlos])
    await s.commit()

    assert (await eigene_klasse(s, a, eigen.id)).id == eigen.id
    for fremde in (fremd.id, herrenlos.id, 9999):
        with pytest.raises(HTTPException) as e:
            await eigene_klasse(s, a, fremde)
        assert e.value.status_code == 404, "fremd darf nicht als 403 verraten werden"


@pytest.mark.asyncio
async def test_router_behalten_ihre_fassung(s):
    """Die alten Namen zeigen weiter auf die richtige der beiden Fassungen."""
    from app.routers import zufall, orga, sitzplan, anwesenheit, klassenarbeit, karten, noten
    for mod in (zufall, orga, sitzplan, anwesenheit, klassenarbeit):
        assert mod._owned_class is klasse_oder_403, mod.__name__
    for mod in (karten, noten):
        assert mod._owned_class is eigene_klasse, mod.__name__


# ─── Der allgemeine Besitz-Einzeiler ───

@pytest.mark.asyncio
async def test_eigenes(s):
    a, b = await _konten(s)
    ka = SchoolClass(name="7a", owner_id=a.id)
    kb = SchoolClass(name="7b", owner_id=b.id)
    s.add_all([ka, kb])
    await s.flush()
    mein = OrgaItem(owner_id=a.id, class_id=ka.id, name="X")
    dein = OrgaItem(owner_id=b.id, class_id=kb.id, name="Y")
    s.add_all([mein, dein])
    await s.commit()

    assert (await eigenes(s, OrgaItem, mein.id, a, "Punkt nicht gefunden")).id == mein.id
    for falsch in (dein.id, 9999):
        with pytest.raises(HTTPException) as e:
            await eigenes(s, OrgaItem, falsch, a, "Punkt nicht gefunden")
        assert e.value.status_code == 404
        assert e.value.detail == "Punkt nicht gefunden"


@pytest.mark.asyncio
async def test_eigenes_weich_uebergeht_papierkorb(s):
    from datetime import datetime, timezone
    a, _ = await _konten(s)
    t = Topic(owner_id=a.id, name="Bruch")
    s.add(t)
    await s.commit()
    assert (await eigenes(s, Topic, t.id, a, "Thema nicht gefunden", weich=True)).id == t.id

    t.deleted_at = datetime.now(timezone.utc)
    await s.commit()
    with pytest.raises(HTTPException) as e:
        await eigenes(s, Topic, t.id, a, "Thema nicht gefunden", weich=True)
    assert e.value.status_code == 404
    # Ohne weich=True bleibt der Datensatz erreichbar — das brauchen die
    # Papierkorb-Wege, die genau das Geloeschte anfassen.
    assert (await eigenes(s, Topic, t.id, a, "Thema nicht gefunden")).id == t.id


def test_kurs_oder_klasse_schluessel():
    a = User(id=1, email="a@b.de", password_hash="x")
    mit = kurs_oder_klasse(OrgaItem, a, 5, 7)
    ohne = kurs_oder_klasse(OrgaItem, a, 5, None)
    assert len(mit) == 2 and len(ohne) == 3, "mit Kurs zwei, ohne Kurs drei Bedingungen"
    assert str(mit[1]) == str(OrgaItem.kurs_id == 7)
    assert str(ohne[2]) == str(OrgaItem.kurs_id.is_(None))


# ─── Schuelerlisten ───

async def _lerngruppe(s):
    a, _ = await _konten(s)
    mathe = Kurs(owner_id=a.id, name="Mathe")
    s.add(mathe)
    k1 = SchoolClass(name="7a Mathe", owner_id=a.id)
    k2 = SchoolClass(name="7a Info", owner_id=a.id)
    s.add_all([k1, k2])
    await s.flush()
    s.add_all([KursTag(kurs_id=mathe.id, class_id=k1.id), KursTag(kurs_id=mathe.id, class_id=k2.id)])
    # Dieselbe Person steht in beiden Fach-Klassen; Anna sitzt hinten.
    s.add_all([
        Student(class_id=k1.id, card_id=1, name="Anna", position=2),
        Student(class_id=k1.id, card_id=2, name="Bert", position=1),
        Student(class_id=k2.id, card_id=1, name="Anna", position=2),
    ])
    await s.commit()
    return a, k1, mathe


@pytest.mark.asyncio
async def test_sortierung_nach_position(s):
    a, k1, _ = await _lerngruppe(s)
    namen = [x.name for x in await sortiert(s, Student.class_id == k1.id)]
    assert namen == ["Bert", "Anna"], "position schlaegt card_id"
    assert SORTIERUNG[0] is Student.position


@pytest.mark.asyncio
async def test_roster_dedupliziert_gleichnamige(s):
    a, k1, mathe = await _lerngruppe(s)
    namen = [x.name for x in await roster_klasse(s, k1.id)]
    assert namen == ["Bert", "Anna"], "Anna steht in zwei Fach-Klassen, gemeint ist eine"
    assert [x.name for x in await roster_kurs(s, mathe.id)] == ["Bert", "Anna"]


@pytest.mark.asyncio
async def test_roster_kurs_leer(s):
    a, _ = await _konten(s)
    leer = Kurs(owner_id=a.id, name="Leer")
    s.add(leer)
    await s.commit()
    assert await roster_kurs(s, leer.id) == []


def test_kanonisch_haelt_reihenfolge():
    class S:
        def __init__(self, name, position, card_id, id):
            self.name, self.position, self.card_id, self.id = name, position, card_id, id
    raus = kanonisch([S("Zoe", 3, 9, 3), S("Anna", 1, 1, 1), S("Zoe ", 3, 9, 7)])
    assert [x.name for x in raus] == ["Anna", "Zoe"]


# ─── Die allgemeine nachsichtige Fassung (Sitzungen, Bestand ohne owner_id) ───

@pytest.mark.asyncio
async def test_oder_403_ohne_texte_bleibt_beim_nackten_statuscode(s):
    """`sessions.py` warf `HTTPException(404)`/`(403)` ohne Text — achtzehnmal.

    Der Text ist Teil der Antwort. Wer die Kopien einsammelt und dabei einen
    Standardtext ergaenzt, aendert die Antwort fuer jeden dieser Endpunkte.
    """
    a, b = await _konten(s)
    eigen = Session(code="AAA", owner_id=a.id)
    fremd = Session(code="BBB", owner_id=b.id)
    s.add_all([eigen, fremd])
    await s.commit()

    assert (await oder_403(s, Session, eigen.id, a)).id == eigen.id

    with pytest.raises(HTTPException) as e:
        await oder_403(s, Session, fremd.id, a)
    # Ohne eigenen Text setzt Starlette den Standardsatz — Wort fuer Wort das,
    # was `HTTPException(403)` vorher lieferte.
    assert (e.value.status_code, e.value.detail) == (403, "Forbidden")

    with pytest.raises(HTTPException) as e:
        await oder_403(s, Session, 999999, a)
    assert (e.value.status_code, e.value.detail) == (404, "Not Found")


@pytest.mark.asyncio
async def test_oder_403_reicht_die_texte_durch(s):
    a, b = await _konten(s)
    fremd = Session(code="BBB", owner_id=b.id)
    s.add(fremd)
    await s.commit()

    with pytest.raises(HTTPException) as e:
        await oder_403(s, Session, fremd.id, a, "weg", "verboten")
    assert (e.value.status_code, e.value.detail) == (403, "verboten")

    with pytest.raises(HTTPException) as e:
        await oder_403(s, Session, 999999, a, "weg", "verboten")
    assert (e.value.status_code, e.value.detail) == (404, "weg")


@pytest.mark.asyncio
async def test_oder_403_laesst_bestand_ohne_owner_durch(s):
    """Eine Sitzung aus der Zeit vor der Mandantentrennung gehoert allen.

    Genau das ist der Unterschied zu `eigenes` — wer ihn einebnet, sperrt
    Bestandskonten aus ihren eigenen alten Auswertungen aus.
    """
    a, _ = await _konten(s)
    alt = Session(code="CCC", owner_id=None)
    s.add(alt)
    await s.commit()
    assert (await oder_403(s, Session, alt.id, a)).id == alt.id


@pytest.mark.asyncio
async def test_fremde_sitzung_verraet_nicht_erst_ihre_existenz(s):
    """403 vor 404 oder 404 vor 403 — bei einer FEHLENDEN ID muss 404 kommen.

    `export_import.py` prueft(e) den Besitz zuerst und die Existenz danach; die
    uebrigen umgekehrt. Beide Reihenfolgen ergeben dieselbe Antwort, und das
    muss so bleiben, sonst antwortet derselbe Fehler je nach Endpunkt anders.
    """
    a, _ = await _konten(s)
    with pytest.raises(HTTPException) as e:
        await oder_403(s, Session, 999999, a, verboten="Kein Zugriff auf diese Session")
    assert e.value.status_code == 404
