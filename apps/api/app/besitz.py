"""„Gehoert das dem angemeldeten Konto?" — an einer Stelle.

Ein Blatt: nur FastAPI, SQLAlchemy und die Modelle, kein Router. Deshalb darf
jeder Router von hier holen, ohne einen Importring zu bauen (wie `spalten.py`).

Vorher stand die Pruefung in jedem Router noch einmal: `_owned_class` fuenfmal
wortgleich, in einer zweiten Fassung noch zweimal, und „hol das Objekt,
vergleiche owner_id, sonst 404" ein rundes Dutzend Mal. Zusammengefuehrt ist
nur, was dieselbe Sache meint — die zwei Klassen-Fassungen bleiben zwei
Funktionen, weil sie sich im Statuscode unterscheiden.
"""
from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import select

from .models import SchoolClass


async def oder_403(db, model, obj_id, user, fehlt=None, verboten=None):
    """Datensatz holen; fremder ist 403, unbekannter 404.

    Die **nachsichtige** Fassung: ein Datensatz ohne `owner_id` (Bestand aus der
    Zeit vor der Mandantentrennung) gehoert allen und wird durchgelassen. Der
    Gegensatz ist `eigenes` weiter unten — dort ist fremd 404, weil nach aussen
    nicht erkennbar sein soll, ob es die ID ueberhaupt gibt.

    `fehlt`/`verboten` sind die Meldungstexte. Ohne Angabe bleibt es bei den
    nackten Statuscodes, die die Aufrufer bisher warfen — der Text ist Teil der
    Antwort und darf sich beim Zusammenfuehren nicht aendern.

    Stand als Vierzeiler rund achtzehnmal da: elfmal in `sessions.py`
    (Statuscode ohne Text), dreimal in `results.py` und viermal in
    `export_import.py` (mit Text) — jedes Mal fuer dieselbe Sitzung, jedes Mal
    von Hand. Eine Zugriffsregel, die achtzehnmal dasteht, ist achtzehnmal
    eine Gelegenheit, sie beim naechsten Endpunkt zu vergessen.
    """
    obj = await db.get(model, obj_id)
    if not obj:
        raise HTTPException(404, fehlt)
    if obj.owner_id and obj.owner_id != user.id:
        raise HTTPException(403, verboten)
    return obj


async def nur_eigenes(db, model, obj_id, user, fehlt=None, verboten=None):
    """Wie `oder_403` — aber OHNE Nachsicht fuer besitzlose Zeilen.

    `oder_403` laesst eine Zeile ohne `owner_id` durch: Bestand aus der Zeit
    vor der Mandantentrennung gehoert dort allen. Zum ANSEHEN ist das der
    bewusste Kompromiss (sonst kaeme die Lehrkraft an ihre eigenen Altdaten
    nicht mehr heran). Zum LOESCHEN ist es ein Loch: ein Ordner ohne Besitzer
    liesse sich von jedem angemeldeten Konto samt Unterordnern und Quizzen
    hart entfernen, und Ordner- wie Sitzungs-IDs sind fortlaufend — man muss
    sie nicht raten, man zaehlt sie durch.

    Deshalb gilt fuer alles, was WEGNIMMT: kein Besitzer, kein Zugriff. Die
    Meldung sagt, was zu tun ist — `owner_backfill` in main.py traegt den
    Besitzer nach, wo er sich herleiten laesst.
    """
    obj = await db.get(model, obj_id)
    if not obj:
        raise HTTPException(404, fehlt)
    if obj.owner_id != user.id:
        raise HTTPException(403, verboten or "Keine Berechtigung")
    return obj


async def klasse_oder_403(db, user, class_id) -> SchoolClass:
    """Klasse holen; fremde Klasse ist 403, unbekannte 404.

    Vorher wortgleich in zufall.py, orga.py, sitzplan.py, anwesenheit.py und
    klassenarbeit.py. Bleibt eine eigene Funktion mit eigenem Namen: sie ist
    der mit Abstand haeufigste Fall und traegt ihre beiden Meldungstexte.
    """
    return await oder_403(db, SchoolClass, class_id, user,
                          "Klasse nicht gefunden", "Keine Berechtigung")


