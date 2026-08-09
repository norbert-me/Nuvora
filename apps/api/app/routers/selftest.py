"""Nuvora-Kern: Selbsttest der Installation.

Prueft, was nur der Server selbst wissen kann: Datenbank, Schema gegen die
Modelle, Konfiguration, Betreiberdaten und ob zu jedem Modul im REGISTRY auch
wirklich Router gemountet sind.

Was von aussen pruefbar ist (Seiten, Statik, Modul-Endpunkte mit echtem
Schreib-Roundtrip), macht `scripts/selftest.py` — das laeuft nach dem Deploy.
Beide zusammen ergeben den vollstaendigen Selbsttest; dieser hier ist der Teil,
der Zugriff auf DB und Dateisystem braucht.

Nur fuer die Administration (User 1): die Antwort verraet Schema- und
Konfigurationszustand.
"""
import os
import pathlib
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import Base
from .auth import get_current_user
from .modules import REGISTRY

router = APIRouter(prefix="/api/selftest", tags=["selftest"])


async def _require_admin(user=Depends(get_current_user)):
    # Dieselbe Regel wie in main.py (User 1 ist die Administration) — hier
    # eigenstaendig, damit der Router nicht auf main.py zurueckimportiert.
    if user.id != 1:
        raise HTTPException(403, "Nur für die Administration")
    return user


class Check(BaseModel):
    gruppe: str
    name: str
    ok: bool
    # "fehler" bricht den Selbsttest, "warnung" wird nur berichtet (z.B. SMTP
    # fehlt auf einer Testinstanz — laestig, aber nicht kaputt).
    schwere: str = "fehler"
    detail: str = ""


class SelftestOut(BaseModel):
    ok: bool
    fehler: int
    warnungen: int
    checks: List[Check]


# Jedes Modul aus dem REGISTRY, das ein Backend hat, mit dem Prefix eines
# Routers, der dafuer gemountet sein MUSS. None = reines Frontend-Modul
# (Tafel, Mathespiele laufen ohne Server).
MODUL_PREFIX = {
    "cardvote": "/api/questions",
    "lernpfad": "/api/lernpfad",
    "auswertung": "/api/noten",
    "karten": "/api/karten",
    "kalender": "/api/kalender",
    "orga": "/api/orga",
    "zufall": "/api/zufall",
    "unterrichtsplanung": "/api/planung",
    "notizbrett": "/api/notizblock",
    "notizen": "/api/notizen",
    "klassenleitung": "/api/elternlog",
    "code-detektiv": "/api/codedetektiv",
    "tafel": None,
    "mathespiele": None,
}

# Betreiberdaten: ohne diese Felder ist das Impressum unvollstaendig.
SITE_PFLICHTFELDER = ["betreiber", "strasse", "plz_ort", "email"]


async def _check_db(db: AsyncSession, out: List[Check]) -> bool:
    try:
        await db.execute(text("SELECT 1"))
        out.append(Check(gruppe="Datenbank", name="Verbindung", ok=True))
        return True
    except Exception as e:
        out.append(Check(gruppe="Datenbank", name="Verbindung", ok=False, detail=str(e)[:200]))
        return False


async def _check_schema(db: AsyncSession, out: List[Check]) -> None:
    """Modelle gegen die echte Datenbank.

    Es gibt kein Alembic — das Schema entsteht aus create_all plus
    _ensure_columns. Genau deshalb muss geprueft werden, ob jede Spalte der
    Modelle auch wirklich in der Datenbank steht: neue Spalten auf bestehenden
    Tabellen kommen nur, wenn jemand sie in die wanted-Liste eingetragen hat.
    """
    def lies(sync_conn):
        from sqlalchemy import inspect as sa_inspect
        inspector = sa_inspect(sync_conn)
        return {t: {c["name"] for c in inspector.get_columns(t)}
                for t in inspector.get_table_names()}

    # Ueber den Inspector statt information_schema: derselbe Weg, den auch
    # _ensure_columns beim Start geht, und unabhaengig vom Datenbank-Dialekt.
    ist = await db.run_sync(lambda s: lies(s.connection()))

    fehlende_tabellen = [t for t in Base.metadata.tables if t not in ist]
    out.append(Check(
        gruppe="Schema", name="Tabellen", ok=not fehlende_tabellen,
        detail="fehlen: " + ", ".join(sorted(fehlende_tabellen)) if fehlende_tabellen else
               f"{len(Base.metadata.tables)} Tabellen vorhanden",
    ))

    fehlende_spalten = []
    for name, tabelle in Base.metadata.tables.items():
        if name not in ist:
            continue
        for spalte in tabelle.columns:
            if spalte.name not in ist[name]:
                fehlende_spalten.append(f"{name}.{spalte.name}")
    out.append(Check(
        gruppe="Schema", name="Spalten", ok=not fehlende_spalten,
        detail="fehlen (gehoeren in _ensure_columns): " + ", ".join(sorted(fehlende_spalten))
               if fehlende_spalten else "alle Modell-Spalten vorhanden",
    ))


