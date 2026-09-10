"""Die Kurse EINER Person — auf beiden Wegen, die es dorthin gibt.

Eine Person sitzt in einem Kurs entweder ueber eine ganze Klasse (`kurs_tags`)
oder einzeln hinzugefuegt (`kurs_students`). Beim Entwickeln eines Kurses aus
einem anderen entstehen ausschliesslich Zeilen des zweiten Typs: die Zeile in
`students` behaelt ihre alte `kurs_id`, dazu kommt nur eine Mitgliedschaft.

Die Personenseite hat davon lange nur die alte `kurs_id` gelesen — der neue
Kurs fehlte dort, obwohl das Kind darin sitzt. Genau das haelt dieser Test fest.
"""
import pytest

from app.models import Kurs, KursStudent, KursTag, Person, SchoolClass, Student, User
from app.routers import personen as P


async def _welt(s):
    u = User(email="pk@b.de", password_hash="x", name="L")
    s.add(u)
    await s.flush()
    # Drei Kurse: der Ursprung, einer ueber die ganze Klasse, einer einzeln.
    alt = Kurs(owner_id=u.id, name="Mathe 7.5")
    ueber_klasse = Kurs(owner_id=u.id, name="Foerderkurs")
    einzeln = Kurs(owner_id=u.id, name="WP8")
    s.add_all([alt, ueber_klasse, einzeln])
    await s.flush()
    c = SchoolClass(name="Mathe 7.5", owner_id=u.id, kurs_id=alt.id)
    s.add(c)
    await s.flush()
    s.add(KursTag(kurs_id=alt.id, class_id=c.id))
    # Dieselbe Klasse ist auch Mitglied des zweiten Kurses (kurs_tags).
    s.add(KursTag(kurs_id=ueber_klasse.id, class_id=c.id))
    p = Person(owner_id=u.id, name="Mira E.")
    s.add(p)
    await s.flush()
    z = Student(class_id=c.id, kurs_id=alt.id, name="Mira E.", card_id=1,
                position=0, person_id=p.id)
    s.add(z)
    await s.flush()
    # Und einzeln im dritten Kurs — so entsteht „aus einem Kurs entwickeln":
    # die Zeile bleibt, nur die Mitgliedschaft kommt dazu.
    s.add(KursStudent(kurs_id=einzeln.id, student_id=z.id))
    await s.commit()
    return u, p, (alt, ueber_klasse, einzeln)


@pytest.mark.asyncio
async def test_liste_zeigt_alle_kurse_der_person(s):
    u, p, (alt, ueber, einzel) = await _welt(s)
    out = await P.list_personen(user=u, db=s)
    assert len(out) == 1
    assert set(out[0].kurse) == {alt.name, ueber.name, einzel.name}


@pytest.mark.asyncio
async def test_auswertung_zeigt_alle_kurse_der_person(s):
    """Die Detailsicht darf nicht weniger Kurse kennen als die Liste darueber.

    Vorher las sie nur `students.kurs_id` (und ersatzweise den Kurs der Klasse)
    — die Mitgliedschaften ueber `kurs_tags` und `kurs_students` fielen weg,
    und der Kurs „wurde nicht angezeigt".
    """
    u, p, (alt, ueber, einzel) = await _welt(s)
    aus = await P.auswertung(p.id, user=u, db=s)
    namen = [t["kurs"] for t in aus["teile"]]
    assert set(namen) == {alt.name, ueber.name, einzel.name}, namen
    assert len(namen) == len(set(namen)), "kein Kurs doppelt"
    # Jeder Teil nennt seine Kurs-ID — an ihr haengen die Nachteilsausgleiche.
    assert all(t["kurs_id"] for t in aus["teile"])
