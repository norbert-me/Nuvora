"""Bewertung einer CardVote-Session — eine Quelle für die Regeln.

Dieselben Regeln liegen im Frontend in `apps/web/src/core/scoring.js`; wer hier
etwas ändert, ändert es dort mit. Zwei Fassungen, weil die Auswertungsseite die
Gewichte live beim Tippen neu rechnet, die PDF-/Noten-Wege aber am Server
entstehen.

Die Regeln:

* **E/G-Differenzierung** (Quiz-Flag): alle sehen dieselben Fragen. Für ein Kind
  im G-Kurs zählen nur die G-Fragen als 100 %; richtige E-Fragen geben Bonus
  obendrauf — anteilig ab der ERSTEN richtigen, geteilt durch die Zahl der
  E-Fragen (mindestens aber durch zwei, damit ein einzelner Zufallstreffer nie
  eine volle Notenstufe hebt), und höchstens um eine Notenstufe. Falsche E-Antworten zehren nur den Bonus auf
  (bis 0), nie die Basispunkte. Für ein Kind im E-Kurs zählen alle Fragen
  regulär.
* **Minuspunkte** (Quiz-Flag): eine falsche Antwort kostet ihr Gewicht, die
  Punktzahl fällt nie unter 0. Wer die Karte unten lässt, antwortet nicht:
  0 Punkte, kein Abzug.
* **Bei dem Thema gefehlt** (je Kind und Session gesetzt): Fragen zu einem
  Thema, das das Kind verpasst hat, zaehlen NICHT zur Basis — es kann nichts
  wissen, was es nie hatte. Richtige Antworten darauf geben Bonus wie eine
  E-Frage, und Minuspunkte greifen dort nie. Beides landet in einem Topf: der
  Bonus ist zusammen auf hoechstens eine Notenstufe gedeckelt, sonst waere
  „hat gefehlt" ein Weg zu einer besseren Note als bei voller Anwesenheit.
  Sind ALLE Fragen betroffen, gaebe es keine Basis mehr, an der ein Bonus
  haengen koennte — dann zaehlen sie regulaer (eine Wertung aus lauter Bonus
  waere keine).
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


def note_aus_pct(pct: float, scale: Optional[dict] = None) -> float:
    """Prozent -> Note, identisch zur Frontend-Skala (core/grades.js).

    Stand vorher in noten.py und wurde von dort aus benutzt; seit der Themenstand
    dieselbe Umrechnung braucht, gehoert sie hierher — zwei Fassungen derselben
    Notenrechnung liefen unweigerlich auseinander, und dann stuende dieselbe
    Leistung je nach Weg als andere Note da.

    Kaufmaennisch gerundet wie im Frontend (Math.round): Pythons round() rundet
    die halbe Stelle zur geraden Zahl, 83,5 % ergaebe 2,2 statt 2,3.
    """
    try:
        s = {int(k): float(v) for k, v in (scale or {}).items()}
        s = {g: s[g] for g in (1, 2, 3, 4, 5, 6)}   # vollstaendig+lesbar? sonst Default
    except (ValueError, TypeError, KeyError):
        s = {int(k): float(v) for k, v in DEFAULT_SCALE.items()}
    ranges = [(1, s[1], 100), (2, s[2], s[1]), (3, s[3], s[2]), (4, s[4], s[3]), (5, s[5], s[4])]
    for grade, lower, upper in ranges:
        if pct >= lower:
            span = upper - lower
            if span <= 0:
                return float(grade)
            return kaufmaennisch(grade + (upper - pct) / span, 1)
    return 6.0


def note_mit_tendenz(pct: float, scale: Optional[dict] = None) -> str:
    """Prozent -> Note mit Tendenz („3+", „4-"), Spiegel von gradeDetailed in
    core/grades.js: im Band oberes Drittel „+", unteres „-"; kein „1-", kein 6+/-."""
    try:
        s = {int(k): float(v) for k, v in (scale or {}).items()}
        s = {g: s[g] for g in (1, 2, 3, 4, 5, 6)}
    except (ValueError, TypeError, KeyError):
        s = {int(k): float(v) for k, v in DEFAULT_SCALE.items()}
    for grade, lower, upper in [(1, s[1], 100), (2, s[2], s[1]), (3, s[3], s[2]), (4, s[4], s[3]), (5, s[5], s[4])]:
        if pct >= lower:
            span = upper - lower
            pos = (pct - lower) / span if span > 0 else 1
            suffix = "+" if pos >= 2 / 3 else "-" if pos < 1 / 3 else ""
            return str(grade) if grade == 1 else f"{grade}{suffix}"
    return "6"