def _check_config(out: List[Check]) -> None:
    for var in ("TOKEN_SECRET", "DATABASE_URL"):
        wert = (os.environ.get(var) or "").strip()
        out.append(Check(gruppe="Konfiguration", name=var, ok=bool(wert),
                         detail="gesetzt" if wert else "fehlt"))

    site_url = (os.environ.get("SITE_URL") or "").strip()
    out.append(Check(gruppe="Konfiguration", name="SITE_URL", ok=bool(site_url), schwere="warnung",
                     detail=site_url or "nicht gesetzt — Links in Mails zeigen ins Leere"))

    from .. import mailer
    out.append(Check(gruppe="Konfiguration", name="SMTP", ok=mailer.email_configured(),
                     schwere="warnung",
                     detail="konfiguriert" if mailer.email_configured() else
                            "unvollstaendig — Registrierung und Passwort-Reset gehen nicht"))

    admin_email = (os.environ.get("ADMIN_EMAIL") or "").strip()
    out.append(Check(gruppe="Konfiguration", name="ADMIN_EMAIL", ok="@" in admin_email,
                     schwere="warnung",
                     detail=admin_email or "nicht gesetzt — Kontaktformular hat keinen Empfaenger"))


def _check_site_json(out: List[Check]) -> None:
    pfad = pathlib.Path("/app/config/site.json")
    if not pfad.exists():
        out.append(Check(gruppe="Betreiberdaten", name="site.json", ok=False,
                         detail="fehlt unter /app/config/site.json (config-Mount pruefen)"))
        return
    try:
        import json
        daten = json.loads(pfad.read_text())
    except Exception as e:
        out.append(Check(gruppe="Betreiberdaten", name="site.json", ok=False,
                         detail=f"nicht lesbar: {str(e)[:120]}"))
        return
    leer = [f for f in SITE_PFLICHTFELDER if not str(daten.get(f) or "").strip()]
    out.append(Check(gruppe="Betreiberdaten", name="site.json", ok=not leer,
                     detail="leere Pflichtfelder: " + ", ".join(leer) if leer else
                            "vollstaendig (" + ", ".join(SITE_PFLICHTFELDER) + ")"))


def _check_module(request: Request, out: List[Check]) -> None:
    """Ein Modul existiert nur, wenn es Code dazu gibt — hier gegengeprueft.

    REGISTRY ist die Wahrheit fuer die Shell. Steht dort ein Modul, dessen
    Router niemand gemountet hat, landet die Lehrkraft auf einer Seite, deren
    API 404 liefert.
    """
    # Je nach FastAPI-Version stehen in app.routes die einzelnen Routen (aeltere
    # Fassungen flachen include_router aus) oder Platzhalter fuer den
    # eingehaengten Router (_IncludedRouter, ab 0.14x) — der traegt seine Pfade
    # erst unter original_router. Deshalb rekursiv durch beides gehen, sonst
    # meldet der Check auf einer der beiden Versionen alles als fehlend.
    def sammle(routen, raus, tiefe=0):
        if tiefe > 5:
            return raus
        for r in routen:
            pfad = getattr(r, "path", "") or getattr(r, "prefix", "")
            if pfad:
                raus.add(pfad)
            unter = getattr(r, "routes", None) or getattr(
                getattr(r, "original_router", None), "routes", None)
            if unter:
                sammle(unter, raus, tiefe + 1)
        return raus

    gemountet = sammle(request.app.routes, set())
    for mod in REGISTRY:
        prefix = MODUL_PREFIX.get(mod.key, "__unbekannt__")
        if prefix == "__unbekannt__":
            out.append(Check(gruppe="Module", name=mod.key, ok=False,
                             detail="steht im REGISTRY, aber nicht in MODUL_PREFIX (selftest.py) — "
                                    "beim Anlegen des Moduls vergessen"))
            continue
        if prefix is None:
            out.append(Check(gruppe="Module", name=mod.key, ok=True,
                             detail="reines Frontend-Modul, kein Backend noetig"))
            continue
        ok = any(p.startswith(prefix) for p in gemountet)
        out.append(Check(gruppe="Module", name=mod.key, ok=ok,
                         detail=f"Router {prefix} gemountet" if ok else
                                f"Router {prefix} FEHLT — Modul waere in der Shell tot"))


@router.get("", response_model=SelftestOut)
async def selftest(request: Request, db: AsyncSession = Depends(get_db),
                   user=Depends(_require_admin)):
    checks: List[Check] = []
    if await _check_db(db, checks):
        await _check_schema(db, checks)
    _check_config(checks)
    _check_site_json(checks)
    _check_module(request, checks)
    fehler = sum(1 for c in checks if not c.ok and c.schwere == "fehler")
    warnungen = sum(1 for c in checks if not c.ok and c.schwere == "warnung")
    return SelftestOut(ok=fehler == 0, fehler=fehler, warnungen=warnungen, checks=checks)
