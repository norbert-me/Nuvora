"""Personenbezogene Spalten verschlüsselt ablegen (AES-256-GCM).

Warum es das gibt: Postgres-Volume und Sicherungen lagen im Klartext. Wer an
die Platte, einen Dump oder die Sicherung kam, las Namen, Noten, Förder- und
Maßnahmenangaben aller Konten. Jetzt steht in den Spalten, die eine Person
erkennbar machen oder Gesundheits-/Leistungsdaten tragen, nur noch Chiffretext.

Aufbau
------
* **Schlüssel** `NUVORA_DATENSCHLUESSEL` (Umgebung, 32 Byte, base64) — nie in
  Datenbank oder Sicherung. Wer nur die Datenbank oder eine Sicherung hat, sieht
  keinen Klartext. **Geht der Schlüssel verloren, sind die Daten weg**; deshalb
  gibt es eine Kopie außerhalb des Servers (`deploy.sh` zeigt sie einmal an).
* **Format** `enc1:` + base64(Nonce 12 B ‖ Chiffretext ‖ GCM-Tag). Jede Zelle
  bekommt eine neue Zufalls-Nonce; dieselben Namen sehen deshalb nicht gleich aus.
* **AAD = „tabelle.spalte“**: eine Zelle in eine andere Spalte zu kopieren
  scheitert an der Prüfung, statt still etwas Falsches zu zeigen.
* **Lesen ohne Präfix gibt den Wert unverändert zurück.** So bleibt der
  Bestand lesbar, bis `bestand_verschluesseln` (beim Start, idempotent) ihn
  umgeschrieben hat — und eine ältere Sicherung im Klartext lässt sich
  einspielen, ohne dass etwas bricht.
* **Entschlüsseln scheitert laut** (`DatenschluesselFehler`): ein falscher
  Schlüssel darf nie als „leere Namen“ durchgehen.

Was bewusst NICHT verschlüsselt ist: Schlüssel (Ids), Zeitstempel, Zähler,
Zugangs-Token (Zufallswerte, keine Personendaten) und Spalten, nach denen die
Datenbank filtert. Die E-Mail wird deshalb über einen **Suchwert** gefunden
(`suchwert`, HMAC-SHA256 — nicht umkehrbar, ohne Schlüssel nicht berechenbar).

AES-256 gilt auch gegen Quantencomputer als sicher (Grover halbiert nur die
Schlüsselstärke auf 128 Bit); gefährdet ist der asymmetrische Teil (TLS).
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sqlalchemy import LargeBinary, Text
from sqlalchemy.types import TypeDecorator

PRAEFIX = "enc1:"
PRAEFIX_B = b"NVE1"          # Bilder: Magic vor Nonce+Chiffretext (kein gültiger Bildkopf)
ENV = "NUVORA_DATENSCHLUESSEL"


class DatenschluesselFehler(RuntimeError):
    """Schlüssel fehlt, ist unbrauchbar oder passt nicht zu den Daten."""


_gecacht: tuple[str, AESGCM, bytes] | None = None


def neuer_schluessel() -> str:
    return base64.urlsafe_b64encode(secrets.token_bytes(32)).decode("ascii")


def _lade() -> tuple[AESGCM, bytes]:
    global _gecacht
    roh = os.environ.get(ENV, "").strip()
    if not roh and os.environ.get("NUVORA_LOKAL") == "1":
        roh = _lokaler_schluessel()
    if _gecacht is not None and _gecacht[0] == roh:
        return _gecacht[1], _gecacht[2]
    if not roh:
        raise DatenschluesselFehler(
            f"{ENV} fehlt. Ohne Schlüssel sind die personenbezogenen Daten nicht lesbar. "
            f"Neuen erzeugen: python -c \"from app.krypto import neuer_schluessel;print(neuer_schluessel())\"")
    try:
        key = base64.urlsafe_b64decode(roh + "=" * (-len(roh) % 4))
    except Exception as e:  # noqa: BLE001
        raise DatenschluesselFehler(f"{ENV} ist kein gültiges base64.") from e
    if len(key) != 32:
        raise DatenschluesselFehler(f"{ENV} muss 32 Byte lang sein (ist {len(key)}).")
    # Der Suchwert-Schlüssel ist ein abgeleiteter, getrennter Schlüssel: AES-Schlüssel
    # und HMAC-Schlüssel nie identisch benutzen.
    such = hmac.new(key, b"nuvora-suchwert-v1", hashlib.sha256).digest()
    _gecacht = (roh, AESGCM(key), such)
    return _gecacht[1], _gecacht[2]


def _lokaler_schluessel() -> str:
    """Eingebaute Einzelplatz-Installation: der Schluessel liegt neben den Daten
    (es gibt keinen Server, der ihn getrennt halten koennte). Besser als Klartext,
    und der Rechner selbst gehoert dort der Person, deren Daten es sind."""
    from pathlib import Path
    ordner = Path(os.environ.get("NUVORA_UPLOAD_DIR", ".")).resolve().parent
    datei = ordner / ".datenschluessel"
    if datei.is_file():
        return datei.read_text().strip()
    k = neuer_schluessel()
    datei.write_text(k)
    try:
        datei.chmod(0o600)
    except OSError:
        pass   # Dateisystem ohne Rechte (z. B. Windows/FAT): der Schluessel bleibt trotzdem nutzbar
    return k


def schluessel_vorhanden() -> bool:
    try:
        _lade()
        return True
    except DatenschluesselFehler:
        return False


def verschluessle(klar: bytes, label: str) -> bytes:
    aes, _ = _lade()
    nonce = secrets.token_bytes(12)
    return nonce + aes.encrypt(nonce, klar, label.encode())


def entschluessle(roh: bytes, label: str) -> bytes:
    aes, _ = _lade()
    try:
        return aes.decrypt(roh[:12], roh[12:], label.encode())
    except InvalidTag as e:
        raise DatenschluesselFehler(
            f"Entschlüsseln von {label} fehlgeschlagen — falscher Schlüssel oder veränderte Daten.") from e


def text_verschluesseln(s: str, label: str) -> str:
    return PRAEFIX + base64.b64encode(verschluessle(s.encode("utf-8"), label)).decode("ascii")


def ist_verschluesselt(v) -> bool:
    if isinstance(v, (bytes, bytearray)):
        return bytes(v[:4]) == PRAEFIX_B
    return isinstance(v, str) and v.startswith(PRAEFIX)


def text_entschluesseln(s: str, label: str) -> str:
    return entschluessle(base64.b64decode(s[len(PRAEFIX):]), label).decode("utf-8")


def suchwert(wert: str) -> str:
    """Nicht umkehrbarer Suchwert (z. B. E-Mail): gleiche Eingabe, gleicher Wert."""
    _, such = _lade()
    return hmac.new(such, (wert or "").strip().lower().encode("utf-8"), hashlib.sha256).hexdigest()


# ── SQLAlchemy-Typen ─────────────────────────────────────────────────────────
class _EncText(TypeDecorator):
    """Basis: Text in der Datenbank, Python-Wert je Unterklasse."""
    impl = Text
    cache_ok = True

    def __init__(self, label: str = ""):
        super().__init__()
        self.label = label

    def _label(self) -> str:
        return self.label or type(self).__name__

    # (de)serialisieren zwischen Python-Wert und Text — Unterklassen überschreiben
    def _zu_text(self, v) -> str:
        return v

    def _von_text(self, s: str):
        return s

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        return text_verschluesseln(self._zu_text(value), self._label())

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        if isinstance(value, str) and value.startswith(PRAEFIX):
            return self._von_text(text_entschluesseln(value, self._label()))
        # Bestand im Klartext (vor der Umstellung oder aus alter Sicherung).
        return self._von_klartext(value)

    def _von_klartext(self, value):
        return self._von_text(value) if isinstance(value, str) else value


class EncStr(_EncText):
    cache_ok = True   # je Unterklasse noetig, sonst kein Statement-Cache (SQLAlchemy)


class EncJSON(_EncText):
    cache_ok = True

    def _zu_text(self, v):
        return json.dumps(v, ensure_ascii=False)

    def _von_text(self, s):
        return json.loads(s)

    def _von_klartext(self, value):
        # Klartext war eine json-Spalte: der Treiber liefert schon Python-Objekte.
        return self._von_text(value) if isinstance(value, str) else value


class EncFloat(_EncText):
    cache_ok = True

    def _zu_text(self, v):
        return repr(float(v))

    def _von_text(self, s):
        return float(s)

    def _von_klartext(self, value):
        return float(value) if value is not None else None


class EncInt(_EncText):
    cache_ok = True

    def _zu_text(self, v):
        return str(int(v))

    def _von_text(self, s):
        return int(s)

    def _von_klartext(self, value):
        return int(value) if value is not None else None


class EncBytes(TypeDecorator):
    """Bilder: Bytes in Bytes. Magic `NVE1` + Nonce + Chiffretext + Tag."""
    impl = LargeBinary
    cache_ok = True

    def __init__(self, label: str = ""):
        super().__init__()
        self.label = label

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        return PRAEFIX_B + verschluessle(bytes(value), self.label or "EncBytes")

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        b = bytes(value)
        if b[:4] == PRAEFIX_B:
            return entschluessle(b[4:], self.label or "EncBytes")
        return b


# ── Rohsicht für Sicherung / Wiederherstellung ───────────────────────────────
def ist_enc(spalte) -> bool:
    return isinstance(spalte.type, (_EncText, EncBytes))


def roh_ausdruecke(tabelle):
    """Spalten so lesen, wie sie in der Datenbank stehen (Chiffretext bleibt Chiffretext).
    Die Sicherung darf nichts entschlüsseln — sonst läge der Klartext wieder im Dump."""
    from sqlalchemy import type_coerce
    out = []
    for c in tabelle.c:
        if isinstance(c.type, _EncText):
            out.append(type_coerce(c, Text()).label(c.name))
        elif isinstance(c.type, EncBytes):
            out.append(type_coerce(c, LargeBinary()).label(c.name))
        else:
            out.append(c)
    return out


def roh_tabelle(tabelle):
    """Kopie der Tabelle mit Rohtypen (Defaults bleiben) — zum Einspielen von
    Chiffretext ohne Doppelverschlüsselung."""
    from sqlalchemy import MetaData
    kopie = tabelle.to_metadata(MetaData())
    for c in kopie.c:
        if isinstance(c.type, _EncText):
            c.type = Text()
        elif isinstance(c.type, EncBytes):
            c.type = LargeBinary()
    return kopie


def roh_wert_passend(spalte, v):
    """Wert aus einer (älteren) Sicherung für eine Roh-Textspalte vorbereiten:
    JSON/Zahl aus Klartext-Sicherungen wird zu Text; Chiffretext bleibt."""
    if v is None or not isinstance(spalte.type, _EncText):
        return v
    if isinstance(v, str):
        return v
    return json.dumps(v, ensure_ascii=False)


def roh_wert_lesbar(spalte, v):
    """Wert aus der Sicherung zeigbar/vergleichbar machen (entschlüsselt)."""
    if v is None:
        return None
    if isinstance(spalte.type, _EncText):
        if isinstance(v, str) and v.startswith(PRAEFIX):
            return spalte.type._von_text(text_entschluesseln(v, spalte.type._label()))
        return spalte.type._von_klartext(v)
    if isinstance(spalte.type, EncBytes) and isinstance(v, (bytes, bytearray)):
        b = bytes(v)
        return entschluessle(b[4:], spalte.type.label or "EncBytes") if b[:4] == PRAEFIX_B else b
    return v


def fuer_einspielen(tabelle, zeilen: list[dict]):
    """(Rohtabelle, Zeilen) zum Einspielen aus einer Sicherung."""
    rt = roh_tabelle(tabelle)
    spalten = {c.name: c for c in tabelle.c}
    neu = []
    for z in zeilen:
        neu.append({k: roh_wert_passend(spalten[k], v) if k in spalten else v for k, v in z.items()})
    return rt, neu
