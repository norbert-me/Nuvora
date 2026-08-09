"""Bewertung einer CardVote-Session — eine Quelle für die Regeln.

Dieselben Regeln liegen im Frontend in `apps/web/src/core/scoring.js`; wer hier
etwas ändert, ändert es dort mit. Zwei Fassungen, weil die Auswertungsseite die
Gewichte live beim Tippen neu rechnet, die PDF-/Noten-Wege aber am Server
entstehen.

Die Regeln:

* **E/G-Differenzierung** (Quiz-Flag): alle sehen dieselben Fragen. Für ein Kind
  im G-Kurs zählen nur die G-Fragen als 100 %; richtige E-Fragen geben Bonus
  obendrauf. Der Bonus greift erst ab zwei richtigen E-Antworten und hebt
  höchstens um eine Notenstufe. Falsche E-Antworten zehren nur den Bonus auf
  (bis 0), nie die Basispunkte. Für ein Kind im E-Kurs zählen alle Fragen
  regulär.
* **Minuspunkte** (Quiz-Flag): eine falsche Antwort kostet ihr Gewicht, die
  Punktzahl fällt nie unter 0. Wer die Karte unten lässt, antwortet nicht:
  0 Punkte, kein Abzug.
* **Keine Abgabe**: wer gar nichts abgegeben hat, gilt als krank und bleibt aus
  der Wertung — die Lehrkraft kann ihn auf „anwesend" stellen, dann zählt seine
  0 überall mit (siehe status_of).
"""
import math
from typing import Optional

DEFAULT_SCALE = {1: 87, 2: 73, 3: 59, 4: 45, 5: 20, 6: 0}


def kaufmaennisch(x: float, stellen: int) -> float:
    """Kaufmaennisch runden (die halbe Stelle geht nach oben) — wie Math.round
    im Frontend. Pythons round() rundet die halbe Stelle zur geraden Zahl
    ("Bankers Rounding"): 66,25 % wuerde hier 66,2 und dort 66,3 ergeben, und
    dieselbe Arbeit stuende im PDF anders als auf dem Bildschirm."""
    f = 10 ** stellen
    return math.floor(x * f + 0.5) / f


def naechste_stufe(pct: float, scale: dict) -> float:
    """Prozentpunkte bis zur nächstbesseren Notenstufe — der Deckel des Bonus."""
    s = {int(k): v for k, v in (scale or DEFAULT_SCALE).items()}
    grenzen = sorted((v for v in s.values() if v > pct))
    if not grenzen:
        return max(0.0, 100.0 - pct)   # schon in der besten Stufe: bis 100 %
    return max(0.0, grenzen[0] - pct)


def status_of(card_id: int, has_any_scan: bool, config: Optional[dict]) -> str:
    """"anwesend" oder "krank". Ohne jede Antwort gilt krank — es sei denn, die
    Lehrkraft hat das Kind ausdrücklich auf anwesend gestellt (dann zählt die 0)."""
    cfg = config or {}
    krank = {str(x) for x in (cfg.get("krank") or [])}
    anwesend = {str(x) for x in (cfg.get("anwesend") or [])}
    key = str(card_id)
    if key in anwesend:
        return "anwesend"
    if key in krank:
        return "krank"
    return "anwesend" if has_any_scan else "krank"


def bewerte(questions, answers, *, niveau: str = "", niveau_aktiv: bool = False,
            minuspunkte: bool = False, weights: Optional[dict] = None,
            scale: Optional[dict] = None) -> dict:
    """Punkte und Prozent für ein Kind.

    questions: [{"id", "correct_answer", "niveau"}] — "niveau" ist "E" oder "".
    answers:   {question_id: "A"|None}
    niveau:    Kursniveau des Kindes ("E" | "G" | "")
    """
    w = weights or {}
    scale = {int(k): v for k, v in (scale or DEFAULT_SCALE).items()}

    def gewicht(qid) -> float:
        """Gewicht einer Frage. Fehlt es (oder ist es null), gilt 1 — wie im
        Frontend. Unlesbares (Tippfehler in der Konfiguration) gilt als 0 und
        darf die Wertung nicht mit einem Fehler abbrechen."""
        v = w.get(str(qid), w.get(qid))
        if v is None:
            v = 1
        try:
            v = float(v)
        except (TypeError, ValueError):
            return 0.0
        return 0.0 if math.isnan(v) else v

    def beantwortet(q):
        return answers.get(q["id"]) or answers.get(str(q["id"]))

    def richtig(q):
        a = beantwortet(q)
        c = q.get("correct_answer")
        return bool(a and c and a in c)

    zaehlend = [q for q in questions if q.get("correct_answer")]
    # Ohne E/G-Flag oder für ein Kind im E-Kurs zählt alles regulär.
    differenziert = bool(niveau_aktiv) and niveau != "E"
    basis = [q for q in zaehlend if not differenziert or (q.get("niveau") or "") != "E"]
    extra = [q for q in zaehlend if differenziert and (q.get("niveau") or "") == "E"]

    base_max = sum(gewicht(q["id"]) for q in basis)
    score = sum(gewicht(q["id"]) for q in basis if richtig(q))
    if minuspunkte:
        score -= sum(gewicht(q["id"]) for q in basis if beantwortet(q) and not richtig(q))
    score = max(0.0, score)
    base_pct = (score / base_max * 100) if base_max > 0 else 0.0

    e_richtig = sum(1 for q in extra if richtig(q))
    e_falsch = sum(1 for q in extra if beantwortet(q) and not richtig(q))
    bonus_pct = 0.0
    if extra and e_richtig >= 2:
        netto = max(0, e_richtig - e_falsch)
        anteil = netto / len(extra)
        bonus_pct = anteil * naechste_stufe(base_pct, scale)

    return {
        "score": kaufmaennisch(score, 2),
        "max_score": kaufmaennisch(base_max, 2),
        "base_pct": kaufmaennisch(base_pct, 1),
        "bonus_pct": kaufmaennisch(bonus_pct, 1),
        "pct": kaufmaennisch(min(100.0, base_pct + bonus_pct), 1),
        "e_correct": e_richtig,
        "e_wrong": e_falsch,
        "e_total": len(extra),
    }
