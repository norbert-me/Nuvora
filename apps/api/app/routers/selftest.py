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
import asyncio
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
    if mailer.email_configured():
        _check_mail(out)

    admin_email = (os.environ.get("ADMIN_EMAIL") or "").strip()
    out.append(Check(gruppe="Konfiguration", name="ADMIN_EMAIL", ok="@" in admin_email,
                     schwere="warnung",
                     detail=admin_email or "nicht gesetzt — Kontaktformular hat keinen Empfaenger"))


def _check_mail(out: List[Check]) -> None:
    """Kommt Post wirklich raus? Jede Stufe einzeln, bis zur Absender-Freigabe.

    "SMTP konfiguriert" sagt nur, dass Werte in der .env stehen. Scheitert der
    Versand, scheitert er still im Hintergrund (mailer.send_email wirft nie) —
    die Registrierung bleibt haengen, und niemand erfaehrt, woran. Deshalb hier
    Stufe fuer Stufe, jede mit dem Klartext des Mailservers:

      1. Host aufloesen        (Tippfehler im Hostnamen)
      2. Verbinden             (Port, Firewall)
      3. Anmelden              (SMTP_USER/SMTP_PASSWORD)
      4. Absender anbieten     (MAIL FROM/RCPT TO — hier sagen die meisten
                                Relays, wenn SMTP_FROM nicht freigegeben ist)
      5. SPF und DMARC im DNS  (ohne die weisen Relays und Empfaenger ab)

    Es wird KEINE Mail verschickt: nach RCPT TO folgt RSET, nie DATA.
    """
    import smtplib
    import socket
    import ssl

    host = (os.environ.get("SMTP_HOST") or "").strip()
    port = int((os.environ.get("SMTP_PORT") or "465").strip() or 465)
    user = (os.environ.get("SMTP_USER") or "").strip()
    passwort = os.environ.get("SMTP_PASSWORD") or ""
    absender = (os.environ.get("SMTP_FROM") or "").strip()
    # Empfaenger der Probe: die Administration. Es geht nichts raus, die Adresse
    # wird nur angeboten.
    empfaenger = (os.environ.get("ADMIN_EMAIL") or "").strip() or absender

    def fehler(name, detail, schwere="fehler"):
        out.append(Check(gruppe="E-Mail", name=name, ok=False, detail=detail, schwere=schwere))

    try:
        socket.getaddrinfo(host, port)
    except Exception:
        return fehler("Host", f"'{host}' laesst sich nicht aufloesen — Tippfehler im "
                              "Hostnamen? Ohne ihn kommt keine einzige Mail an.")
    out.append(Check(gruppe="E-Mail", name="Host", ok=True, detail=f"{host} loest auf"))

    ctx = ssl.create_default_context()
    try:
        if port == 465:
            server = smtplib.SMTP_SSL(host, port, context=ctx, timeout=10)
        else:
            server = smtplib.SMTP(host, port, timeout=10)
            server.ehlo()
            server.starttls(context=ctx)
            server.ehlo()
    except Exception as e:
        return fehler("Verbindung", f"{host}:{port} nimmt keine Verbindung an "
                                    f"({str(e)[:100]}) — Port oder Firewall pruefen.")
    out.append(Check(gruppe="E-Mail", name="Verbindung", ok=True, detail=f"{host}:{port} spricht SMTP"))

    try:
        if user:
            try:
                server.login(user, passwort)
                out.append(Check(gruppe="E-Mail", name="Anmeldung", ok=True,
                                 detail=f"{user} angenommen"))
            except Exception as e:
                return fehler("Anmeldung", f"Der Mailserver lehnt SMTP_USER/SMTP_PASSWORD ab: "
                                           f"{str(e)[:150]}")
        else:
            out.append(Check(gruppe="E-Mail", name="Anmeldung", ok=True, schwere="warnung",
                             detail="ohne SMTP_USER — Relay ohne Anmeldung"))

        # Absender anbieten. Genau hier meldet ein Relay ueblicherweise, dass
        # SMTP_FROM nicht freigegeben ist — die Fehlermeldung kommt woertlich
        # in den Bericht, damit niemand sie im Anbieter-Portal suchen muss.
        try:
            code, antwort = server.mail(absender)
            if code >= 400:
                return fehler("Absender", f"Der Mailserver lehnt SMTP_FROM '{absender}' ab: "
                                          f"{antwort.decode('utf-8', 'replace')[:150]} — "
                                          "Absender beim Anbieter freigeben oder Domain "
                                          "authentifizieren.")
            code, antwort = server.rcpt(empfaenger)
            if code >= 400:
                return fehler("Absender", f"Empfaenger '{empfaenger}' abgelehnt: "
                                          f"{antwort.decode('utf-8', 'replace')[:150]}")
            server.rset()
            out.append(Check(gruppe="E-Mail", name="Absender", ok=True,
                             detail=f"{absender} wird angenommen (keine Mail verschickt)"))
        except Exception as e:
            return fehler("Absender", f"Probe fehlgeschlagen: {str(e)[:150]}")
    finally:
        try:
            server.quit()
        except Exception:
            pass

    _check_absender_dns(absender, host, out)


