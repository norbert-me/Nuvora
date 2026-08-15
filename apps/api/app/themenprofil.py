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

**Karteikarten sind die dritte Quelle** (Modul „Karten", Regel 3: je Quelle wird
`is_active` geprüft — ohne das Modul rechnet alles wie bisher). Ein Stapel trägt
optional ein Thema; der Lernstand seiner Karten sagt, wie sicher das Kind das
Thema abruft. Drei Dinge dabei:

- **Ein Versuch ist ein Punkt.** Damit fügt sich die Quelle in dieselbe Rechnung
  wie Arbeit und Quiz: `Treffer = reps`, `Versuche = reps + lapses`. Genau so
  und nicht anders — SM-2 setzt `reps` bei einem Fehler auf 0 zurück und zählt
  `lapses` hoch. Wer nach `reps > 0` filtert, wirft die schwachen Karten weg und
  sieht am Ende nur die, die sitzen (`reps=0, lapses=3` ist eine dreimal
  verpatzte Karte, nicht „keine Daten").
- **Karten stehen nicht im Verlauf.** Sie sind ein aufgelaufener Zustand ohne
  Datum, keine Erhebung. Sie erhöhen den Gesamtstand, tauchen aber weder in der
  Zeitleiste noch im Trend auf — sonst wäre die Zeitachse eine Behauptung.
- **Wenige Karten sagen wenig** (siehe `MINDEST_KARTEN`).
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
# Ab so vielen Karten MIT Versuchen zählt der Kartenstand in die Zahl mit.
# Warum eine eigene Schwelle neben MINDEST_PUNKTE: Versuche sammeln sich am
# selben Kärtchen. Sechs Versuche auf einer einzigen Karte sind sechs Punkte und
# trotzdem keine Aussage über ein Thema — geprüft wurde eine Vokabel, nicht der
# Stoff. Drei Karten sind das Wenigste, bei dem der Stand nicht an einem
# Einzelfall hängt; darunter wird nichts gerechnet, „fällig" aber trotzdem
# gezeigt (das ist eine Zählung, keine Bewertung).
MINDEST_KARTEN = 3


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


@dataclass
class KartenStand:
    """Der aufgelaufene Kartenstand EINES Kindes zu EINEM Thema.

    `treffer`/`versuche` kommen aus SM-2 (`reps` bzw. `reps + lapses`),
    `karten` ist die Zahl der Karten, an denen überhaupt schon einmal gearbeitet
    wurde, `faellig` die Zahl der heute anstehenden Karten dieses Themas. Was
    das Kind wegen E/G nie zu sehen bekommt, steht hier gar nicht erst drin —
    gefiltert wird an der Quelle (`karten.themen_lernstand`).
    """
    treffer: float = 0.0
    versuche: float = 0.0
    karten: int = 0
    faellig: int = 0

    @property
    def zaehlt(self) -> bool:
        """Genug Karten, um in den Gesamtstand einzugehen?"""
        return self.karten >= MINDEST_KARTEN and self.versuche > 0


def _pct(erreicht: float, moeglich: float) -> Optional[float]:
    return round(erreicht / moeglich * 100, 1) if moeglich else None


def _leer() -> dict:
    return {"erreicht": 0.0, "moeglich": 0.0, "verlauf": [], "karten": None}


def profil(erhebungen: list[Erhebung],
           karten: Optional[dict[int, KartenStand]] = None) -> list[dict]:
    """Je Thema: Gesamtstand, Verlauf, Trend — sortiert, schwächstes zuerst.

    `karten` ist der Kartenstand je Thema (Modul „Karten"); ohne ihn rechnet
    alles wie vorher. Ein Thema, das es NUR in den Karten gibt, kommt trotzdem
    vor — auch wenn dazu (noch) keine Zahl herauskommt: „4 fällig, zu wenig für
    eine Aussage" ist die ehrliche Auskunft, eine fehlende Zeile wäre keine.
    """
    nach_zeit = sorted(erhebungen, key=lambda e: e.datum)

    themen: dict[int, dict] = {}
    for e in nach_zeit:
        for m in e.messungen:
            if not m.topic_id or not m.moeglich:
                continue
            eintrag = themen.setdefault(m.topic_id, _leer())
            eintrag["erreicht"] += m.erreicht
            eintrag["moeglich"] += m.moeglich
            eintrag["verlauf"].append({
                "id": e.id, "name": e.name, "art": e.art,
                "datum": e.datum.isoformat(),
                "pct": _pct(m.erreicht, m.moeglich),
                "punkte": round(m.erreicht, 2), "max": round(m.moeglich, 2),
            })

    # Karten dazu: sie erhoehen erreicht/moeglich (ein Versuch = ein Punkt),
    # stehen aber nicht im Verlauf — sie haben kein Datum, nur einen Stand.
    for topic_id, k in (karten or {}).items():
        if not topic_id:
            continue
        eintrag = themen.setdefault(topic_id, _leer())
        eintrag["karten"] = k
        if k.zaehlt:
            eintrag["erreicht"] += k.treffer
            eintrag["moeglich"] += k.versuche

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

        k: Optional[KartenStand] = d["karten"]
        # Woraus die Zahl entstand — die Ausgabe nennt immer ihre Herkunft.
        quellen = sorted({p["art"] for p in verlauf})
        if k is not None and k.zaehlt:
            quellen.append("karten")

        aus.append({
            "topic_id": topic_id,
            "pct": _pct(d["erreicht"], d["moeglich"]) if genug else None,
            "punkte": round(d["erreicht"], 2),
            "max": round(d["moeglich"], 2),
            "erhebungen": len(verlauf),
            "genug": genug,
            "trend": trend,
            "quellen": quellen,
            # Karten: die Zahlen immer mitgeben, auch wenn sie (noch) nicht
            # zaehlen — „12 faellig" ist eine Zaehlung und keine Bewertung.
            "faellig": k.faellig if k else 0,
            "karten": ({"treffer": round(k.treffer, 2), "versuche": round(k.versuche, 2),
                        "karten": k.karten, "zaehlt": k.zaehlt} if k else None),
            "verlauf": verlauf,
        })

    # Schwächstes zuerst; was zu dünn ist, ans Ende — dort ist nichts zu tun,
    # außer beim nächsten Mal mehr Aufgaben zu dem Thema zu stellen.
    aus.sort(key=lambda x: (not x["genug"], x["pct"] if x["pct"] is not None else 999))
    return aus
