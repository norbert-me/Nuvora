"""Sicherungen: erstellen, aufbewahren, herunterladen, zurückspielen.

Warum eigenes Sicherungssystem und nicht „mach halt pg_dump per cron"?
Weil die Daten **nicht nur** in Postgres liegen. Eine Sicherung, die nur die
Datenbank umfasst, wäre eine Lüge. Tatsächlich gehören dazu:

  1. **Die Datenbank** — Konten, Klassen, Schüler, alle Modul-Daten. Darin auch
     die Bilder, die als `LargeBinary` in der Datenbank stehen: Schülerfotos
     (`students.photo`), Karteikarten-Bilder (`cards.front_image`/`back_image`)
     und die Material-Dateien (`material_items.data`).
  2. **Der Upload-Ordner** (`NUVORA_UPLOAD_DIR`, im Container `/app/uploads`) —
     dort liegen als Dateien nur die Frage-Bilder und -SVGs aus
     `routers/questions.py`. Alles andere ist Punkt 1.
  3. **`config/site.json`** — die Betreiberdaten (Impressum,
     Datenschutzerklärung). Im Container schreibgeschützt gemountet; ohne sie
     steht die Installation nach dem Zurückspielen ohne Impressum da.

Was **nicht** hineingehört und auch nicht hineinkommt: `.env` (Secrets,
insbesondere `TOKEN_SECRET` und `POSTGRES_PASSWORD`). Wer Schlüssel neben die
Daten legt, hat beides zusammen verloren, sobald eine Sicherung abhandenkommt.

**Diese Dateien enthalten DSGVO-Art.-9-Daten** (`students.foerder`,
`students.massnahmen`, `students.notizen`). Daraus folgt:

  * Alles hier hängt an `_require_admin` (Nutzer-ID 1). Kein Lehrkraft-Konto.
  * Der Ablageordner liegt **außerhalb** von `NUVORA_UPLOAD_DIR` — der ist über
    `/api/uploads` als StaticFiles gemountet und damit ohne Anmeldung lesbar.
    `test_backup.py` prüft genau das; der Proxy (nginx.conf) kennt ohnehin nur
    `/api/`, `/ws/`, `/site.json` und die Shell.
  * Dateien werden mit 0600 in einem 0700-Ordner abgelegt.
  * Der Download läuft über einen angemeldeten Endpunkt, nicht über eine
    ratbare Adresse; der Dateiname wird gegen ein festes Muster geprüft, damit
    `..` und absolute Pfade gar nicht erst durchkommen.

**Verschlüsselung: bewusst nein.** Begründung, damit sie nachprüfbar ist statt
Geschmackssache: (a) Ohne neue Abhängigkeit gibt es hier kein AES —
`requirements.txt` enthält keine Krypto-Bibliothek, und selbstgebaute
Verschlüsselung ist schlechter als gar keine. (b) Beim einzigen angebotenen
Ziel — ein Ordner auf demselben Server — läge der Schlüssel zwangsläufig in
derselben `.env` daneben; das ist der Fall, den die Aufgabenstellung selbst als
„unverschlüsselt" bezeichnet. (c) Wer die Sicherung vom Server wegträgt, soll
sie an der Stelle verschlüsseln, an der es etwas bringt, mit einem Werkzeug,
das dafür gemacht ist:

    age -p nuvora-20260809-030000.zip > nuvora-20260809-030000.zip.age
    gpg --symmetric --cipher-algo AES256 nuvora-20260809-030000.zip

Das steht so auch in der Oberfläche. Kommt einmal `cryptography` aus anderem
Grund in die Abhängigkeiten, ist das hier die Stelle zum Nachrüsten.

**Zurückspielen** siehe `zurueckspielen()` weiter unten — dieselbe Funktion
benutzt der Test, der eine echte Sicherung in eine Wegwerf-Datenbank lädt und
die Zeilen vergleicht.
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import io
import json
import os
import re
import shutil
import tempfile
import zipfile
from datetime import datetime, date, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from starlette.responses import FileResponse

from ..database import async_session, get_db
from ..models import AppSetting, Base
from .auth import get_current_user

router = APIRouter(prefix="/api/admin/backup", tags=["backup"])


# ── Ablage und Ziele ─────────────────────────────────────────────────────────
# Voreinstellung /app/backups. Der Ordner MUSS ein eigenes Volume sein, sonst
# überlebt die Sicherung kein `docker compose up --build`. Ob er eines ist,
# sagt der Status ehrlich (`dauerhaft`) — raten hilft niemandem.
BACKUP_DIR = os.environ.get("NUVORA_BACKUP_DIR", "/app/backups")
# Zweites Ziel: ein weiterer Ordner auf dem Server, üblicherweise ein
# eingehängter Netz-/USB-Speicher. Bewusst kein Cloud-Ziel: dafür bräuchte es
# Zugangsdaten, und die haben in der Datenbank nichts verloren. Ein Ziel, das
# geprüft funktioniert, ist mehr wert als vier, die niemand angefasst hat.
BACKUP_DIR_EXTERN = os.environ.get("NUVORA_BACKUP_DIR_EXTERN", "").strip()

UPLOAD_DIR = os.environ.get("NUVORA_UPLOAD_DIR", "/app/uploads")
CONFIG_DIR = os.environ.get("NUVORA_CONFIG_DIR", "/app/config")

# Aufbewahrung: Anzahl UND Gesamtgröße. Nur eine Anzahl reicht nicht — sieben
# Sicherungen einer gewachsenen Installation füllen die Platte genauso.
KEEP = max(1, int(os.environ.get("NUVORA_BACKUP_KEEP", "7")))
MAX_MB = max(1, int(os.environ.get("NUVORA_BACKUP_MAX_MB", "2048")))

def _liegt_in(pfad: str, ordner: str) -> bool:
    a, b = os.path.abspath(pfad), os.path.abspath(ordner)
    return a == b or a.startswith(b + os.sep)


# Harte Sperre statt Warnung: `/api/uploads` ist ein StaticFiles-Mount und
# damit OHNE Anmeldung lesbar. Eine Sicherung darunter waere ein Download-Link
# auf saemtliche Schuelerdaten der Installation, fuer jeden. Lieber startet der
# Dienst gar nicht, als dass er das eine Weile unbemerkt anbietet.
for _kandidat in (BACKUP_DIR, BACKUP_DIR_EXTERN):
    if _kandidat and _liegt_in(_kandidat, UPLOAD_DIR):
        raise RuntimeError(
            f"Sicherungsordner {_kandidat} liegt im Upload-Ordner {UPLOAD_DIR} — der wird "
            "unter /api/uploads ohne Anmeldung ausgeliefert. NUVORA_BACKUP_DIR aendern."
        )

# Zeitstempel auf die Sekunde. Zwei Sicherungen in derselben Sekunde sind
# selten, aber wenn es passiert, ueberschriebe die zweite die erste lautlos —
# deshalb der Zaehler dahinter (…-2.zip).
DATEI_MUSTER = re.compile(r"nuvora-\d{8}-\d{6}(-\d+)?\.zip")
PLAENE = ("aus", "taeglich", "woechentlich")

# Diese Einträge muss jede Sicherung haben, sonst ist sie keine.
PFLICHT_EINTRAEGE = ("manifest.json", "datenbank.ndjson")


def ziele() -> list[dict]:
    """Die wählbaren Sicherungsziele — klein und ehrlich."""
    raus = [{
        "key": "lokal",
        "label": "Lokaler Ordner auf dem Server",
        "pfad": BACKUP_DIR,
        "verfuegbar": True,
        "grund": "",
    }]
    if BACKUP_DIR_EXTERN:
        ok = os.path.isdir(BACKUP_DIR_EXTERN) and os.access(BACKUP_DIR_EXTERN, os.W_OK)
        raus.append({
            "key": "extern",
            "label": "Zweiter Ordner (eingehängter Speicher)",
            "pfad": BACKUP_DIR_EXTERN,
            "verfuegbar": ok,
            "grund": "" if ok else "Ordner fehlt oder ist nicht beschreibbar",
        })
    else:
        raus.append({
            "key": "extern",
            "label": "Zweiter Ordner (eingehängter Speicher)",
            "pfad": "",
            "verfuegbar": False,
            "grund": "NUVORA_BACKUP_DIR_EXTERN ist in der .env nicht gesetzt",
        })
    return raus


def _pfad_fuer(ziel: str) -> str:
    if ziel == "extern" and BACKUP_DIR_EXTERN:
        return BACKUP_DIR_EXTERN
    return BACKUP_DIR


def _ordner(ziel: str) -> str:
    p = _pfad_fuer(ziel)
    os.makedirs(p, mode=0o700, exist_ok=True)
    try:
        os.chmod(p, 0o700)
    except OSError:
        pass  # z.B. eingehängtes Netzlaufwerk ohne chmod — kein Grund abzubrechen
    return p


def _sicher(name: str) -> str:
    """Dateiname gegen das feste Muster prüfen. `..`, `/` und alles andere
    kommt hier gar nicht erst durch — kein Verlass auf Normalisierung."""
    if not DATEI_MUSTER.fullmatch(name or ""):
        raise HTTPException(400, "Ungültiger Sicherungsname")
    return name


# ── Einstellungen (app_settings) ─────────────────────────────────────────────
async def _lies(db, key: str, vorgabe: str = "") -> str:
    row = await db.get(AppSetting, key)
    return row.value if row else vorgabe


async def _schreib(db, key: str, wert: str):
    row = await db.get(AppSetting, key)
    if row:
        row.value = wert[:255]
    else:
        db.add(AppSetting(key=key, value=wert[:255]))


async def aktuelles_ziel(db) -> str:
    z = await _lies(db, "backup_ziel", "lokal")
    verfuegbar = {t["key"] for t in ziele() if t["verfuegbar"]}
    return z if z in verfuegbar else "lokal"


# ── JSON-Kodierung für Werte, die JSON nicht kennt ───────────────────────────
def _kodiere(v):
    if isinstance(v, bytes):
        return {"__b64__": base64.b64encode(v).decode("ascii")}
    if isinstance(v, datetime):
        return {"__dt__": v.isoformat()}
    if isinstance(v, date):
        return {"__d__": v.isoformat()}
    return v


def _dekodiere(v):
    if isinstance(v, dict) and len(v) == 1:
        if "__b64__" in v:
            return base64.b64decode(v["__b64__"])
        if "__dt__" in v:
            return datetime.fromisoformat(v["__dt__"])
        if "__d__" in v:
            return date.fromisoformat(v["__d__"])
    return v


# ── Die Sicherung selbst ─────────────────────────────────────────────────────
class _Zaehler(io.RawIOBase):
    """Schreibt durch und rechnet nebenbei sha256 und Bytes mit — damit die
    Datenbank nicht erst komplett in den Speicher muss, nur um geprüft zu
    werden."""

    def __init__(self, ziel):
        self._ziel = ziel
        self.hash = hashlib.sha256()
        self.bytes = 0

    def writable(self):
        return True

    def write(self, b):
        self.hash.update(b)
        self.bytes += len(b)
        return self._ziel.write(b)


async def _datenbank_schreiben(zf: zipfile.ZipFile, conn) -> tuple[dict, dict]:
    """Alle Tabellen als NDJSON in die Sicherung. Eine Zeile je Datensatz:
    `{"t": "<tabelle>", "r": {<spalte>: <wert>}}`.

    Bewusst **kein** `pg_dump`: das Image (`python:3.12-slim`) bringt keinen
    Postgres-Client mit, und eine Sicherung, die nur läuft, wenn jemand
    zusätzlich ein Paket installiert, ist keine. Der logische Auszug über die
    Modell-Metadaten läuft überall, wo Nuvora läuft — auch auf SQLite, weshalb
    er im Test überhaupt prüfbar ist. Preis: er sichert Nuvoras eigene Tabellen,
    nicht Rollen oder Erweiterungen der Datenbank. Die legt `create_all` beim
    Start ohnehin neu an.
    """
    zaehlung: dict[str, int] = {}
    roh = zf.open("datenbank.ndjson", "w")
    zaehler = _Zaehler(roh)
    for tabelle in Base.metadata.sorted_tables:
        n = 0
        stmt = select(tabelle)
        try:
            ergebnis = await conn.stream(stmt)
            async for row in ergebnis:
                zaehler.write(_zeile(tabelle.name, row))
                n += 1
        except Exception:
            # Nicht jeder Treiber kann Server-Cursor; dann eben am Stück.
            ergebnis = await conn.execute(stmt)
            for row in ergebnis:
                zaehler.write(_zeile(tabelle.name, row))
                n += 1
        zaehlung[tabelle.name] = n
    roh.close()
    return zaehlung, {"bytes": zaehler.bytes, "sha256": zaehler.hash.hexdigest()}


def _zeile(tabelle: str, row) -> bytes:
    daten = {k: _kodiere(v) for k, v in row._mapping.items()}
    return (json.dumps({"t": tabelle, "r": daten}, ensure_ascii=False) + "\n").encode("utf-8")


def _datei_dazu(zf: zipfile.ZipFile, pfad: str, name_im_zip: str, dateien: dict):
    h = hashlib.sha256()
    groesse = 0
    with open(pfad, "rb") as f:
        with zf.open(name_im_zip, "w") as ziel:
            while True:
                brocken = f.read(1024 * 256)
                if not brocken:
                    break
                h.update(brocken)
                groesse += len(brocken)
                ziel.write(brocken)
    dateien[name_im_zip] = {"bytes": groesse, "sha256": h.hexdigest()}


def _dialekt(conn) -> str:
    try:
        return conn.engine.dialect.name
    except Exception:
        return "unbekannt"


def _version() -> str:
    try:
        from ..main import APP_VERSION
        return APP_VERSION
    except Exception:
        return "0.0.0"


async def sicherung_erstellen(db, ziel: str | None = None) -> dict:
    """Erzeugt eine Sicherung und gibt ihren Listeneintrag zurück.

    `db` ist die laufende Sitzung — die Tabellen werden über deren Verbindung
    gelesen. Bewusst nicht über die globale Engine: so hängt die Sicherung an
    derselben Datenbank wie der Rest der Anfrage, und der Test kann sie über
    `dependency_overrides` auf seine eigene umlenken statt eine zweite,
    unbeteiligte Datei zu sichern.
    """
    ziel = ziel or await aktuelles_ziel(db)
    conn = await db.connection()
    ordner = _ordner(ziel)
    stamm = "nuvora-" + datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    # Hoechste vorhandene Laufnummer + 1 — nicht die erste freie. Sonst bekaeme
    # eine neue Sicherung den Namen einer gerade weggeraeumten und waere damit
    # nach dem Namen die aelteste.
    vorhanden = [n for n in os.listdir(ordner)
                 if n.startswith(stamm) and DATEI_MUSTER.fullmatch(n)]
    lauf = max((_laufnummer(n) for n in vorhanden), default=0) + 1
    name = stamm + (".zip" if lauf == 1 else f"-{lauf}.zip")
    endziel = os.path.join(ordner, name)

    fd, temp = tempfile.mkstemp(dir=ordner, prefix=".teil-", suffix=".zip")
    os.close(fd)
    try:
        dateien: dict = {}
        uploads_bytes = 0
        with zipfile.ZipFile(temp, "w", zipfile.ZIP_DEFLATED) as zf:
            zaehlung, db_info = await _datenbank_schreiben(zf, conn)
            dateien["datenbank.ndjson"] = db_info

            # Upload-Ordner (Frage-Bilder/-SVGs) — rekursiv, damit spätere
            # Unterordner nicht still fehlen.
            if os.path.isdir(UPLOAD_DIR):
                for wurzel, _dirs, namen in os.walk(UPLOAD_DIR):
                    for n in sorted(namen):
                        voll = os.path.join(wurzel, n)
                        if not os.path.isfile(voll):
                            continue
                        rel = os.path.relpath(voll, UPLOAD_DIR).replace(os.sep, "/")
                        _datei_dazu(zf, voll, "uploads/" + rel, dateien)
                        uploads_bytes += dateien["uploads/" + rel]["bytes"]

            # Betreiberdaten
            site = os.path.join(CONFIG_DIR, "site.json")
            if os.path.isfile(site):
                _datei_dazu(zf, site, "config/site.json", dateien)

            manifest = {
                "format": 1,
                "erzeugt": datetime.now(timezone.utc).isoformat(),
                "nuvora": _version(),
                "datenbank": _dialekt(conn),
                "methode": "ndjson",
                "tabellen": zaehlung,
                "zeilen": sum(zaehlung.values()),
                "uploads_anzahl": sum(1 for k in dateien if k.startswith("uploads/")),
                "uploads_bytes": uploads_bytes,
                "config": "config/site.json" in dateien,
                "dateien": dateien,
                "enthaelt_secrets": False,
            }
            zf.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=1))

        os.chmod(temp, 0o600)
        os.replace(temp, endziel)
    except Exception:
        try:
            os.remove(temp)
        except OSError:
            pass
        raise

    summe = _sha256_datei(endziel)
    with open(endziel + ".sha256", "w", encoding="utf-8") as f:
        f.write(f"{summe}  {name}\n")
    os.chmod(endziel + ".sha256", 0o600)

    aufraeumen(ziel)
    return _eintrag(ordner, name, ziel)


def _sha256_datei(pfad: str) -> str:
    h = hashlib.sha256()
    with open(pfad, "rb") as f:
        for brocken in iter(lambda: f.read(1024 * 256), b""):
            h.update(brocken)
    return h.hexdigest()


def _eintrag(ordner: str, name: str, ziel: str) -> dict:
    voll = os.path.join(ordner, name)
    st = os.stat(voll)
    summe = ""
    try:
        with open(voll + ".sha256", encoding="utf-8") as f:
            summe = f.read().split()[0]
    except (OSError, IndexError):
        summe = ""
    return {
        "name": name,
        "zeit": datetime.fromtimestamp(st.st_mtime, timezone.utc).isoformat(),
        "bytes": st.st_size,
        "sha256": summe,
        "ziel": ziel,
    }


def liste(ziel: str) -> list[dict]:
    ordner = _pfad_fuer(ziel)
    if not os.path.isdir(ordner):
        return []
    namen = [n for n in os.listdir(ordner) if DATEI_MUSTER.fullmatch(n)]
    # Nach Aenderungszeit, neueste zuerst — nicht nach Namen: mit dem Zaehler
    # (…-2.zip) sortiert der Name falsch herum, und genau daran haengt die
    # Aufbewahrung.
    eintraege = [_eintrag(ordner, n, ziel) for n in namen]
    eintraege.sort(key=lambda e: (e["zeit"], _laufnummer(e["name"])), reverse=True)
    return eintraege


def _laufnummer(name: str) -> int:
    """Der Zaehler hinter dem Zeitstempel — als Zahl, nicht als Text.

    Als Text sortiert `nuvora-…-113828.zip` VOR `nuvora-…-113828-2.zip`
    (`.` > `-`), also ausgerechnet die aeltere als die neuere. Die Aufbewahrung
    haette dann die falsche geloescht.
    """
    stamm = name[:-len(".zip")]
    teil = stamm.rsplit("-", 1)[-1]
    return int(teil) if stamm.count("-") == 3 and teil.isdigit() else 1


def _loeschen(ordner: str, name: str):
    for p in (os.path.join(ordner, name), os.path.join(ordner, name + ".sha256")):
        try:
            os.remove(p)
        except OSError:
            pass


def aufraeumen(ziel: str) -> list[str]:
    """Aufbewahrung durchsetzen: höchstens KEEP Stück, höchstens MAX_MB gesamt.

    Vorbild ist der Papierkorb-Aufräumjob in `main.py` — Frist im Code, nicht im
    Kopf des Betreibers. Die jüngste Sicherung bleibt immer stehen, auch wenn
    sie allein schon über der Größengrenze liegt: eine Grenze ist kein Grund,
    ohne Sicherung dazustehen.
    """
    ordner = _pfad_fuer(ziel)
    if not os.path.isdir(ordner):
        return []
    eintraege = liste(ziel)  # neueste zuerst
    weg: list[str] = []
    behalten: list[dict] = []
    summe = 0
    for i, e in enumerate(eintraege):
        if i == 0:
            behalten.append(e)
            summe += e["bytes"]
            continue
        if len(behalten) >= KEEP or summe + e["bytes"] > MAX_MB * 1024 * 1024:
            weg.append(e["name"])
        else:
            behalten.append(e)
            summe += e["bytes"]
    for n in weg:
        _loeschen(ordner, n)
    # Angefangene Sicherungen eines abgebrochenen Laufs nicht liegen lassen.
    for n in os.listdir(ordner):
        if n.startswith(".teil-"):
            try:
                os.remove(os.path.join(ordner, n))
            except OSError:
                pass
    return weg


# ── Prüfen: eine Sicherung, die nie geprüft wurde, ist keine ─────────────────
def pruefen(ziel: str, name: str) -> dict:
    """Integritätsprüfung ohne Zurückspielen: Prüfsumme der Datei, Prüfsummen
    jedes Eintrags im Manifest, Vollständigkeit, Inhaltsverzeichnis."""
    ordner = _pfad_fuer(ziel)
    voll = os.path.join(ordner, name)
    if not os.path.isfile(voll):
        raise HTTPException(404, "Sicherung nicht gefunden")
    fehler: list[str] = []

    erwartet = ""
    try:
        with open(voll + ".sha256", encoding="utf-8") as f:
            erwartet = f.read().split()[0]
    except (OSError, IndexError):
        fehler.append("Keine Prüfsumme hinterlegt (.sha256 fehlt)")
    tatsaechlich = _sha256_datei(voll)
    if erwartet and erwartet != tatsaechlich:
        fehler.append("Prüfsumme der Datei stimmt nicht — die Sicherung ist beschädigt")

    manifest: dict = {}
    try:
        with zipfile.ZipFile(voll) as zf:
            kaputt = zf.testzip()
            if kaputt:
                fehler.append(f"Beschädigter Eintrag im Archiv: {kaputt}")
            namen = set(zf.namelist())
            for p in PFLICHT_EINTRAEGE:
                if p not in namen:
                    fehler.append(f"Pflichteintrag fehlt: {p}")
            if "manifest.json" in namen:
                manifest = json.loads(zf.read("manifest.json"))
                for eintrag, info in (manifest.get("dateien") or {}).items():
                    if eintrag not in namen:
                        fehler.append(f"Im Manifest genannt, aber nicht enthalten: {eintrag}")
                        continue
                    h = hashlib.sha256()
                    groesse = 0
                    with zf.open(eintrag) as f:
                        for brocken in iter(lambda: f.read(1024 * 256), b""):
                            h.update(brocken)
                            groesse += len(brocken)
                    if h.hexdigest() != info.get("sha256"):
                        fehler.append(f"Prüfsumme weicht ab: {eintrag}")
                    elif groesse != info.get("bytes"):
                        fehler.append(f"Größe weicht ab: {eintrag}")
                # Eine Sicherung ohne Schülertabelle ist verdächtig leer.
                if not (manifest.get("tabellen") or {}):
                    fehler.append("Manifest nennt keine einzige Tabelle")
    except Exception as e:  # noqa: BLE001
        # Bewusst breit: ein beschaedigtes Archiv kommt je nach Stelle als
        # BadZipFile, zlib.error, EOFError oder UnicodeDecodeError heraus. Die
        # Pruefung darf daran nicht selbst sterben — sie soll es MELDEN.
        fehler.append(f"Archiv nicht lesbar ({type(e).__name__}): {e}")

    return {
        "ok": not fehler,
        "name": name,
        "sha256": tatsaechlich,
        "fehler": fehler,
        "erzeugt": manifest.get("erzeugt", ""),
        "nuvora": manifest.get("nuvora", ""),
        "zeilen": manifest.get("zeilen", 0),
        "tabellen": manifest.get("tabellen", {}),
        "uploads_anzahl": manifest.get("uploads_anzahl", 0),
        "config": manifest.get("config", False),
    }


# ── Zurückspielen ────────────────────────────────────────────────────────────
async def zurueckspielen(zip_pfad: str, ziel_url: str, uploads_nach: str | None = None) -> dict:
    """Spielt eine Sicherung in die Datenbank unter `ziel_url` zurück.

    **Löscht dort vorher alle Zeilen der Nuvora-Tabellen.** Deshalb nimmt die
    Funktion die Ziel-URL ausdrücklich entgegen, statt stillschweigend die
    laufende Datenbank zu nehmen: in eine Wegwerf-Datenbank zurückspielen und
    nachsehen ist der Normalfall, das Produktivsystem überschreiben die
    Ausnahme.

    Genau diese Funktion probt `tests/test_backup.py` — dort wird eine echte
    Sicherung in eine leere SQLite-Datenbank geladen und Zeile für Zeile
    verglichen. Die Schritte von Hand stehen in `anleitung()`.
    """
    from sqlalchemy.ext.asyncio import create_async_engine

    ziel_engine = create_async_engine(ziel_url)
    zaehlung: dict[str, int] = {}
    try:
        async with ziel_engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
            for tabelle in reversed(Base.metadata.sorted_tables):
                await conn.execute(tabelle.delete())

        with zipfile.ZipFile(zip_pfad) as zf:
            manifest = json.loads(zf.read("manifest.json"))
            tabellen = {t.name: t for t in Base.metadata.sorted_tables}
            # In FK-Reihenfolge einfügen: die NDJSON steht schon so da, weil sie
            # aus `sorted_tables` geschrieben wurde. Trotzdem gepuffert je
            # Tabelle, damit eine später umsortierte Datei nicht scheitert.
            eimer: dict[str, list] = {}
            with zf.open("datenbank.ndjson") as f:
                for zeile in io.TextIOWrapper(f, encoding="utf-8"):
                    zeile = zeile.strip()
                    if not zeile:
                        continue
                    satz = json.loads(zeile)
                    eimer.setdefault(satz["t"], []).append(
                        {k: _dekodiere(v) for k, v in satz["r"].items()}
                    )
            async with ziel_engine.begin() as conn:
                for name, tabelle in tabellen.items():
                    zeilen = eimer.get(name) or []
                    if not zeilen:
                        zaehlung[name] = 0
                        continue
                    for i in range(0, len(zeilen), 500):
                        await conn.execute(tabelle.insert(), zeilen[i:i + 500])
                    zaehlung[name] = len(zeilen)
                unbekannt = set(eimer) - set(tabellen)
                if unbekannt:
                    # Kein Abbruch: eine Sicherung aus einer älteren Fassung darf
                    # Tabellen enthalten, die es nicht mehr gibt. Aber sagen.
                    zaehlung["_uebersprungen"] = len(unbekannt)

            # Postgres: Sequenzen nachziehen, sonst kollidiert die erste
            # Neuanlage mit einer zurückgespielten ID.
            if ziel_engine.dialect.name == "postgresql":
                from sqlalchemy import text
                async with ziel_engine.begin() as conn:
                    for name, tabelle in tabellen.items():
                        pk = list(tabelle.primary_key.columns)
                        if len(pk) != 1 or not str(pk[0].type).upper().startswith("INTEGER"):
                            continue
                        await conn.execute(text(
                            f"SELECT setval(pg_get_serial_sequence('{name}', '{pk[0].name}'), "
                            f"COALESCE((SELECT MAX({pk[0].name}) FROM {name}), 1), true)"
                        ))

        # Uploads zurücklegen (Frage-Bilder). Nur wenn ausdrücklich gewünscht —
        # in eine Wegwerf-Datenbank gehören keine Dateien.
        dateien = 0
        if uploads_nach:
            os.makedirs(uploads_nach, exist_ok=True)
            with zipfile.ZipFile(zip_pfad) as zf:
                for eintrag in zf.namelist():
                    if not eintrag.startswith("uploads/") or eintrag.endswith("/"):
                        continue
                    rel = eintrag[len("uploads/"):]
                    ziel_datei = os.path.normpath(os.path.join(uploads_nach, rel))
                    if not ziel_datei.startswith(os.path.abspath(uploads_nach)):
                        continue  # Zip-Slip
                    os.makedirs(os.path.dirname(ziel_datei), exist_ok=True)
                    with zf.open(eintrag) as q, open(ziel_datei, "wb") as z:
                        shutil.copyfileobj(q, z)
                    dateien += 1

        return {"tabellen": zaehlung, "zeilen": sum(v for k, v in zaehlung.items() if not k.startswith("_")),
                "dateien": dateien, "manifest": manifest}
    finally:
        await ziel_engine.dispose()


def anleitung() -> list[str]:
    """Zurückspielen von Hand — Schritt für Schritt, wie in der Oberfläche."""
    return [
        "1. Sicherung herunterladen und die Prüfsumme vergleichen: "
        "shasum -a 256 nuvora-JJJJMMTT-HHMMSS.zip",
        "2. Datei auf den Server legen: "
        "scp nuvora-*.zip <server>:<pfad>/ und in den api-Container kopieren: "
        "docker compose cp nuvora-*.zip api:/tmp/sicherung.zip",
        "3. Erst in eine Wegwerf-Datenbank zurückspielen und nachsehen: "
        "docker compose exec api python -m app.routers.backup /tmp/sicherung.zip "
        "sqlite+aiosqlite:////tmp/probe.db",
        "4. Erst wenn Schritt 3 die erwarteten Zeilenzahlen meldet, in die echte "
        "Datenbank: docker compose exec api python -m app.routers.backup "
        "/tmp/sicherung.zip \"$DATABASE_URL\" --uploads /app/uploads "
        "(löscht vorher alle Zeilen der Nuvora-Tabellen)",
        "5. config/site.json aus dem Archiv zurück ins Wurzelverzeichnis legen "
        "(steckt im ZIP unter config/site.json) und ./deploy.sh laufen lassen — "
        "der Selbsttest sagt danach, ob die Installation wieder steht.",
        "Nicht enthalten und nicht ersetzbar: die .env (TOKEN_SECRET, "
        "POSTGRES_PASSWORD). Die gehört getrennt aufbewahrt — ein neues "
        "TOKEN_SECRET meldet alle angemeldeten Geräte ab, ist sonst aber harmlos.",
    ]


# ── Zeitplan ─────────────────────────────────────────────────────────────────
async def _faellig(plan: str, letzte: str) -> bool:
    if plan not in ("taeglich", "woechentlich"):
        return False
    if not letzte:
        return True
    try:
        zeit = datetime.fromisoformat(letzte)
    except ValueError:
        return True
    if zeit.tzinfo is None:
        zeit = zeit.replace(tzinfo=timezone.utc)
    alter = (datetime.now(timezone.utc) - zeit).total_seconds()
    return alter >= (86400 if plan == "taeglich" else 7 * 86400)


async def _lauf():
    """Eine geplante Sicherung — Ergebnis landet in app_settings, damit die
    Oberfläche sagen kann, wann es zuletzt lief und ob es klappte."""
    async with async_session() as db:
        plan = await _lies(db, "backup_plan", "aus")
        letzte = await _lies(db, "backup_letzte_zeit", "")
        if not await _faellig(plan, letzte):
            return
        jetzt = datetime.now(timezone.utc).isoformat()
        try:
            eintrag = await sicherung_erstellen(db)
            ok, name, fehler = "1", eintrag["name"], ""
        except Exception as e:  # noqa: BLE001 — der Grund gehört in die Anzeige
            ok, name, fehler = "0", "", f"{type(e).__name__}: {e}"[:200]
        await _schreib(db, "backup_letzte_zeit", jetzt)
        await _schreib(db, "backup_letzte_ok", ok)
        await _schreib(db, "backup_letzte_name", name)
        await _schreib(db, "backup_letzte_fehler", fehler)
        await db.commit()


async def plan_loop():
    """Stündlich nachsehen, ob eine geplante Sicherung fällig ist.

    Stündlich statt „um 3 Uhr": ein Container, der nachts neu startet, würde
    einen festen Zeitpunkt verpassen und wochenlang stillschweigend nichts
    sichern. Vorbild: `_papierkorb_loop` in main.py.
    """
    while True:
        try:
            await _lauf()
        except Exception:
            pass
        await asyncio.sleep(3600)


# ── API ──────────────────────────────────────────────────────────────────────
async def nur_admin(user=Depends(get_current_user)):
    """Sicherungen enthalten DSGVO-Art.-9-Daten — nur die Administration.

    `_require_admin` steht in main.py, das seinerseits diesen Router importiert;
    deshalb der Import zur Laufzeit statt oben. Eine eigene Kopie der Prüfung
    wäre die Stelle, an der die beiden eines Tages auseinanderlaufen.
    """
    from ..main import _require_admin
    return await _require_admin(user)


class Einstellungen(BaseModel):
    ziel: str | None = None
    plan: str | None = None


@router.get("")
async def status(user=Depends(nur_admin), db=Depends(get_db)):
    ziel = await aktuelles_ziel(db)
    plan = await _lies(db, "backup_plan", "aus")
    letzte_zeit = await _lies(db, "backup_letzte_zeit", "")
    letzte_ok = await _lies(db, "backup_letzte_ok", "")
    letzte_name = await _lies(db, "backup_letzte_name", "")
    letzte_fehler = await _lies(db, "backup_letzte_fehler", "")
    ordner = _pfad_fuer(ziel)
    eintraege = liste(ziel)
    return {
        "ziel": ziel,
        "ziele": ziele(),
        "plan": plan if plan in PLAENE else "aus",
        "plaene": list(PLAENE),
        "verzeichnis": ordner,
        # Liegt der Ordner auf einem eigenen Volume? Wenn nicht, ist jede
        # Sicherung beim naechsten `--build` weg — das muss dranstehen.
        "dauerhaft": os.path.ismount(ordner),
        "aufbewahrung": {"anzahl": KEEP, "max_mb": MAX_MB},
        "verschluesselt": False,
        "sicherungen": eintraege,
        "belegt_bytes": sum(e["bytes"] for e in eintraege),
        "letzte": {
            "zeit": letzte_zeit,
            "ok": letzte_ok == "1",
            "name": letzte_name,
            "fehler": letzte_fehler,
        } if letzte_zeit else None,
        "anleitung": anleitung(),
        "inhalt": ["Datenbank (inkl. Schülerfotos, Karten- und Materialdateien)",
                   "Upload-Ordner (Frage-Bilder)",
                   "config/site.json"],
        "nicht_enthalten": [".env (TOKEN_SECRET, POSTGRES_PASSWORD) — bewusst getrennt"],
    }


@router.post("", status_code=201)
async def jetzt_sichern(user=Depends(nur_admin), db=Depends(get_db)):
    jetzt = datetime.now(timezone.utc).isoformat()
    try:
        eintrag = await sicherung_erstellen(db)
    except Exception as e:  # noqa: BLE001
        await _schreib(db, "backup_letzte_zeit", jetzt)
        await _schreib(db, "backup_letzte_ok", "0")
        await _schreib(db, "backup_letzte_name", "")
        await _schreib(db, "backup_letzte_fehler", f"{type(e).__name__}: {e}"[:200])
        await db.commit()
        raise HTTPException(500, f"Sicherung fehlgeschlagen: {e}")
    await _schreib(db, "backup_letzte_zeit", jetzt)
    await _schreib(db, "backup_letzte_ok", "1")
    await _schreib(db, "backup_letzte_name", eintrag["name"])
    await _schreib(db, "backup_letzte_fehler", "")
    await db.commit()
    return eintrag


@router.put("/einstellungen")
async def einstellungen(body: Einstellungen, user=Depends(nur_admin), db=Depends(get_db)):
    if body.ziel is not None:
        passend = {z["key"]: z for z in ziele()}.get(body.ziel)
        if not passend:
            raise HTTPException(400, "Unbekanntes Ziel")
        if not passend["verfuegbar"]:
            raise HTTPException(400, passend["grund"] or "Ziel nicht verfügbar")
        await _schreib(db, "backup_ziel", body.ziel)
    if body.plan is not None:
        if body.plan not in PLAENE:
            raise HTTPException(400, "Unbekannter Zeitplan")
        await _schreib(db, "backup_plan", body.plan)
    await db.commit()
    return await status(user, db)


@router.get("/{name}")
async def herunterladen(name: str, user=Depends(nur_admin), db=Depends(get_db)):
    name = _sicher(name)
    voll = os.path.join(_pfad_fuer(await aktuelles_ziel(db)), name)
    if not os.path.isfile(voll):
        raise HTTPException(404, "Sicherung nicht gefunden")
    return FileResponse(
        voll,
        media_type="application/zip",
        filename=name,
        headers={"Cache-Control": "no-store, private"},
    )


@router.post("/{name}/pruefen")
async def pruefung(name: str, user=Depends(nur_admin), db=Depends(get_db)):
    return pruefen(await aktuelles_ziel(db), _sicher(name))


@router.delete("/{name}", status_code=204)
async def entfernen(name: str, user=Depends(nur_admin), db=Depends(get_db)):
    name = _sicher(name)
    ordner = _pfad_fuer(await aktuelles_ziel(db))
    if not os.path.isfile(os.path.join(ordner, name)):
        raise HTTPException(404, "Sicherung nicht gefunden")
    _loeschen(ordner, name)
    return None


# ── Kommandozeile: zurückspielen ─────────────────────────────────────────────
if __name__ == "__main__":  # pragma: no cover — Betriebswerkzeug
    import sys

    argumente = sys.argv[1:]
    if len(argumente) < 2:
        print("Aufruf: python -m app.routers.backup <sicherung.zip> <ziel-url> [--uploads <ordner>]")
        print("\n".join(anleitung()))
        raise SystemExit(2)
    zip_pfad, ziel_url = argumente[0], argumente[1]
    uploads = argumente[argumente.index("--uploads") + 1] if "--uploads" in argumente else None
    bericht = asyncio.run(zurueckspielen(zip_pfad, ziel_url, uploads))
    print(json.dumps({k: v for k, v in bericht.items() if k != "manifest"}, indent=1, ensure_ascii=False))
