"""Wie ein Kurs beschriftet wird — ein Blatt, damit jeder Router es holen kann.

Stand bis 17.09.2026 als `_kurs_label` in routers/kalender.py. Das Notizbrett
braucht dieselbe Beschriftung (Korrektur-To-do „Mathe · 7.5: 2. KA
korrigieren"), darf den Kalender-Router aber nicht importieren: der importiert
schon `todos` — das waere der Importring. Kalender und CalDAV holen es weiter
unter dem alten Namen aus routers/kalender.py.

Gegenstueck: `kursLabel` in apps/web/src/core/kurslabel.js — zusammen aendern.
"""
from .kursmitglieder import kurs_der_klasse
from .models import Kurs


def kurs_label(kurs) -> str:
    """"Mathe · 7.5" — Fach zuerst, Kursname dahinter.

    Zwei Fassungen hiessen, dass derselbe Termin im Handykalender anders heisst
    als im Browser. Steht das Fach schon im Namen ("Mathe 7.5"), waere
    "Mathe · Mathe 7.5" doppelt gemoppelt — viele Konten benennen ihre Kurse
    genau so.
    """
    if kurs is None:
        return ""
    fach = (getattr(kurs, "fach", "") or "").strip()
    name = (getattr(kurs, "name", "") or "").strip()
    if not fach:
        return name
    if not name:
        return fach
    if fach.lower() in name.lower():
        return name
    return f"{fach} · {name}"


async def kurs_des_termins(db, owner_id: int, kurs_id, class_id):
    """Der Kurs eines Termins: sein eigener, sonst der EINE seiner Klasse.

    Mehrdeutig (Klasse in zwei Kursen) heisst None — geraten wird nicht.
    Fremde oder geloeschte Kurse zaehlen nicht.
    """
    kid = kurs_id or (await kurs_der_klasse(db, class_id) if class_id else None)
    if not kid:
        return None
    k = await db.get(Kurs, kid)
    if not k or k.owner_id != owner_id or getattr(k, "deleted_at", None) is not None:
        return None
    return k
