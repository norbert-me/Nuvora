#!/usr/bin/env python3
"""Aufgaben aus einer Sicherung zurückholen — und NUR die.

Warum es das gibt: Lernpfad-Aufgaben wurden bis 4.3.7 **hart** gelöscht (kein
`deleted_at`, kein Papierkorb). Wer sie verloren hat, bevor die weiche Löschung
ausgerollt war, findet sie nirgends mehr — und das vorhandene Werkzeug
(`backup.zurueckspielen`) ist für diesen Fall das falsche: es **leert vorher
jede Tabelle** und setzt die ganze Installation auf den Stand der Sicherung
zurück. Alles, was seitdem passiert ist — Anwesenheit, Noten, Auswertungen —
wäre weg. Ein Werkzeug, das einen Schaden mit einem größeren behebt, ist keins.

Dieses Skript greift deshalb genau eine Tabelle heraus:

  * Es liest `datenbank.ndjson` aus der Sicherung (eine JSON-Zeile je Zeile der
    Datenbank, `{"t": tabelle, "r": {spalten}}`).
  * Es nimmt daraus die `exercises` **eines Kontos**.
  * Es fügt die ein, deren `id` es heute nicht mehr gibt — mit derselben id.
    Genau deshalb stehen sie danach wieder in ihren Lernleitern: die merken
    sich Aufgaben über ihre id, und die id kommt zurück.
  * Vorhandene Zeilen bleiben **unberührt**. Das Skript überschreibt nichts,
    es füllt Lücken.

Voreingestellt zeigt es nur an (wie `scripts/aufraeumen.py`); geschrieben wird
erst mit `--wirklich`.

Aufruf auf dem Server:

    docker compose exec api python aufgaben_zurueckholen.py --liste
    docker compose exec api python aufgaben_zurueckholen.py --datei backups/nuvora-….zip --konto 2
    docker compose exec api python aufgaben_zurueckholen.py --datei backups/nuvora-….zip --konto 2 --wirklich
"""
from __future__ import annotations

import argparse
import asyncio
import io
import json
import os
import sys
import zipfile

from sqlalchemy import select

from app.database import async_session
from app.models import Exercise, User
from app.routers.backup import BACKUP_DIR, _dekodiere, _passend_machen


def _sicherungen() -> list[str]:
    if not os.path.isdir(BACKUP_DIR):
        return []
    namen = [n for n in os.listdir(BACKUP_DIR) if n.endswith(".zip")]
    namen.sort(key=lambda n: os.path.getmtime(os.path.join(BACKUP_DIR, n)), reverse=True)
    return namen


def _aufgaben_aus(zip_pfad: str, konto: int | None) -> list[dict]:
    """Die `exercises`-Zeilen der Sicherung — gefiltert auf ein Konto."""
    raus: list[dict] = []
    with zipfile.ZipFile(zip_pfad) as zf:
        with zf.open("datenbank.ndjson") as f:
            for zeile in io.TextIOWrapper(f, encoding="utf-8"):
                zeile = zeile.strip()
                if not zeile:
                    continue
                satz = json.loads(zeile)
                if satz.get("t") != "exercises":
                    continue
                reihe = {k: _dekodiere(v) for k, v in satz["r"].items()}
                if konto is not None and reihe.get("owner_id") != konto:
                    continue
                raus.append(reihe)
    return raus


async def _lauf(datei: str, konto: int | None, wirklich: bool) -> int:
    pfad = datei if os.path.isabs(datei) else os.path.join(BACKUP_DIR, os.path.basename(datei))
    if not os.path.isfile(pfad):
        print(f"Sicherung nicht gefunden: {pfad}")
        return 2

    aus_datei = _aufgaben_aus(pfad, konto)
    if not aus_datei:
        print("In dieser Sicherung stehen keine Aufgaben"
              + (f" für Konto {konto}" if konto is not None else "") + ".")
        return 1

    async with async_session() as db:
        if konto is not None and not await db.get(User, konto):
            print(f"Konto {konto} gibt es nicht.")
            return 2
        vorhanden = set((await db.execute(select(Exercise.id))).scalars().all())

    fehlen = [r for r in aus_datei if r.get("id") not in vorhanden]
    print(f"Sicherung : {os.path.basename(pfad)}")
    print(f"Aufgaben darin{'' if konto is None else f' (Konto {konto})'}: {len(aus_datei)}")
    print(f"davon heute vorhanden : {len(aus_datei) - len(fehlen)}")
    print(f"davon FEHLEND         : {len(fehlen)}")
    if not fehlen:
        print("Nichts zurückzuholen.")
        return 0

    beispiel = ", ".join(str(r.get("code") or r.get("id")) for r in fehlen[:8])
    print(f"Beispiele: {beispiel}{' …' if len(fehlen) > 8 else ''}")

    if not wirklich:
        print("\nNur angezeigt. Zum Einspielen dieselbe Zeile mit --wirklich.")
        return 0

    # An das heutige Schema anpassen (Spalten, die es nicht mehr gibt; NULL in
    # NOT-NULL) — dieselbe Funktion, die auch das volle Zurückspielen benutzt.
    tabelle = Exercise.__table__
    zeilen, hinweise = _passend_machen(tabelle, fehlen)
    for h in hinweise:
        print(f"  Hinweis: {h}")

    async with async_session() as db:
        for i in range(0, len(zeilen), 200):
            await db.execute(tabelle.insert(), zeilen[i:i + 200])
        await db.commit()
        # Postgres: die Sequenz nachziehen, sonst kollidiert die nächste
        # Neuanlage mit einer zurückgeholten id.
        if db.bind.dialect.name == "postgresql":
            from sqlalchemy import text
            await db.execute(text(
                "SELECT setval(pg_get_serial_sequence('exercises','id'), "
                "COALESCE((SELECT MAX(id) FROM exercises), 1))"
            ))
            await db.commit()

    print(f"\n{len(zeilen)} Aufgabe(n) zurückgeholt. Sie stehen wieder in ihren Lernleitern —")
    print("die merken sich Aufgaben über ihre id, und die ist dieselbe geblieben.")
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description="Gelöschte Lernpfad-Aufgaben aus einer Sicherung zurückholen.")
    p.add_argument("--liste", action="store_true", help="vorhandene Sicherungen anzeigen")
    p.add_argument("--datei", help="Dateiname der Sicherung (im Sicherungsordner) oder voller Pfad")
    p.add_argument("--konto", type=int, help="nur die Aufgaben dieses Kontos (users.id)")
    p.add_argument("--wirklich", action="store_true", help="wirklich einspielen (sonst nur anzeigen)")
    a = p.parse_args()

    if a.liste or not a.datei:
        namen = _sicherungen()
        if not namen:
            print(f"Keine Sicherungen in {BACKUP_DIR}.")
            return 1
        print(f"Sicherungen in {BACKUP_DIR} (neueste zuerst):")
        for n in namen:
            groesse = os.path.getsize(os.path.join(BACKUP_DIR, n)) / (1024 * 1024)
            print(f"  {n}   {groesse:.1f} MB")
        if not a.datei:
            print("\nWeiter mit: --datei <name> [--konto <id>]")
        return 0

    return asyncio.run(_lauf(a.datei, a.konto, a.wirklich))


if __name__ == "__main__":
    sys.exit(main())
