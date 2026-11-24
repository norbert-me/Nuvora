"""Ein Geheimnis (z.B. der Untis-Mobile-Schluessel) verschluesselt ablegen.

Der Schluessel liegt NICHT in der Datenbank, sondern in der Umgebung
(`GEHEIMNIS_SECRET`, sonst `TOKEN_SECRET`): wer nur die Datenbank (oder eine
Sicherung) hat, sieht den Klartext nicht. Wer `TOKEN_SECRET` wechselt, verliert
diese Geheimnisse — das Auslesen gibt dann `None`, die Verbindung gilt als
getrennt und wird neu eingerichtet.

Gebaut aus der Standardbibliothek (HMAC-SHA256 als Schluesselstrom im Zaehler-
Modus, danach ein HMAC-Siegel ueber alles — „encrypt-then-MAC"), damit keine
neue Abhaengigkeit noetig ist (siehe Slopsquatting-Regel in CLAUDE.md). Wer
`cryptography` freigibt, kann die zwei Funktionen durch Fernet ersetzen; die
Aufrufer aendern sich dadurch nicht.
"""
import base64
import hashlib
import hmac
import os
import secrets

_VERSION = "v1."


def _schluessel() -> tuple:
    basis = (os.environ.get("GEHEIMNIS_SECRET") or os.environ.get("TOKEN_SECRET") or "").encode()
    if not basis:
        raise RuntimeError("Weder GEHEIMNIS_SECRET noch TOKEN_SECRET gesetzt")
    return (hmac.new(basis, b"nuvora-geheimnis-enc", hashlib.sha256).digest(),
            hmac.new(basis, b"nuvora-geheimnis-mac", hashlib.sha256).digest())


def _strom(schluessel: bytes, nonce: bytes, laenge: int) -> bytes:
    out, i = b"", 0
    while len(out) < laenge:
        out += hmac.new(schluessel, nonce + i.to_bytes(8, "big"), hashlib.sha256).digest()
        i += 1
    return out[:laenge]


def verschluesseln(klartext: str) -> str:
    enc, mac = _schluessel()
    nonce = secrets.token_bytes(16)
    daten = klartext.encode("utf-8")
    ct = bytes(a ^ b for a, b in zip(daten, _strom(enc, nonce, len(daten))))
    siegel = hmac.new(mac, _VERSION.encode() + nonce + ct, hashlib.sha256).digest()
    return _VERSION + base64.urlsafe_b64encode(nonce + ct + siegel).decode()


def entschluesseln(token: str):
    """Der Klartext, oder None bei jedem Fehler (kaputt, veraendert, falscher Schluessel)."""
    try:
        if not token or not token.startswith(_VERSION):
            return None
        roh = base64.urlsafe_b64decode(token[len(_VERSION):].encode())
        nonce, ct, siegel = roh[:16], roh[16:-32], roh[-32:]
        enc, mac = _schluessel()
        soll = hmac.new(mac, _VERSION.encode() + nonce + ct, hashlib.sha256).digest()
        if not hmac.compare_digest(siegel, soll):
            return None
        return bytes(a ^ b for a, b in zip(ct, _strom(enc, nonce, len(ct)))).decode("utf-8")
    except Exception:
        return None
