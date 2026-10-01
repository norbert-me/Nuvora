"""Wertung einer Klassenarbeit je Kind — an EINER Stelle.

Wahlaufgaben: eine E/G-Arbeit besteht aus zwei Blaettern (E und G, verbunden
ueber `partner_id`). Ein Kind steht auf dem Blatt seines Niveaus, darf aber je
Aufgabe die Fassung des ANDEREN Blatts schreiben — Aufgabe 3 des G-Blatts und
Aufgabe 3 des E-Blatts sind zwei Fassungen derselben Aufgabe (gleiche
Position). Sie unterscheiden sich in Teilaufgaben, Punkten und Themen.

Wer wo gewechselt hat, steht am eigenen Blatt in `work.wechsel`
({sid: [task_id, …]}). Die Punkte dafuer liegen ebenfalls im eigenen Blatt,
unter den Einheiten des anderen Blatts mit dem Vorsatz `ANDERE` ("~") — beide
Blaetter entstehen oft als Kopie voneinander und tragen dieselben ids.

Die Regel (entschieden am 01.10.2026): **Die Basis ist die Fassung des eigenen
Blatts.** Je Aufgabe zaehlt das Erreichte bis zur Hoechstpunktzahl der eigenen
Fassung in die Basis; was die andere Fassung darueber hinaus einbringt, ist
Bonus — gedeckelt auf **eine Notenstufe** (`scoring.naechste_stufe`, dieselbe
Grenze wie beim E-Bonus im Quiz). Ein G-Kind, das die groessere E-Aufgabe
schreibt, kann also Bonus holen; ein E-Kind, das zur kleineren G-Aufgabe
greift, bekommt deren Punkte und keinen Bonus.

Das andere Blatt haengt NICHT in der Tabelle, sondern wird zum Rechnen
angehaengt (`partner_anhaengen`, `partner_laden` -> Attribut `_alt`). Fehlt es
(Blatt geloescht), rechnet jede Aufgabe mit der eigenen Fassung.

Die Regel steht doppelt — hier und in `apps/web/src/core/arbeitswertung.js`
— und muss zusammen geaendert werden. Blatt: importiert nur `scoring`.
"""
from .scoring import kaufmaennisch, naechste_stufe

ANDERE = "~"


def _max(x) -> float:
    return float(x) if isinstance(x, (int, float)) and not isinstance(x, bool) and x > 0 else 1.0


def einheiten(teil: dict, vorsatz: str = "") -> list:
    """Wertungseinheiten einer Aufgabe: [(unit_id, max, topic_id), …] —
    Teilaufgaben, wenn es welche gibt, sonst die Aufgabe selbst. Das Thema der
    Teilaufgabe schlaegt das der Aufgabe."""
    if not isinstance(teil, dict):
        return []
    erbe = teil.get("topic_id")
    parts = teil.get("parts")
    if isinstance(parts, list) and parts:
        return [(vorsatz + str(p.get("id")), _max(p.get("max")), p.get("topic_id") or erbe)
                for p in parts if isinstance(p, dict) and p.get("id")]
    if not teil.get("id"):
        return []
    return [(vorsatz + str(teil["id"]), _max(teil.get("max")), erbe)]


# ── das andere Blatt ──

def partner_anhaengen(works) -> None:
    """Haengt jedem Blatt die Aufgaben seines Partners an, sofern der in der
    Liste steht (beide Blaetter liegen in derselben Klasse)."""
    nach_id = {w.id: w for w in works}
    for w in works:
        p = nach_id.get(getattr(w, "partner_id", None))
        w._alt = list(p.tasks or []) if p is not None else []


async def partner_laden(db, w) -> None:
    """Dasselbe fuer ein einzelnes Blatt: den Partner aus der Datenbank holen."""
    from .models import WorkAnalysis
    p = await db.get(WorkAnalysis, w.partner_id) if getattr(w, "partner_id", None) else None
    w._alt = list(p.tasks or []) if p is not None and p.owner_id == w.owner_id else []


def andere_fassung(work, task: dict):
    """Die Aufgabe an derselben Stelle im anderen Blatt — oder None."""
    alt = getattr(work, "_alt", None) or []
    for i, t in enumerate(work.tasks or []):
        if t is task or t.get("id") == task.get("id"):
            return alt[i] if i < len(alt) and isinstance(alt[i], dict) else None
    return None


def eigene_einheiten(task: dict) -> list:
    return einheiten(task)


def andere_einheiten(work, task: dict) -> list:
    a = andere_fassung(work, task)
    return einheiten(a, ANDERE) if a else []


def alle_einheiten(work, task: dict) -> list:
    """Beide Fassungen — fuer alles, was nur wissen will, welche Einheiten es gibt."""
    return eigene_einheiten(task) + andere_einheiten(work, task)


def eigene_max(task: dict) -> float:
    return sum(mx for _, mx, _ in eigene_einheiten(task))


def basis(tasks) -> float:
    """Hoechstpunktzahl des Blatts = Summe der eigenen Fassungen."""
    return sum(eigene_max(t) for t in (tasks or []))


def gewechselt(work, sid, task: dict) -> bool:
    """Hat dieses Kind bei dieser Aufgabe die Fassung des anderen Blatts geschrieben?"""
    liste = (getattr(work, "wechsel", None) or {}).get(str(sid)) or []
    return (isinstance(liste, list) and str(task.get("id")) in {str(x) for x in liste}
            and andere_fassung(work, task) is not None)


def einheiten_fuer(work, sid, task: dict) -> list:
    """Die Einheiten der Fassung, die das Kind geschrieben hat."""
    return andere_einheiten(work, task) if gewechselt(work, sid, task) else eigene_einheiten(task)


def punkte(eintrag, uid: str, umax: float) -> float:
    if isinstance(eintrag, list):
        return 0.0 if uid in eintrag else umax          # Altformat: Liste falscher Aufgaben
    v = (eintrag or {}).get(uid) if isinstance(eintrag, dict) else None
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else 0.0


def wertung(work, sid, scale=None) -> dict:
    """Je Kind: erreichte Punkte, Basis, Basis-Prozent, Bonus, Endprozent."""
    tasks = work.tasks or []
    eintrag = (work.results or {}).get(str(sid))
    gesamt = basis(tasks)
    erreicht = in_basis = ueber = 0.0
    for t in tasks:
        e = sum(punkte(eintrag, uid, mx) for uid, mx, _ in einheiten_fuer(work, sid, t))
        erreicht += e
        em = eigene_max(t)
        in_basis += min(e, em)
        ueber += max(0.0, e - em)
    if not gesamt:
        return {"erreicht": erreicht, "basis": 0.0, "base_pct": 0.0, "bonus_pct": 0.0, "pct": 0.0}
    base_pct = in_basis / gesamt * 100
    bonus_pct = min(ueber / gesamt * 100, naechste_stufe(base_pct, scale)) if ueber else 0.0
    return {"erreicht": erreicht, "basis": gesamt,
            "base_pct": kaufmaennisch(base_pct, 2),
            "bonus_pct": kaufmaennisch(bonus_pct, 2),
            "pct": min(100.0, base_pct + bonus_pct)}
