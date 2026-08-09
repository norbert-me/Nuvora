"""Bild-Uploads: was hereinkommt, wird am Inhalt erkannt — nicht am Client.

Der vom Browser gemeldete Content-Type ist eine Behauptung. Wer ein SVG als
"image/png" hochlaedt, bekam bisher genau diesen Typ beim Abruf zurueck; ein
direkt aufgerufenes SVG laeuft im eigenen Origin und kann Skript tragen. Deshalb
entscheiden hier die ersten Bytes, und der Typ wird daraus abgeleitet.

Fuer Fragen-Bilder gibt es in questions.py bewusst einen eigenen Weg mit
SVG-Sanitisierung (dort sind Vektorgrafiken erwuenscht). Schuelerfotos und
Kartenbilder brauchen das nicht — sie sind Fotos.
"""
from fastapi import HTTPException

# (Signatur, MIME). WebP: "RIFF" + 4 Byte Groesse + "WEBP".
_MAGIC = [
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"GIF87a", "image/gif"),
    (b"GIF89a", "image/gif"),
]


def bildtyp(daten: bytes) -> str:
    """MIME-Typ aus den ersten Bytes. Wirft 400, wenn es kein Rasterbild ist."""
    for signatur, mime in _MAGIC:
        if daten.startswith(signatur):
            return mime
    if daten[:4] == b"RIFF" and daten[8:12] == b"WEBP":
        return "image/webp"
    raise HTTPException(400, "Keine gültige Bilddatei (erlaubt: JPEG, PNG, GIF, WebP)")


def dateiname_sicher(name: str) -> str:
    """Fuer Content-Disposition: Zeilenumbrueche und Anfuehrungszeichen raus.

    Ein Schueler- oder Klassenname landet in dieser Kopfzeile. Ein " oder ein
    Zeilenumbruch darin waere eine eingeschleuste Kopfzeile.
    """
    sauber = (name or "").replace("\r", " ").replace("\n", " ").replace('"', "'")
    return sauber.strip() or "datei"
