"""Die Person — ein Kind, unabhaengig von seinen Listen.

Bis hierher WAR die Zeile in `students` das Kind: dieselbe Anna hatte in
„7.5 LZ" und „7.5 Mathematik" zwei Zeilen, und was zur Person gehoert (Niveau,
Foerderschwerpunkte, Notizen, Foto) wurde per `zeilen_der_person` auf alle
Kopien geschrieben. Das hielt die Daten zusammen, beantwortete aber die Frage
nicht, die eine Lehrkraft wirklich stellt: „wie steht Anna insgesamt da?" —
dafuer musste man erst raten, welche Zeilen dasselbe Kind meinen.

Dieses Blatt macht daraus eine Ebene. Zwei Aufgaben, mehr nicht:

  * `uebernahme_personen` hebt den Bestand einmalig auf die neue Ebene,
  * `person_von_zeile` beantwortet „wer sitzt hier?" fuer alles Uebrige.

Blatt: kein Router-Import, damit jeder Router es holen kann.
"""
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from .models import Person, SchoolClass, Student

# Die Felder, die der PERSON gehoeren — nicht ihrer Zugehoerigkeit zu einer
# Liste. Sie stehen hier an einer Stelle, weil die Uebernahme sie kopiert und
# spaeter jede Anzeige sie liest; zwei Listen davon liefen nach der ersten
# Aenderung auseinander.
PERSON_FELDER = ("niveau", "foerder", "massnahmen", "notizen", "klassenlehrer",
                 "karten_token", "photo_mime")


def _schluessel(zeile: Student) -> str:
    """Woran erkennt man dieselbe Person? Am Namen, normalisiert.

    Mehr gibt der Bestand nicht her — Nuvora hat nie eine Personen-ID gefuehrt.
    Genau so arbeitet die bisherige Kruecke (`schueler.zeilen_der_person`), die
    Uebernahme aendert daran nichts und erfindet keine Zusammenhaenge: zwei
    Kinder mit demselben Namen bei derselben Lehrkraft werden zu EINER Person —
    dasselbe Ergebnis wie bisher beim Schreiben von Foerderdaten.
    """
    return " ".join((zeile.name or "").split()).casefold()


async def uebernahme_personen(db: AsyncSession) -> int:
    """Bestand einmalig auf die Personen-Ebene heben. Gibt die Zahl der neuen
    Personen zurueck.

    Idempotent: Zeilen mit `person_id` bleiben unangetastet. Es wird NICHTS
    geloescht und nichts umgehaengt — die alten Felder an `students` bleiben
    stehen, bis der Umbau abgeschlossen ist. Ein Rueckweg muss offen bleiben,
    solange die Module noch auf `students` rechnen.
    """
    offen = (await db.execute(
        select(Student, SchoolClass.owner_id)
        .join(SchoolClass, Student.class_id == SchoolClass.id)
        .where(Student.person_id.is_(None))
    )).all()
    if not offen:
        return 0

    # Was es schon gibt, wird wiederverwendet: die Uebernahme laeuft bei jedem
    # Start und darf beim zweiten Mal keine Zwillinge anlegen.
    vorhanden = {}
    for p in (await db.execute(select(Person))).scalars().all():
        vorhanden[(p.owner_id, " ".join((p.name or "").split()).casefold())] = p

    neu = 0
    for zeile, owner_id in offen:
        if owner_id is None:
            continue                      # verwaiste Klasse — nichts zu tun
        key = (owner_id, _schluessel(zeile))
        p = vorhanden.get(key)
        if p is None:
            p = Person(owner_id=owner_id, name=zeile.name or "")
            # Die Angaben der ersten gefundenen Zeile gelten: sie standen bisher
            # ohnehin auf allen Zeilen derselben Person (zeilen_der_person).
            for f in PERSON_FELDER:
                setattr(p, f, getattr(zeile, f, None))
            db.add(p)
            await db.flush()
            vorhanden[key] = p
            neu += 1
        zeile.person_id = p.id
    await db.commit()

    # Fotos wandern in einem Rutsch mit — als SQL, damit die Blobs nicht durch
    # den Anwendungsspeicher laufen (ein Klassensatz sind schnell 100 MB).
    try:
        await db.execute(text(
            "UPDATE persons SET photo = s.photo, photo_thumb = s.photo_thumb "
            "FROM students s WHERE s.person_id = persons.id "
            "AND persons.photo IS NULL AND s.photo IS NOT NULL"))
        await db.commit()
    except Exception:
        await db.rollback()               # SQLite (Tests) kennt UPDATE..FROM nicht
    return neu


async def person_von_zeile(db: AsyncSession, student_id: int):
    """Die Person hinter einer Listenzeile — oder None."""
    z = await db.get(Student, student_id)
    if not z or not z.person_id:
        return None
    return await db.get(Person, z.person_id)
