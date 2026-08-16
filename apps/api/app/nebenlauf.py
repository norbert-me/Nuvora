"""Gleichzeitige Schreiber: einmal zurueckrollen, neu lesen, neu rechnen.

Ein Blatt wie `zeit.py`: nur FastAPI und asyncio, kein Modell, kein Router.

Postgres serialisiert ueber die Zeilensperre (`SELECT … FOR UPDATE`) — dort
greift die Wiederholung praktisch nie. SQLite (Tests, lokale Pruefinstanz)
kennt keine Zeilensperre und bricht den zweiten Schreiber stattdessen ab; dann
wird zurueckgerollt, neu gelesen und neu gerechnet.

Die Schleife stand dreimal wortgleich da (`results.py`, `karten.py`,
`codedetektiv.py`), jedes Mal mit dem Vermerk „bewusst je Modul kopiert statt
geteilt: Module haengen nicht voneinander ab". Der Grund war richtig, die
Folgerung eine Nummer zu gross — genau wie bei `zeit.tagesbeginn`: verboten ist,
dass ein **Modul** am anderen haengt; am **Kern** haengen alle ohnehin. Die
Unterschiede zwischen den drei Kopien waren zwei Zahlen und ein Satz, also
Argumente: `versuche` und `meldung`.
"""
from __future__ import annotations

import asyncio
import random

from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError, OperationalError

ZU_VIEL_LOS = "Gerade zu viel los. Bitte gleich noch einmal versuchen."


async def mit_wiederholung(db, arbeit, versuche: int = 6, meldung: str = ZU_VIEL_LOS):
    """`arbeit()` so oft versuchen, bis sie durchkommt — sonst 503 `meldung`."""
    for versuch in range(versuche):
        try:
            return await arbeit()
        except (IntegrityError, OperationalError):
            await db.rollback()
            if versuch == versuche - 1:
                raise HTTPException(503, meldung)
            await asyncio.sleep(0.02 * (versuch + 1) + random.random() * 0.03)
    # Erreichbar nur bei versuche <= 0. Ohne diese Zeile kaeme dort ein stilles
    # None heraus, mit dem der Aufrufer weiterrechnet.
    raise HTTPException(503, meldung)
