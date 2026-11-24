#!/usr/bin/env python3
"""Noten eines Kurses aus einer Sicherung zurückholen — und NUR die.

Wie `aufgaben_zurueckholen.py`: `backup.zurueckspielen` leert vorher jede
Tabelle und setzt die ganze Installation zurück; für „die Noten eines Kurses
sind weg" ist das ein größerer Schaden als der, den es behebt.

Dieses Skript:

  * liest `datenbank.ndjson` aus der Sicherung,
  * nimmt die `grade_entries`, deren Spalte (`grade_categories`) in der
    Sicherung zu einem Abschnitt (`grade_sections`) des Kurses gehört,
  * fügt nur die ein, deren `id` es heute nicht gibt UND deren Spalte und
    Schüler heute noch existieren (sonst gäbe es einen FK-Fehler oder eine
    Note an einer Spalte, die inzwischen etwas anderes ist),
  * lässt Vorhandenes unberührt. Es füllt Lücken, überschreibt nichts.

Voreingestellt nur Anzeige; geschrieben wird erst mit `--wirklich`.

    docker compose exec -T api python noten_zurueckholen.py --datei nuvora-….zip --kurs 4
    docker compose exec -T api python noten_zurueckholen.py --datei nuvora-….zip --kurs 4 --wirklich
"""
from __future__ import annotations

import argparse
import asyncio
import collections
import io
import json
import os
import sys
import zipfile

from sqlalchemy import select, text

from app.database import async_session
from app.models import GradeCategory, GradeEntry, Student
from app import krypto
from app.routers.backup import BACKUP_DIR, _dekodiere, _passend_machen


def _lies(zip_pfad: str, kurs: int) -> list[dict]:
    """Die Noten des Kurses laut Sicherung (Spalte über Abschnitt → Kurs)."""
    abschnitte: set[int] = set()
    spalten: dict[int, int] = {}
    eintraege: list[dict] = []
    with zipfile.ZipFile(zip_pfad) as zf:
        with zf.open("datenbank.ndjson") as f:
            for zeile in io.TextIOWrapper(f, encoding="utf-8"):
                zeile = zeile.strip()
                if not zeile:
                    continue
                satz = json.loads(zeile)
                t = satz.get("t")
                if t not in ("grade_sections", "grade_categories", "grade_entries"):
                    continue
                r = {k: _dekodiere(v) for k, v in satz["r"].items()}
                if t == "grade_sections" and r.get("kurs_id") == kurs:
                    abschnitte.add(r["id"])
                elif t == "grade_categories":
                    spalten[r["id"]] = r.get("section_id")
                elif t == "grade_entries":
                    eintraege.append(r)
    return [e for e in eintraege
            if e.get("category_id") is not None
            and spalten.get(e["category_id"]) in abschnitte]


async def _lauf(datei: str, kurs: int, wirklich: bool) -> int:
    pfad = datei if os.path.isabs(datei) else os.path.join(BACKUP_DIR, os.path.basename(datei))
    if not os.path.isfile(pfad):
        print(f"Sicherung nicht gefunden: {pfad}")
        return 2
    aus_datei = _lies(pfad, kurs)
    print(f"Sicherung : {os.path.basename(pfad)}")
    print(f"Noten des Kurses {kurs} darin: {len(aus_datei)}")
    if not aus_datei:
        return 1

    async with async_session() as db:
        vorhanden = set((await db.execute(select(GradeEntry.id))).scalars().all())
        spalten = set((await db.execute(select(GradeCategory.id))).scalars().all())
        schueler = set((await db.execute(select(Student.id))).scalars().all())
        # Zelle (Spalte, Kind) schon belegt? Dann nicht doppelt füllen.
        belegt = set((await db.execute(
            select(GradeEntry.category_id, GradeEntry.student_id)
            .where(GradeEntry.category_id.is_not(None)))).all())

    fehlen, grund = [], collections.Counter()
    for e in aus_datei:
        if e["id"] in vorhanden:
            grund["id schon da"] += 1
        elif e["category_id"] not in spalten:
            grund["Spalte gibt es nicht mehr"] += 1
        elif e["student_id"] not in schueler:
            grund["Kind gibt es nicht mehr"] += 1
        elif (e["category_id"], e["student_id"]) in belegt:
            grund["Zelle heute anders belegt"] += 1
        else:
            fehlen.append(e)
    print(f"davon einspielbar: {len(fehlen)}")
    for g, n in grund.items():
        print(f"  übersprungen — {g}: {n}")
    if not fehlen:
        return 0
    arten = collections.Counter(e.get("kind") for e in fehlen)
    print(f"Arten: {dict(arten)}")
    if not wirklich:
        print("\nNur angezeigt. Zum Einspielen dieselbe Zeile mit --wirklich.")
        return 0

    tabelle = GradeEntry.__table__
    zeilen, hinweise = _passend_machen(tabelle, fehlen)
    tabelle, zeilen = krypto.fuer_einspielen(tabelle, zeilen)   # Chiffretext nicht doppelt verschluesseln
    for h in hinweise:
        print(f"  Hinweis: {h}")
    async with async_session() as db:
        for i in range(0, len(zeilen), 200):
            await db.execute(tabelle.insert(), zeilen[i:i + 200])
        await db.commit()
        if db.bind.dialect.name == "postgresql":
            await db.execute(text(
                "SELECT setval(pg_get_serial_sequence('grade_entries','id'), "
                "COALESCE((SELECT MAX(id) FROM grade_entries), 1))"))
            await db.commit()
    print(f"\n{len(zeilen)} Eintrag/Einträge zurückgeholt.")
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description="Noten eines Kurses aus einer Sicherung zurückholen.")
    p.add_argument("--datei", required=True, help="Dateiname der Sicherung im Sicherungsordner")
    p.add_argument("--kurs", type=int, required=True, help="kurse.id")
    p.add_argument("--wirklich", action="store_true", help="wirklich einspielen")
    a = p.parse_args()
    return asyncio.run(_lauf(a.datei, a.kurs, a.wirklich))


if __name__ == "__main__":
    sys.exit(main())