def note_label(wert: float) -> str:
    """Notenwert (2,3 / 2,7 …) -> „2+" / „3-"; kein „1-", kein „6+/-"."""
    g = min(6, max(1, int(round(wert))))
    if g in (1, 6):
        return str(g)
    d = wert - g
    return f"{g}+" if d <= -0.15 else f"{g}-" if d >= 0.15 else str(g)


def noten_trend(werte) -> Optional[int]:
    """Besser (1), schlechter (-1), gleich (0) oder None (unter zwei Noten).
    Spiegel von core/notentrend.js: erste gegen zweite Haelfte, ab 0,3."""
    w = [float(v) for v in (werte or []) if v is not None]
    if len(w) < 2:
        return None
    h = len(w) // 2
    diff = sum(w[-h:]) / h - sum(w[:h]) / h
    return 1 if diff <= -0.3 else -1 if diff >= 0.3 else 0


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


def e_modus_von(config: Optional[dict]) -> str:
    """Wie zaehlen Anforderungsfragen fuer ein G-Kind? (aus eval_config)

    "bonus" (Vorgabe) | "ausgleich" | "keine" | "alle" — die Entscheidung gehoert der
    einzelnen Auswertung, nicht dem Quiz: dasselbe Quiz kann einmal als
    Lernstand und einmal als Leistung gewertet werden. Unbekanntes und
    Fehlendes gilt als "bonus", damit Bestandsauswertungen sich nicht aendern.
    """
    wert = (config or {}).get("e_modus")
    return wert if wert in ("bonus", "ausgleich", "keine", "alle") else "bonus"


STANDARD_BONUS = {"max_stufen": 1.0, "mindest_nenner": 2, "falsch_zehrt": True}


def bonus_regel_von(config: Optional[dict]) -> dict:
    """Wie rechnet der Anforderungs-Bonus? (aus eval_config["bonus_regel"])

    max_stufen:     hoechstens so viele Notenstufen Bonus insgesamt (0 … 3)
    mindest_nenner: der Bonus ist richtig/max(Zahl der E-Fragen, n) einer Stufe —
                    bei n = 2 gibt eine einzige E-Frage hoechstens eine halbe Stufe
    falsch_zehrt:   falsche E-Antworten zehren den Bonus auf (nie die G-Punkte)

    Fehlendes und Unlesbares gilt als Vorgabe, damit Bestandsauswertungen sich
    nicht aendern. Steht doppelt in core/scoring.js.
    """
    roh = (config or {}).get("bonus_regel")
    out = dict(STANDARD_BONUS)
    if not isinstance(roh, dict):
        return out
    try:
        out["max_stufen"] = min(3.0, max(0.0, float(roh.get("max_stufen", 1.0))))
    except (TypeError, ValueError):
        pass
    try:
        out["mindest_nenner"] = min(5, max(1, int(roh.get("mindest_nenner", 2))))
    except (TypeError, ValueError):
        pass
    if isinstance(roh.get("falsch_zehrt"), bool):
        out["falsch_zehrt"] = roh["falsch_zehrt"]
    return out


def gefehlt_von(card_id, config: Optional[dict]):
    """Themen, bei denen dieses Kind gefehlt hat (aus eval_config).

    `eval_config["gefehlt"]` ist {card_id: [topic_id, ...]} — dieselbe Ablage
    und derselbe Schluessel wie bei krank/anwesend, damit die Auswertung eine
    Stelle behaelt, an der die Ausnahmen eines Kindes stehen.
    """
    roh = ((config or {}).get("gefehlt") or {})
    if not isinstance(roh, dict):
        return []
    werte = roh.get(str(card_id), roh.get(card_id)) or []
    if not isinstance(werte, (list, tuple, set)):
        return []
    out = []
    for x in werte:
        try:
            out.append(int(x))
        except (TypeError, ValueError):
            continue
    return out


