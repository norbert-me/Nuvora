"""Bild-Uploads: was hereinkommt, wird am Inhalt erkannt — nicht am Client.

Der vom Browser gemeldete Content-Type ist eine Behauptung. Wer ein SVG als
"image/png" hochlaedt, bekam bisher genau diesen Typ beim Abruf zurueck; ein
direkt aufgerufenes SVG laeuft im eigenen Origin und kann Skript tragen. Deshalb
entscheiden hier die ersten Bytes, und der Typ wird daraus abgeleitet.

Fuer Fragen-Bilder gibt es in questions.py bewusst einen eigenen Weg mit
SVG-Sanitisierung (dort sind Vektorgrafiken erwuenscht). Schuelerfotos und
Kartenbilder brauchen das nicht — sie sind Fotos.
"""
from typing import Optional

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
    # Auch alle uebrigen Steuerzeichen: eine Kopfzeile endet am ersten davon.
    sauber = "".join(c for c in sauber if c.isprintable())
    return sauber.strip()[:120] or "datei"


def anhang_kopf(name: str, art: str = "attachment") -> str:
    """Fertiger `Content-Disposition`-Wert fuer einen Dateinamen aus Nutzerdaten.

    Zwei Dinge, die einzeln gebaut jedes Mal vergessen werden:

    * **Bereinigen.** In diesem Namen steht ein Schueler-, Klassen- oder
      Quizname. Ein `"` oder ein Zeilenumbruch darin waere eine eingeschleuste
      Kopfzeile.
    * **Umlaute und alles ausserhalb von Latin-1.** Eine Kopfzeile traegt nur
      Latin-1; Starlette wirft beim Kodieren, also endete der Druck fuer ein
      Kind namens „Ayşe" in HTTP 500 — beim Ausdruck der Klassenliste fuer
      genau dieses Kind. Deshalb der ASCII-Ersatz als `filename` UND die
      richtige Fassung als `filename*` (RFC 5987), die jeder heutige Browser
      bevorzugt.
    """
    from urllib.parse import quote

    sauber = dateiname_sicher(name)
    einfach = sauber.encode("ascii", "replace").decode("ascii")
    return f"{art}; filename=\"{einfach}\"; filename*=UTF-8''{quote(sauber, safe='')}"


def bild_sparsam(daten: bytes, mime: str) -> tuple[bytes, str]:
    """Ein Rasterbild verlustarm verkleinern — behaelt aber nur, was WIRKLICH
    kleiner wird und die Aufloesung NICHT antastet.

    Warum ueberhaupt: Handyfotos kommen mit 3–8 MB und voller EXIF-Spur ins
    Konto; neu kodiert bei hoher Qualitaet bleiben oft 40–70 % uebrig, ohne dass
    man den Unterschied sieht. JPEG q90 ist nahezu verlustfrei (deutlich unter
    den zugestandenen 10 %), `optimize` und `progressive` holen den Rest ohne
    weiteren Verlust. Die Metadaten (EXIF: Ort, Geraet, Zeit) fallen dabei weg —
    das ist Datenschutz, kein Nebeneffekt.

    Drei Grenzen, damit nichts schlechter wird als vorher:
    * **Nur JPEG.** PNG/WebP/GIF bleiben unangetastet — ein PNG nach JPEG
      verloere die Transparenz, ein GIF die Animation, und verlustfrei neu zu
      packen bringt bei ihnen kaum etwas.
    * **Nur behalten, wenn kleiner.** Ein bereits sparsam kodiertes Foto wird
      sonst durch das Neukodieren groesser statt kleiner.
    * **Aufloesung bleibt.** Kein Herunterskalieren — die Detailansicht soll das
      volle Bild zeigen; verkleinert wird die Datei, nicht das Bild.

    Deterministisch: dieselbe Eingabe ergibt dieselben Bytes, damit die
    Inhalts-Deduplizierung (sha256) beim zweiten Upload greift. Faellt etwas
    aus, kommt das Original unveraendert zurueck — ein Upload darf daran nicht
    scheitern.
    """
    if mime not in ("image/jpeg", "image/jpg"):
        return daten, mime
    try:
        from io import BytesIO

        from PIL import Image, ImageOps

        with Image.open(BytesIO(daten)) as bild:
            bild = ImageOps.exif_transpose(bild)
            if bild.mode not in ("RGB", "L"):
                bild = bild.convert("RGB")
            puffer = BytesIO()
            bild.save(puffer, format="JPEG", quality=90, optimize=True, progressive=True)
        neu = puffer.getvalue()
        if neu and len(neu) < len(daten):
            return neu, "image/jpeg"
    except Exception:
        pass
    return daten, mime


def vorschaubild(daten: bytes, kante: int = 256) -> Optional[bytes]:
    """Kleines JPEG fuer Listen und Sitzplan — laengste Kante `kante` Pixel.

    Ein Klassensatz Handyfotos sind schnell 100 MB; im Sitzplan werden 30 davon
    gleichzeitig gebraucht. Das Vorschaubild kostet rund 20 KB je Kind. Das
    Original bleibt gespeichert (Detailansicht, spaeterer Export).

    Faellt die Umwandlung aus (kaputte Datei, exotisches Format), gibt es None —
    dann liefert der Server eben das Original aus. Ein fehlendes Vorschaubild
    ist langsam, ein Absturz beim Hochladen waere schlimmer.
    """
    try:
        from io import BytesIO

        from PIL import Image, ImageOps

        with Image.open(BytesIO(daten)) as bild:
            # exif_transpose: Handyfotos tragen die Drehung in den Metadaten.
            # Ohne diesen Schritt liegen sie im Sitzplan auf der Seite.
            bild = ImageOps.exif_transpose(bild)
            bild = bild.convert("RGB")
            bild.thumbnail((kante, kante))
            puffer = BytesIO()
            bild.save(puffer, format="JPEG", quality=82, optimize=True)
            return puffer.getvalue()
    except Exception:
        return None
