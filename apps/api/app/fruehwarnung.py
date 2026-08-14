"""Frühwarnung: wer hängt über mehrere Tests hinweg systematisch hinterher?

Die Idee in einem Satz: **nicht die Quote zählt, sondern der Abstand zur
Klasse — und zwar über mehrere Tests.**

Warum nicht die Quote: „45 % richtig" sagt nichts. War der Test schwer, sind
alle unten; war er leicht, sagen 70 % nichts Gutes. Alle Kinder sehen dieselben
Fragen, also ist der Abstand zum Klassenmittel desselben Tests das saubere Maß.
Ein schwerer Test drückt Kind und Mittel gleichermaßen — der Abstand bleibt.

Warum mehrere Tests: ein schlechter Tag ist kein Befund. Gemeldet wird erst,
was sich wiederholt.

**Voraussetzungen müssen nicht gepflegt werden.** Die Frage „liegt es am
aktuellen Thema oder an Lücken von früher?" beantwortet die Zeitachse von
selbst: Nuvora weiß, wann ein Thema zum ersten Mal in einem Quiz dieser Klasse
vorkam. Fragen zu einem Thema, das vor Monaten dran war, sind Wiederholung —
also faktisch ein Vorwissenstest, ohne dass jemand einen Voraussetzungsbaum
anlegt.

Dieses Modul rechnet nur. Es kennt keine Datenbank und kein HTTP; die Router
sammeln die Daten ein und geben sie hier hinein. So ist die Regel an einer
Stelle nachlesbar und in `tests/test_fruehwarnung.py` nachrechenbar.

Was hier NICHT passiert: eine Diagnose. Das Ergebnis ist eine Beobachtung mit
Beleg („in 5 von 6 Tests 24 Prozentpunkte unter der Klasse"), keine Aussage
über eine Lernstörung. Die trifft niemand aus Trefferquoten.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from statistics import median
from typing import Optional


# ─── Stellschrauben ───
# Zwei Stufen statt eines Reglers je Klasse: ein fester Standard, damit
# Meldungen zwischen Klassen dasselbe bedeuten, plus eine empfindlichere Stufe
# fuer den Fall, dass die Lehrkraft frueher hinsehen will.
@dataclass(frozen=True)
class Schwellen:
    abstand: float          # Median-Abstand zur Klasse (Prozentpunkte), ab dem gemeldet wird
    abstand_einzeln: float  # je Test, fuer die "in X von Y Tests"-Bedingung
    von: int                # in wie vielen der letzten `bis` Tests
    bis: int
    mindest_antworten: int  # darunter: "zu wenig Daten", nicht "unauffaellig"
    fenster: int            # wie viele Tests zurueck gerechnet wird


STANDARD = Schwellen(abstand=20.0, abstand_einzeln=15.0, von=4, bis=5, mindest_antworten=12, fenster=6)
EMPFINDLICH = Schwellen(abstand=15.0, abstand_einzeln=10.0, von=3, bis=5, mindest_antworten=12, fenster=6)

# Ab wann gilt ein Thema als "Altbestand"? Frueher als das im Quiz, ist es
# frischer Stoff aus dem laufenden Unterricht.
FRISCH_TAGE = 21
# Trend: um so viele Prozentpunkte muss sich der Abstand zwischen erster und
# zweiter Haelfte des Fensters aendern, damit wir ihn benennen.
TREND_PP = 8.0
# Ab so vielen Antworten zu einem Thema lohnt die themenweise Aussage.
THEMA_MINDEST = 3
# Ab diesem Anteil fehlender Abgaben ist die Beteiligung der Befund, nicht die
# Leistung — sonst meldet die Frühwarnung ein Kind, das gar nicht da war.
FEHLT_ANTEIL = 1 / 3


@dataclass
class Antwort:
    """Eine gewertete Antwort eines Kindes auf eine Frage."""
    card_id: int
    topic_id: Optional[int]
    richtig: bool


@dataclass
class Test:
    """Eine Sitzung mit allen gewerteten Antworten.

    `abwesend` sind die Kinder, die nichts abgegeben haben (krank) — sie zaehlen
    weder als falsch noch ins Klassenmittel.
    """
    session_id: int
    name: str
    datum: datetime
    antworten: list[Antwort] = field(default_factory=list)
    abwesend: set[int] = field(default_factory=set)


def _quote(treffer: int, gesamt: int) -> Optional[float]:
    return round(treffer / gesamt * 100, 1) if gesamt else None


def erstvorkommen(tests: list[Test]) -> dict[int, datetime]:
    """Wann tauchte jedes Thema zum ersten Mal in einem Quiz dieser Klasse auf?

    Das ersetzt den Voraussetzungsbaum: was lange im Bestand ist, wird beim
    naechsten Vorkommen zur Wiederholung — und Wiederholungsfragen sind der
    Vorwissenstest, den niemand extra anlegen muss.
    """
    erst: dict[int, datetime] = {}
    for t in sorted(tests, key=lambda x: x.datum):
        for a in t.antworten:
            if a.topic_id and a.topic_id not in erst:
                erst[a.topic_id] = t.datum
    return erst


def analysiere(tests: list[Test], kinder: dict[int, str], schwellen: Schwellen = STANDARD) -> dict:
    """Auswertung ueber die letzten `schwellen.fenster` Tests.

    Rueckgabe je Kind: Kurve (Abstand je Test), Etiketten, Begruendungssatz und
    ein Status — `melden`, `unauffaellig` oder `zu_wenig_daten`.
    """
    fenster = sorted([t for t in tests if t.antworten], key=lambda t: t.datum)[-schwellen.fenster:]
    erst = erstvorkommen(tests)

    # Je Test: Trefferquote jedes Kindes und das Mittel der Anwesenden.
    je_test: list[dict] = []
    for t in fenster:
        pro_kind: dict[int, list[int]] = {}
        for a in t.antworten:
            z = pro_kind.setdefault(a.card_id, [0, 0])
            z[1] += 1
            if a.richtig:
                z[0] += 1
        quoten = {cid: _quote(tr, ges) for cid, (tr, ges) in pro_kind.items() if ges}
        mittel = round(sum(quoten.values()) / len(quoten), 1) if quoten else None
        je_test.append({"test": t, "quoten": quoten, "mittel": mittel,
                        "antworten": {cid: ges for cid, (_, ges) in pro_kind.items()}})

    ergebnis = []
    for cid, name in kinder.items():
        kurve = []
        abstaende: list[float] = []
        antworten_gesamt = 0
        fehlt = 0
        for eintrag in je_test:
            t, mittel = eintrag["test"], eintrag["mittel"]
            quote = eintrag["quoten"].get(cid)
            if quote is None or mittel is None:
                fehlt += 1
                kurve.append({"session_id": t.session_id, "name": t.name,
                              "datum": t.datum.isoformat(), "pct": None, "klasse": mittel, "abstand": None})
                continue
            d = round(quote - mittel, 1)
            abstaende.append(d)
            antworten_gesamt += eintrag["antworten"].get(cid, 0)
            kurve.append({"session_id": t.session_id, "name": t.name, "datum": t.datum.isoformat(),
                          "pct": quote, "klasse": mittel, "abstand": d})

        if antworten_gesamt < schwellen.mindest_antworten:
            # Bewusst kein "unauffaellig": bei vier A–D-Fragen trifft reines
            # Raten im Schnitt eine. Wer daraus Entwarnung liest, irrt sich.
            ergebnis.append({
                "card_id": cid, "name": name, "status": "zu_wenig_daten",
                "begruendung": f"Erst {antworten_gesamt} gewertete Antworten in den letzten "
                               f"{len(je_test)} Tests — zu wenig für eine Aussage.",
                "abstand_median": None, "kurve": kurve, "etiketten": [], "themen": [],
            })
            continue

        med = round(median(abstaende), 1)
        letzte = abstaende[-schwellen.bis:]
        unter = sum(1 for d in letzte if d <= -schwellen.abstand_einzeln)
        melden = med <= -schwellen.abstand and unter >= schwellen.von

        etiketten = _etiketten(cid, fenster, erst, abstaende, schwellen)
        themen = _je_thema(cid, fenster, erst)
        if fehlt and fehlt / max(1, len(je_test)) >= FEHLT_ANTEIL:
            etiketten.append({"art": "beteiligung",
                              "text": f"in {fehlt} von {len(je_test)} Tests keine Abgabe — "
                                      f"das ist ein Hinweis auf Anwesenheit, nicht auf Können"})

        ergebnis.append({
            "card_id": cid, "name": name,
            "status": "melden" if melden else "unauffaellig",
            "abstand_median": med,
            "begruendung": _satz(name, med, unter, len(letzte), etiketten) if melden
                           else f"Abstand zur Klasse im Mittel {med:+.0f} Prozentpunkte.",
            "kurve": kurve, "etiketten": etiketten, "themen": themen,
        })

    # Gemeldete zuerst, darin der groesste Abstand oben.
    rang = {"melden": 0, "unauffaellig": 1, "zu_wenig_daten": 2}
    ergebnis.sort(key=lambda e: (rang[e["status"]], e["abstand_median"] if e["abstand_median"] is not None else 0))
    return {
        "tests": [{"session_id": e["test"].session_id, "name": e["test"].name,
                   "datum": e["test"].datum.isoformat(), "klasse": e["mittel"]} for e in je_test],
        "schueler": ergebnis,
        "regel": {"abstand": schwellen.abstand, "von": schwellen.von, "bis": schwellen.bis,
                  "fenster": schwellen.fenster, "mindest_antworten": schwellen.mindest_antworten},
    }


def _teilquote(cid: int, tests: list[Test], erst: dict[int, datetime], alt: bool) -> Optional[tuple[float, float]]:
    """Trefferquote des Kindes und der Klasse, getrennt nach Altbestand/frisch."""
    def passt(t: Test, a: Antwort) -> bool:
        if not a.topic_id or a.topic_id not in erst:
            return False
        gealtert = (t.datum - erst[a.topic_id]) > timedelta(days=FRISCH_TAGE)
        return gealtert if alt else not gealtert

    kind = [0, 0]
    klasse = [0, 0]
    for t in tests:
        for a in t.antworten:
            if not passt(t, a):
                continue
            klasse[1] += 1
            klasse[0] += 1 if a.richtig else 0
            if a.card_id == cid:
                kind[1] += 1
                kind[0] += 1 if a.richtig else 0
    if kind[1] < THEMA_MINDEST or not klasse[1]:
        return None
    return _quote(kind[0], kind[1]), _quote(klasse[0], klasse[1])


def _etiketten(cid: int, tests: list[Test], erst: dict[int, datetime],
               abstaende: list[float], schwellen: Schwellen) -> list[dict]:
    aus: list[dict] = []

    # Altbestand: liegt das Kind auch bei Wiederholungsfragen unten, reichen die
    # Luecken weiter zurueck als das laufende Thema.
    fuer_alt = _teilquote(cid, tests, erst, alt=True)
    fuer_neu = _teilquote(cid, tests, erst, alt=False)
    if fuer_alt:
        k, kl = fuer_alt
        if k - kl <= -schwellen.abstand:
            aus.append({"art": "altbestand",
                        "text": f"auch bei Wiederholungsfragen {k - kl:+.0f} Prozentpunkte "
                                f"({k:.0f} % gegen {kl:.0f} % der Klasse) — die Lücken reichen weiter zurück"})
        elif fuer_neu and (fuer_neu[0] - fuer_neu[1]) <= -schwellen.abstand:
            aus.append({"art": "aktuell",
                        "text": f"nur beim frischen Stoff unten ({fuer_neu[0]:.0f} % gegen "
                                f"{fuer_neu[1]:.0f} %) — Älteres sitzt"})
    # Themenbreite: quer durch alle Themen oder nur eines?
    schwach = [x for x in _je_thema(cid, tests, erst) if x["abstand"] is not None and x["abstand"] <= -schwellen.abstand]
    if len(schwach) >= 3:
        aus.append({"art": "breit", "text": f"quer über {len(schwach)} Themen unter der Klasse"})
    elif len(schwach) == 1:
        aus.append({"art": "einzeln", "text": f"nur beim Thema „{schwach[0]['name'] or schwach[0]['topic_id']}“ unten"})

    # Trend: entwickelt sich der Abstand?
    if len(abstaende) >= 4:
        h = len(abstaende) // 2
        delta = round(sum(abstaende[h:]) / len(abstaende[h:]) - sum(abstaende[:h]) / h, 1)
        if delta <= -TREND_PP:
            aus.append({"art": "abwaerts", "text": f"der Abstand wächst ({delta:+.0f} Prozentpunkte im Verlauf)"})
        elif delta >= TREND_PP:
            aus.append({"art": "aufwaerts", "text": f"holt auf ({delta:+.0f} Prozentpunkte im Verlauf)"})
    return aus


def _je_thema(cid: int, tests: list[Test], erst: dict[int, datetime]) -> list[dict]:
    """Abstand zur Klasse, aufgeschlüsselt nach Thema."""
    kind: dict[int, list[int]] = {}
    klasse: dict[int, list[int]] = {}
    alt: dict[int, bool] = {}
    for t in tests:
        for a in t.antworten:
            if not a.topic_id:
                continue
            k = klasse.setdefault(a.topic_id, [0, 0]); k[1] += 1; k[0] += 1 if a.richtig else 0
            if a.topic_id in erst:
                alt[a.topic_id] = (t.datum - erst[a.topic_id]) > timedelta(days=FRISCH_TAGE)
            if a.card_id == cid:
                z = kind.setdefault(a.topic_id, [0, 0]); z[1] += 1; z[0] += 1 if a.richtig else 0
    aus = []
    for tid, (tr, ges) in kind.items():
        if ges < THEMA_MINDEST:
            continue
        kq = _quote(tr, ges)
        clq = _quote(*klasse[tid])
        aus.append({"topic_id": tid, "name": None, "pct": kq, "klasse": clq,
                    "abstand": round(kq - clq, 1) if kq is not None and clq is not None else None,
                    "antworten": ges, "altbestand": bool(alt.get(tid))})
    aus.sort(key=lambda x: (x["abstand"] is None, x["abstand"]))
    return aus


def _satz(name: str, med: float, unter: int, von: int, etiketten: list[dict]) -> str:
    """Ein Satz, der die Zahlen nennt statt sie zu verstecken."""
    kern = f"in {unter} von {von} Tests deutlich unter der Klasse, im Mittel {med:+.0f} Prozentpunkte"
    zusatz = "; ".join(e["text"] for e in etiketten if e["art"] in ("altbestand", "aktuell", "breit", "einzeln", "abwaerts"))
    return f"{kern}{' — ' + zusatz if zusatz else ''}."