def bewerte(questions, answers, *, niveau: str = "", niveau_aktiv: bool = False, e_modus: str = "bonus",
            minuspunkte: bool = False, weights: Optional[dict] = None,
            scale: Optional[dict] = None, gefehlt_topics=None, regel: Optional[dict] = None) -> dict:
    """Punkte und Prozent für ein Kind.

    questions: [{"id", "correct_answer", "niveau", "topic_id"}] — "niveau" ist "E" oder "".
    answers:   {question_id: "A"|None}
    niveau:    Kursniveau des Kindes ("E" | "G" | "")
    gefehlt_topics: Themen, bei denen dieses Kind gefehlt hat (topic_ids)
    """
    regel = {**STANDARD_BONUS, **(regel or {})}
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
    # Wie zaehlen die Anforderungsfragen fuer ein Kind im G-Kurs?
    #
    #   "bonus" (Vorgabe) – sie stehen neben der Wertung und geben Bonus.
    #   "ausgleich"       – richtige Anforderungsfragen GLEICHEN verpasste Grund-
    #                       fragen aus (5 von 6 + beide E richtig = 6 von 6), nie
    #                       ueber 100 %. Fuer „E-Fragen sind die Reserve fuer einen
    #                       Fehler" statt „E-Fragen heben um eine Notenstufe".
    #   "keine"           – sie stehen daneben, geben aber NICHTS. Fuer eine
    #                       Arbeit, in der die Anforderung erkennbar Zusatz ist
    #                       und die Note allein aus der Grundlage kommt.
    #   "alle"            – keine Unterscheidung: alle rechnen alles, wie ohne
    #                       den Schalter am Quiz.
    #
    # Die Entscheidung gehoert der einzelnen Auswertung (eval_config), nicht dem
    # Quiz: dasselbe Quiz kann einmal als Lernstand und einmal als Leistung
    # gewertet werden. Sie gilt nur fuer E/G — ein verpasstes Thema gibt weiter
    # Bonus, das ist ein anderer Sachverhalt.
    modus = e_modus if e_modus in ("bonus", "ausgleich", "keine", "alle") else "bonus"
    differenziert = bool(niveau_aktiv) and niveau != "E" and modus != "alle"
    fehlt = {int(x) for x in (gefehlt_topics or []) if str(x).lstrip("-").isdigit()}

    def verpasst(q):
        tid = q.get("topic_id")
        return bool(fehlt) and tid is not None and int(tid) in fehlt

    def ist_extra(q):
        return verpasst(q) or (differenziert and (q.get("niveau") or "") == "E")

    basis = [q for q in zaehlend if not ist_extra(q)]
    extra = [q for q in zaehlend if ist_extra(q)]
    # Keine Basis mehr, weil ein verpasstes Thema alles herausgenommen hat: dann
    # haengt der Bonus an nichts. Die verpassten Fragen zaehlen dann regulaer.
    # (Der reine E/G-Fall — ein G-Kind ohne eine einzige G-Frage — bleibt davon
    # unberuehrt: dort ist „keine Basis" seit jeher gewollt.)
    if not basis and any(verpasst(q) for q in extra):
        basis = [q for q in extra if verpasst(q)]
        extra = [q for q in extra if not verpasst(q)]

    base_max = sum(gewicht(q["id"]) for q in basis)
    score = sum(gewicht(q["id"]) for q in basis if richtig(q))
    if minuspunkte:
        score -= sum(gewicht(q["id"]) for q in basis if beantwortet(q) and not richtig(q))
    score = max(0.0, score)
    base_pct = (score / base_max * 100) if base_max > 0 else 0.0

    # Bei „keine" zaehlen nur die verpassten Themen zum Bonus, nicht die
    # E-Fragen — sie bleiben trotzdem aus der Basis heraus, denn gemessen wird
    # ein G-Kind an den G-Fragen.
    bonus_fragen = [q for q in extra if verpasst(q)] if modus == "keine" else extra
    e_richtig = sum(1 for q in bonus_fragen if richtig(q))
    e_falsch = sum(1 for q in bonus_fragen if beantwortet(q) and not richtig(q))
    bonus_pct = 0.0
    # SCHON EINE richtige Anforderungsfrage zaehlt — anteilig.
    #
    # Vorher lag hier eine harte Schwelle bei zwei richtigen. Sie sollte den
    # Zufallstreffer abfangen (eine A-D-Frage ist zu einem Viertel geraten),
    # erzeugte aber eine Klippe: wer eine von zwei E-Fragen konnte, bekam
    # denselben Bonus wie jemand, der keine konnte — naemlich keinen. Und bei
    # Quizzen mit nur einer einzigen E-Frage war der Bonus gar nicht erreichbar,
    # der Schalter also wirkungslos.
    #
    # Statt einer Schwelle ein Nenner-Mindestwert: geteilt wird durch die Zahl
    # der Anforderungsfragen, mindestens aber durch ZWEI. Damit gilt weiterhin
    # „eine einzelne richtige Antwort hebt nie um eine volle Notenstufe" (der
    # Ratefall), aber sie zaehlt: eine von einer ergibt eine halbe Stufe, eine
    # von fuenf ein Fuenftel. Falsche Antworten zehren den Bonus wie bisher auf.
    netto = max(0, e_richtig - e_falsch) if regel["falsch_zehrt"] else e_richtig
    if modus == "ausgleich":
        # Die Punkte richtiger Anforderungsfragen fuellen die Luecke der Basis auf.
        # Falsche zehren (wie beim Bonus) nur diesen Ausgleich auf, nie die
        # Grundpunkte; mehr als die Luecke gibt es nicht.
        e_punkte = sum(gewicht(q["id"]) for q in bonus_fragen if richtig(q))
        if regel["falsch_zehrt"]:
            e_punkte -= sum(gewicht(q["id"]) for q in bonus_fragen if beantwortet(q) and not richtig(q))
        ausgleich = min(max(0.0, base_max - score), max(0.0, e_punkte))
        bonus_pct = ausgleich / base_max * 100 if base_max > 0 else 0.0
    elif bonus_fragen and netto >= 1:
        anteil = min(1.0, netto / max(len(bonus_fragen), regel["mindest_nenner"]))
        bonus_pct = anteil * regel["max_stufen"] * naechste_stufe(base_pct, scale)

    return {
        "score": kaufmaennisch(score, 2),
        "max_score": kaufmaennisch(base_max, 2),
        "base_pct": kaufmaennisch(base_pct, 1),
        "bonus_pct": kaufmaennisch(bonus_pct, 1),
        "pct": kaufmaennisch(min(100.0, base_pct + bonus_pct), 1),
        "e_correct": e_richtig,
        "e_wrong": e_falsch,
        "e_total": len(extra),
        # Wie viele der Bonus-Fragen aus einem verpassten Thema stammen — die
        # Auswertung sagt sonst „E-Bonus", wo gar keine E-Frage im Spiel war.
        "gefehlt_total": sum(1 for q in extra if verpasst(q)),
    }


def konfig_mit_vorgaben(config: Optional[dict], user=None) -> dict:
    """Die Einstellungen einer Auswertung MIT den Vorgaben des Profils.

    Die Auswertungsseite faellt ohne eigene Angabe auf das Profil zurueck (Notenschluessel,
    Bonusregel). Rechneten die uebrigen Wege (Zugang der Kinder, PDF, Excel, Notenbuch)
    ohne diesen Rueckgriff, bekam dasselbe Kind dort eine andere Note als in der
    Auswertung — sobald das Profil von der eingebauten Vorgabe abwich. Eine Quelle:
    alle Leser holen die Einstellungen hierueber."""
    out = dict(config or {})
    skala = getattr(user, "grade_scale", None)
    if not out.get("grade_scale") and isinstance(skala, dict) and skala:
        out["grade_scale"] = skala
    ansichten = getattr(user, "ansichten", None) or {}
    bonus = ansichten.get("bonus_regel") if isinstance(ansichten, dict) else None
    if not isinstance(out.get("bonus_regel"), dict) and isinstance(bonus, dict):
        out["bonus_regel"] = bonus
    return out
