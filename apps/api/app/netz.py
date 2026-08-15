"""Wer fragt da? — die Absender-Adresse einer Anfrage, an einer Stelle.

Ein Blatt: importiert nichts aus der Anwendung. Es steht hier und nicht in
`auth.py`, weil `main.py` dieselbe Rechnung braucht und jeden Router importiert;
eine zweite Fassung dort war genau die Stelle, an der die beiden auseinander
laufen konnten — und diese hier entscheidet, ob ein Rate-Limit greift.
"""
from __future__ import annotations


def client_ip(request) -> str:
    """IP des Aufrufers.

    X-Real-IP zuerst: die setzt UNSER nginx aus `$remote_addr`, sie ist nicht
    faelschbar. X-Forwarded-For kaeme dagegen direkt vom Client durch — wer sie
    selbst setzt, umginge damit jedes Rate-Limit.

    Stand wortgleich in `routers/auth.py` (`client_ip`) und in `main.py`
    (`_req_ip`); beide Namen zeigen weiter hierher.
    """
    real = request.headers.get("X-Real-IP")
    if real:
        return real.strip()
    xff = request.headers.get("X-Forwarded-For", "")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else "unknown"
