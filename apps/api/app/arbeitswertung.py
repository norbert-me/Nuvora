"""Wertung einer Klassenarbeit je Kind — an EINER Stelle.

Eine Aufgabe kann zwei Fassungen haben: die G-Fassung (die Aufgabe selbst) und
eine E-Fassung (`task["e"]`) mit eigenen Teilaufgaben, eigenen Punkten und
eigenen Themen. Die Kinder duerfen in der Arbeit je Aufgabe waehlen; welche
Fassung ein Kind geschrieben hat, steht in `work.e_wahl` ({sid: [task_id, …]},
aufgefuehrt sind nur die E-Aufgaben — fehlt die Angabe, gilt G).

Die Regel (entschieden am 01.10.2026): **Die Basis ist die G-Punktzahl.** Je
Aufgabe zaehlt, was das Kind in seiner Fassung erreicht hat, bis zur G-Hoechst-
punktzahl dieser Aufgabe in die Basis; was eine E-Fassung darueber hinaus
einbringt, ist Bonus. Der Bonus ist auf **eine Notenstufe** gedeckelt — dieselbe
Grenze wie beim E-Bonus im Quiz (`scoring.naechste_stufe`), sonst waere die
E-Fassung ein Weg an jeder Notengrenze vorbei.

Eine Arbeit ohne E-Fassungen rechnet genau wie vorher: Basis = alle Punkte,
Bonus = 0.

Die Regel steht doppelt — hier und in `apps/web/src/core/arbeitswertung.js`
(die Seite rechnet beim Tippen live) — und muss zusammen geaendert werden.
Blatt: importiert nur `scoring`, damit Router und `notenverlauf` es holen
koennen, ohne einander zu importieren.
"""
from .scoring import kaufmaennisch, naechste_stufe


def _max(x) -> float:
    return float(x) if isinstance(x, (int, float)) and not isinstance(x, bool) and x > 0 else 1.0


def einheiten(teil: dict, erbe=None) -> list:
    """Wertungseinheiten einer Fassung: [(unit_id, max, topic_id), …].

    Teilaufgaben, wenn es welche gibt, sonst die Fassung selbst. Das Thema der
    Teilaufgabe schlaegt das der Fassung, das wiederum das der Aufgabe (`erbe`).
    """
    if not isinstance(teil, dict):
        return []
    eigen = teil.get("topic_id") or erbe
    parts = teil.get("parts")
    if isinstance(parts, list) and parts:
        return [(str(p.get("id")), _max(p.get("max")), p.get("topic_id") or eigen)
                for p in parts if isinstance(p, dict) and p.get("id")]
    if not teil.get("id"):
        return []
    return [(str(teil["id"]), _max(teil.get("max")), eigen)]


def e_fassung(task: dict):
    e = task.get("e") if isinstance(task, dict) else None
    return e if isinstance(e, dict) and e.get("id") else None


def g_einheiten(task: dict) -> list:
    return einheiten(task)


def e_einheiten(task: dict) -> list:
    e = e_fassung(task)
    return einheiten(e, task.get("topic_id")) if e else []


def alle_einheiten(task: dict) -> list:
    """Beide Fassungen — fuer alles, was nur wissen will, welche Einheiten es gibt."""
    return g_einheiten(task) + e_einheiten(task)


def g_max(task: dict) -> float:
    return sum(mx for _, mx, _ in g_einheiten(task))


def basis(tasks) -> float:
    """Hoechstpunktzahl der Arbeit = Summe der G-Fassungen."""
    return sum(g_max(t) for t in (tasks or []))


def e_aufgaben(work, sid) -> set:
    wahl = (getattr(work, "e_wahl", None) or {}).get(str(sid)) or []
    return {str(x) for x in wahl} if isinstance(wahl, list) else set()


def fassung(work, sid, task: dict) -> str:
    """"E" oder "G" — welche Fassung dieses Kind bei dieser Aufgabe schrieb."""
    if e_fassung(task) and str(task.get("id")) in e_aufgaben(work, sid):
        return "E"
    return "G"


def einheiten_fuer(work, sid, task: dict) -> list:
    """Die Einheiten der Fassung, die das Kind geschrieben hat."""
    return e_einheiten(task) if fassung(work, sid, task) == "E" else g_einheiten(task)


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
        gm = g_max(t)
        in_basis += min(e, gm)
        ueber += max(0.0, e - gm)
    if not gesamt:
        return {"erreicht": erreicht, "basis": 0.0, "base_pct": 0.0, "bonus_pct": 0.0, "pct": 0.0}
    base_pct = in_basis / gesamt * 100
    bonus_pct = min(ueber / gesamt * 100, naechste_stufe(base_pct, scale)) if ueber else 0.0
    return {"erreicht": erreicht, "basis": gesamt,
            "base_pct": kaufmaennisch(base_pct, 2),
            "bonus_pct": kaufmaennisch(bonus_pct, 2),
            "pct": min(100.0, base_pct + bonus_pct)}