async def eigene_klasse(db, user, class_id) -> SchoolClass:
    """Klasse holen; alles, was nicht dem Konto gehoert, ist 404.

    Die strenge Fassung: hier reicht „owner_id ist leer" **nicht**, und fremd
    ist nicht 403 sondern 404 — nach aussen soll nicht erkennbar sein, ob es
    die ID ueberhaupt gibt. Vorher wortgleich in karten.py und noten.py.

    Bewusst nicht mit `klasse_oder_403` zusammengelegt: der Statuscode ist Teil
    der Antwort, und beide Fassungen werden von Tests in ihrer Form geprueft.
    """
    cls = (await db.execute(select(SchoolClass).where(
        SchoolClass.id == class_id, SchoolClass.owner_id == user.id))).scalar_one_or_none()
    if not cls:
        raise HTTPException(404, "Klasse nicht gefunden")
    return cls


async def eigenes(db, model, obj_id, user, fehlt: str, *, weich: bool = False):
    """Einen Datensatz holen, der dem Konto gehoeren muss — sonst 404 `fehlt`.

    Stand in fast jedem Router als eigener `_owned_*`-Helfer (Arbeit, Abschnitt,
    Spalte, Kurs, Lernpfad, Ordner, Stapel, Punkt …); unterschieden haben sich
    die Kopien nur im Modell und im Meldungstext — jetzt Argumente.

    `weich=True` schliesst zusaetzlich aus, was im Papierkorb liegt.
    """
    obj = await db.get(model, obj_id)
    if obj is None or obj.owner_id != user.id:
        raise HTTPException(404, fehlt)
    if weich and getattr(obj, "deleted_at", None) is not None:
        raise HTTPException(404, fehlt)
    return obj


def kurs_oder_klasse(model, user, class_id, kurs_id):
    """WHERE-Bedingungen fuer „haengt am Kurs, sonst an der Klasse".

    Dieselbe Schluesselregel lag fuenfmal als eigenes `_key_where` herum
    (orga, sitzplan zweimal, klassenarbeit, noten) — unterschieden haben sich
    die Kopien nur im Modell. Ergebnis ist eine **unterschiedlich lange** Liste
    und wird darum immer per `*` entpackt.
    """
    if kurs_id is not None:
        return [model.owner_id == user.id, model.kurs_id == kurs_id]
    return [model.owner_id == user.id, model.class_id == class_id, model.kurs_id.is_(None)]


async def gehoert_optional(db, model, obj_id, owner_id, *, pflicht: bool,
                           code: int = 404, name: str = "Nicht gefunden"):
    """Eine optionale Verknuepfung aufs eigene Konto pruefen — eine Quelle fuer
    die Handvoll `_check_topic`/`_check_class`/`_check_kurs`, die in sechs
    Routern fast wortgleich standen.

    `None` bleibt `None` (die Bindung ist ueberall optional). Sonst zwei Formen,
    und der Unterschied ist Absicht, nicht Zufall:

    * `pflicht=False` — Fremdes oder Unbekanntes wird **still verworfen**
      (Rueckgabe `None`). So halten es die Anzeige-Bindungen (Material, Noten,
      Einstiege): ein Tippfehler in einer topic_id soll den ganzen Vorgang
      nicht abbrechen.
    * `pflicht=True` — Fremdes oder Unbekanntes wird **abgelehnt** (`code`,
      Vorgabe 404; manche Aufrufer wollen 400). Fuer Wege, an denen die Bindung
      zur Kernsache gehoert.

    Rueckgabe bei Treffer: die id selbst (die Aufrufer setzen sie zurueck ins Feld).
    """
    if obj_id is None:
        return None
    ok = (await db.execute(
        select(model.id).where(model.id == obj_id, model.owner_id == owner_id)
    )).scalar_one_or_none()
    if ok is not None:
        return obj_id
    if pflicht:
        raise HTTPException(code, name)
    return None
