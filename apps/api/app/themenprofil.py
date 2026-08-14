"""Themenstand je Kind: Wie sicher sitzt ein (Unter-)Thema — und wird es besser?

Die Idee der Lehrkraft: „Ich schreibe eine Arbeit über mehrere Unterthemen, also
müsste ich aus den Aufgaben ablesen können, wie gut ein Kind jedes Unterthema
kann." Genau das rechnet dieses Modul — aus Klassenarbeiten und CardVote-Quizzen
zusammen, weil beide dieselben Themen prüfen.

Drei Dinge, die dabei leicht schiefgehen, und wie sie hier gelöst sind:

1. **Punkte verschiedener Erhebungen sind nicht gleich viel wert.** Deshalb wird
   nicht „Punkte addiert", sondern der Anteil erreichter an möglichen Punkten
   gebildet — eine Aufgabe zu 8 Punkten wiegt damit achtmal so schwer wie eine
   zu einem, und das ist richtig so: sie prüft auch mehr.

2. **Wenig Punkte sagen wenig.** Ein Thema mit drei Punkten aus einer einzigen
   Arbeit ist keine Aussage über Können. Unterhalb von `MINDEST_PUNKTE` steht
   deshalb „zu wenig Daten" — nicht eine Zahl, die nach Wissen aussieht.

3. **Eine Note je Thema ist keine Note.** Der Notenschlüssel gilt für die ganze
   Arbeit, nicht für drei Aufgaben daraus; und Zeugnisnoten sind eine
   pädagogische Entscheidung (siehe CLAUDE.md). Dieses Modul liefert Prozent und
   einen Trend. Wer eine Note daraus machen will, bekommt sie in der Oberfläche
   ausdrücklich als *Orientierung* angezeigt — gerechnet mit derselben Funktion
   wie im Notenbuch (`scoring.note_aus_pct`) und nur, wenn genug Punkte
   dahinterstehen.

Der Trend beantwortet die eigentliche Frage („wird es besser?"): verglichen wird
die erste Hälfte der Erhebungen zu diesem Thema mit der zweiten. Zwei Messpunkte
sind das Minimum, unter drei bleibt es beim Hinweis „noch kein Verlauf".
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional

# Ab so vielen möglichen Punkten lohnt eine Aussage über ein Thema.
MINDEST_PUNKTE = 6.0
# Ab so vielen Prozentpunkten Unterschied heißt es „besser"/„schlechter" —
# darunter ist es Rauschen zwischen zwei Arbeiten.
TREND_PP = 10.0


@dataclass
class Messung:
    """Ein Thema in einer Erhebung: erreichte und mögliche Punkte eines Kindes."""
    topic_id: int
    erreicht: float
    moeglich: float


@dataclass
class Erhebung:
    """Eine Klassenarbeit oder ein Quiz — mit den Messungen EINES Kindes."""
    id: int
    name: str
    datum: datetime
    art: str = "arbeit"          # "arbeit" | "quiz"
    messungen: list[Messung] = field(default_factory=list)


def _pct(erreicht: float, moeglich: float) -> Optional[float]:
    return round(erreicht / moeglich * 100, 1) if moeglich else None


def profil(erhebungen: list[Erhebung]) -> list[dict]:
    """Je Thema: Gesamtstand, Verlauf, Trend — sortiert, schwächstes zuerst."""
    nach_zeit = sorted(erhebungen, key=lambda e: e.datum)

    themen: dict[int, dict] = {}
    for e in nach_zeit:
        for m in e.messungen:
            if not m.topic_id or not m.moeglich:
                continue
            eintrag = themen.setdefault(m.topic_id, {"erreicht": 0.0, "moeglich": 0.0, "verlauf": []})
            eintrag["erreicht"] += m.erreicht
            eintrag["moeglich"] += m.moeglich
            eintrag["verlauf"].append({
                "id": e.id, "name": e.name, "art": e.art,
                "datum": e.datum.isoformat(),
                "pct": _pct(m.erreicht, m.moeglich),
                "punkte": round(m.erreicht, 2), "max": round(m.moeglich, 2),
            })

    aus = []
    for topic_id, d in themen.items():
        verlauf = d["verlauf"]
        werte = [p["pct"] for p in verlauf if p["pct"] is not None]
        genug = d["moeglich"] >= MINDEST_PUNKTE

        # Trend: erste gegen zweite Hälfte der Erhebungen zu diesem Thema.
        # Bewusst nicht „letzte gegen vorletzte": eine einzelne schwache Arbeit
        # ist kein Abstieg, und genau diesen Fehlschluss soll die Anzeige nicht
        # nahelegen.
        trend = None
        if len(werte) >= 3:
            h = len(werte) // 2
            delta = round(sum(werte[h:]) / len(werte[h:]) - sum(werte[:h]) / h, 1)
            if delta >= TREND_PP:
                trend = {"richtung": "auf", "delta": delta}
            elif delta <= -TREND_PP:
                trend = {"richtung": "ab", "delta": delta}
            else:
                trend = {"richtung": "gleich", "delta": delta}

        aus.append({
            "topic_id": topic_id,
            "pct": _pct(d["erreicht"], d["moeglich"]) if genug else None,
            "punkte": round(d["erreicht"], 2),
            "max": round(d["moeglich"], 2),
            "erhebungen": len(verlauf),
            "genug": genug,
            "trend": trend,
            "verlauf": verlauf,
        })

    # Schwächstes zuerst; was zu dünn ist, ans Ende — dort ist nichts zu tun,
    # außer beim nächsten Mal mehr Aufgaben zu dem Thema zu stellen.
    aus.sort(key=lambda x: (not x["genug"], x["pct"] if x["pct"] is not None else 999))
    return aus