def _dns_txt(name: str) -> list:
    """TXT-Eintraege ueber DNS-over-HTTPS. Leere Liste = nichts gefunden,
    None = nicht pruefbar (kein Netz zum Resolver).

    Bewusst ueber HTTPS statt mit einer DNS-Bibliothek: die API kommt ohne
    zusaetzliche Abhaengigkeit aus, und der Container spricht ohnehin nach
    draussen (Update-Check).
    """
    import json as _json
    import urllib.request

    try:
        req = urllib.request.Request(
            f"https://cloudflare-dns.com/dns-query?name={name}&type=TXT",
            headers={"Accept": "application/dns-json", "User-Agent": "Nuvora-Selbsttest"})
        with urllib.request.urlopen(req, timeout=6) as r:
            daten = _json.loads(r.read().decode("utf-8", "ignore"))
        return [a.get("data", "").strip('"') for a in (daten.get("Answer") or [])]
    except Exception:
        return None


def _check_absender_dns(absender: str, smtp_host: str, out: List[Check]) -> None:
    """SPF und DMARC der Absender-Domain.

    Ohne SPF-Freigabe fuer den Relay landen Mails im Spam oder werden ganz
    abgewiesen — beim Anbieter heisst das dann "authenticate your domain".
    Das ist im DNS pruefbar, also wird es hier geprueft und nicht dem Zufall
    ueberlassen.
    """
    domain = absender.split("@")[-1].strip().lower()
    if not domain:
        return
    # Relay-Host -> Kennungen, von denen mindestens eine im SPF stehen muss.
    # Gruppen, weil dieselbe Firma unter mehreren Namen auftaucht: Brevo hiess
    # Sendinblue, und beide Includes sind im Umlauf.
    ANBIETER = [
        ("brevo", "sendinblue"),
        ("sendgrid",),
        ("mailgun",),
        ("postmark", "postmarkapp"),
        ("mailjet",),
        ("cloudflare",),
        ("amazonses", "amazonaws"),
        ("google", "gmail"),
    ]
    relay = smtp_host.lower()
    gruppe = next((g for g in ANBIETER if any(k in relay for k in g)), ())

    spf = _dns_txt(domain)
    if spf is None:
        out.append(Check(gruppe="E-Mail", name="SPF", ok=True, schwere="warnung",
                         detail="nicht pruefbar (kein DNS-Zugriff nach draussen)"))
        return
    eintrag = next((t for t in spf if t.lower().startswith("v=spf1")), "")
    if not eintrag:
        out.append(Check(gruppe="E-Mail", name="SPF", ok=False,
                         detail=f"{domain} hat keinen SPF-Eintrag — Empfaenger sortieren die "
                                "Mails als Spam aus oder weisen sie ab."))
    elif gruppe and not any(k in eintrag.lower() for k in gruppe):
        out.append(Check(gruppe="E-Mail", name="SPF", ok=False,
                         detail=f"SPF von {domain} gibt {gruppe[0]} nicht frei ({eintrag[:90]}) — "
                                "genau das meint der Anbieter mit 'authenticate your domain'. "
                                "Absender freigeben oder den SPF-Eintrag ergaenzen."))
    else:
        out.append(Check(gruppe="E-Mail", name="SPF", ok=True, detail=eintrag[:90]))

    dmarc = _dns_txt("_dmarc." + domain)
    if dmarc is None:
        return
    hat = any(t.lower().startswith("v=dmarc1") for t in dmarc)
    out.append(Check(gruppe="E-Mail", name="DMARC", ok=hat, schwere="warnung",
                     detail="vorhanden" if hat else
                            f"{domain} hat keinen DMARC-Eintrag — empfohlen, sobald Nuvora "
                            "oeffentlich Mails verschickt."))


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
    # Der SMTP-Check verbindet sich (bis 5 s) — nicht im Event-Loop blockieren.
    await asyncio.to_thread(_check_config, checks)
    _check_site_json(checks)
    _check_module(request, checks)
    fehler = sum(1 for c in checks if not c.ok and c.schwere == "fehler")
    warnungen = sum(1 for c in checks if not c.ok and c.schwere == "warnung")
    return SelftestOut(ok=fehler == 0, fehler=fehler, warnungen=warnungen, checks=checks)
