"""Optimistisches Sperren: eine Zeile zaehlt, wie oft sie geaendert wurde.

Wozu. Die Desktop-App arbeitet offline weiter (Outbox in `core/outbox.js`) und
spielt ihre Aenderungen spaeter nach. Ohne einen Zaehler heisst „nachspielen"
schlicht ueberschreiben: was in der Zwischenzeit an demselben Datensatz passiert
ist — am Tablet, in der zweiten Sitzung, durch die Kollegin am selben Konto —
verschwindet stumm. Mit dem Zaehler sagt der Server „diese Zeile ist nicht mehr
die, die du gelesen hast" (409), und der Client entscheidet.

Drei Entscheidungen, die zusammengehoeren:

  (a) **Ein Zaehler, kein Zeitstempel als Schluessel.** Uhren gehen auseinander,
      und zwei Aenderungen in derselben Sekunde waeren nicht unterscheidbar.
      `geaendert_at` steht trotzdem daneben — nicht als Vergleich, sondern damit
      der Client die haeufigste Frage ohne Rueckfrage beantworten kann: „ist der
      Serverstand aelter als meine Offline-Aenderung?" Dann gewinnt seiner, und
      niemand wird gefragt.
  (b) **Ohne Kopfzeile keine Pruefung.** Wer `X-Nuvora-Version` nicht schickt
      (jede aeltere Oberflaeche, jeder Skriptaufruf, der Selbsttest), schreibt
      wie bisher. Eine Versionspflicht haette jeden Bestandsclient lahmgelegt,
      und das Ziel ist kein Sperrwerk, sondern eine Warnung im Ausnahmefall.
  (c) **`*` heisst „meine Fassung gilt".** Damit loest der Client den Konflikt
      auf, nachdem er entschieden hat (automatisch oder durch die Rueckfrage) —
      ohne zweiten Endpunkt und ohne dass „force" irgendwo dauerhaft steht.

Ein Blatt: importiert nur FastAPI und SQLAlchemy, keinen Router und nicht
`main`. Der Zaehler steigt an EINER Stelle (dem `before_flush`-Horcher unten),
nicht in jedem Endpunkt — vergessen wird ein Endpunkt sonst immer.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import DateTime, Integer, event, func
from sqlalchemy.orm import Mapped, Session, mapped_column

KOPF = "X-Nuvora-Version"


class Versioniert:
    """Mixin: `version` (zaehlt Aenderungen) und `geaendert_at` (wann zuletzt).

    Beide sind nullable, weil sie auf Bestandszeilen nachtraeglich entstehen
    (`_ensure_columns`) — `version or 1` ist deshalb die richtige Lesart, nicht
    `version`.
    """

    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1", nullable=False)
    geaendert_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=True
    )


def stand(obj) -> dict:
    """Was ein Client braucht, um einen Konflikt selbst zu entscheiden."""
    ga = getattr(obj, "geaendert_at", None)
    return {"version": getattr(obj, "version", None) or 1,
            "geaendert_at": ga.isoformat() if ga else None}


def basis(request: Optional[Request]) -> Optional[str]:
    """Die mitgeschickte Basisversion — oder None, wenn keine kam."""
    if request is None:
        return None
    roh = request.headers.get(KOPF)
    if roh is None:
        return None
    roh = roh.strip()
    return roh or None


def pruefe(request: Optional[Request], obj) -> None:
    """409, wenn die Zeile seit dem Lesen des Clients veraendert wurde.

    Ohne Kopfzeile passiert nichts (siehe (b) oben), bei `*` ebenfalls nicht
    (siehe (c)). Die Antwort traegt den aktuellen Stand mit: der Client fragt
    sonst gleich noch einmal nach, nur um ihn zu erfahren.
    """
    b = basis(request)
    if b is None or b == "*":
        return
    try:
        gelesen = int(b)
    except ValueError:
        return          # Unsinn in der Kopfzeile ist kein Grund, das Schreiben abzulehnen
    aktuell = getattr(obj, "version", None) or 1
    if gelesen == aktuell:
        return
    raise HTTPException(status_code=409, detail={"fehler": "konflikt", **stand(obj)})


# ─── Der Zaehler steigt von selbst ───
#
# Ein `before_flush`-Horcher auf der (synchronen) Session — die asynchrone
# Session fuehrt darunter genau diese. Er sieht jede geaenderte Zeile, egal aus
# welchem Router sie kommt; ein Hochzaehlen von Hand waere eine Zeile, die in
# jedem neuen Endpunkt fehlen kann.
@event.listens_for(Session, "before_flush")
def _hochzaehlen(session: Session, flush_context, instances) -> None:  # pragma: no cover - trivial
    for obj in session.dirty:
        if not hasattr(obj, "version"):
            continue
        if not session.is_modified(obj, include_collections=False):
            continue
        obj.version = (getattr(obj, "version", None) or 1) + 1
        if hasattr(obj, "geaendert_at"):
            obj.geaendert_at = datetime.now(timezone.utc)


class VersionOut(BaseModel):
    """Fuer Antwortmodelle: der Stand wandert mit hinaus.

    Ohne die zwei Felder im `response_model` schneidet FastAPI sie wieder weg —
    und der Client haette nichts, was er beim naechsten Schreiben mitschicken
    koennte.
    """

    version: int = 1
    # Als Zeitpunkt und nicht als Text: die Antwortmodelle lesen ihn oft direkt
    # aus der ORM-Zeile (`from_attributes`), und dort steht ein datetime.
    geaendert_at: Optional[datetime] = None
