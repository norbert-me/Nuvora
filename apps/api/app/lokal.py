"""Lokale Installation: Nuvora als Programm auf einem einzelnen Rechner.

Gleiche Anwendung, anderer Rahmen: statt Proxy-Container, Postgres und
Mailserver laeuft ALLES in einem Prozess auf 127.0.0.1 — die API liefert die
gebaute Weboberflaeche selbst aus, die Daten liegen in SQLite, und Konten sind
sofort bestaetigt (es gibt keinen Mailserver und keine fremden Besucher).

Eingeschaltet wird das nur ueber die Umgebung (`NUVORA_LOKAL=1`, gesetzt von der
Desktop-Huelle). Eine Server-Installation setzt es nie, und alle Pfade hier
sind dort tot.
"""
import os
from pathlib import Path

LOKAL = os.environ.get("NUVORA_LOKAL") == "1"
WEB_DIR = Path(os.environ.get("NUVORA_WEB_DIR", "/app/web"))

# Was nie aus dem Zwischenspeicher kommen darf (wie im Proxy): sonst zeigt
# der Browser nach einem Update die alte Oberflaeche.
_NIE_CACHEN = {"index.html", "sw.js", "precache.json"}


def einhaengen(app) -> None:
    """Oberflaeche und Statik unter / ausliefern — als LETZTES registrieren,
    damit /api und /ws Vorrang haben."""
    if not LOKAL:
        return
    from fastapi import HTTPException
    from fastapi.responses import FileResponse, JSONResponse

    wurzel = WEB_DIR.resolve()

    @app.get("/site.json", include_in_schema=False)
    async def site_json():
        # Betreiberdaten (Impressum) gibt es bei einer lokalen Installation nicht.
        eigene = os.environ.get("NUVORA_SITE_JSON")
        if eigene and Path(eigene).is_file():
            return FileResponse(eigene, media_type="application/json")
        return JSONResponse({})

    @app.get("/{pfad:path}", include_in_schema=False)
    async def oberflaeche(pfad: str):
        if pfad.startswith(("api/", "ws/")) or pfad in ("api", "ws"):
            raise HTTPException(404)
        # Mit os.path statt pathlib: so lassen sich Normalisieren (realpath) und die Pruefung auf den
        # Web-Ordner in EINER Folge lesen — und die statische Analyse erkennt sie als Schranke.
        wurzel_s = os.path.realpath(str(wurzel))
        ziel = os.path.realpath(os.path.join(wurzel_s, pfad)) if pfad else os.path.join(wurzel_s, "index.html")
        # Nie aus dem Web-Ordner heraus (../, Symlinks) — nur Dateien darin.
        if not (ziel == wurzel_s or ziel.startswith(wurzel_s + os.sep)):
            raise HTTPException(404)
        if os.path.isdir(ziel):
            ziel = os.path.join(ziel, "index.html")
        if not os.path.isfile(ziel):
            # Bekannte Statik-Endungen: 404 statt der Startseite (sonst bekommt
            # ein fehlendes Skript HTML und der Fehler zeigt in die falsche Richtung).
            if "." in pfad.rsplit("/", 1)[-1]:
                raise HTTPException(404)
            ziel = os.path.join(wurzel_s, "index.html")        # Seitenroute der Oberflaeche
        teile = ziel[len(wurzel_s):].split(os.sep)
        kopf = {"Cache-Control": "no-cache"} if os.path.basename(ziel) in _NIE_CACHEN else (
            {"Cache-Control": "public, max-age=31536000, immutable"} if "assets" in teile else {})
        return FileResponse(ziel, headers=kopf)
