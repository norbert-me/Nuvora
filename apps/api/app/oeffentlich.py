"""Die oeffentliche Adresse dieser Installation — an EINER Stelle.

Jeder Link, den Nuvora aus dem Haus gibt (Bestaetigungsmail, QR-Zettel fuers
Kind, Kalender-Abo, CalDAV-Profil), muss dieselbe Adresse tragen: die, unter
der die Seite von aussen erreichbar ist. Abgeleitet wurde sie bisher aus dem
AUFRUF — wer im Schulnetz ueber die LAN-Adresse arbeitete, verschickte Links
auf `http://192.168.x.y:8090`, und die sind ausserhalb tot (genau so kam eine
Bestaetigungsmail an, die niemand oeffnen konnte).

`SITE_URL` schlaegt deshalb den Aufruf. Ist sie nicht gesetzt, bleibt es beim
alten Verhalten, damit eine Installation ohne Konfiguration weiter funktioniert.

Blatt: ohne FastAPI-Import und ohne Datenbank, damit jeder Router es holen kann
(Auth, Karten, Kalender, CalDAV) ohne einen Ring zu bauen.
"""
import os


def site_url() -> str:
    """Die konfigurierte Adresse ohne Schraegstrich am Ende ("" = keine)."""
    return (os.environ.get("SITE_URL") or "").strip().rstrip("/")


def basis(fallback: str = "") -> str:
    """Die Adresse fuer ausgehende Links: SITE_URL, sonst der Aufruf."""
    return site_url() or (fallback or "").rstrip("/")
