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
import secrets
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..rollen import ist_admin
from ..database import get_db
from ..models import Base
from .auth import get_current_user
from .backup import BACKUP_DIR, BACKUP_DIR_EXTERN
from .modules import REGISTRY

router = APIRouter(prefix="/api/selftest", tags=["selftest"])


async def _require_admin(request: Request, db: AsyncSession = Depends(get_db)):
    """Administration — oder das Selbsttest-Token.

    Der Selbsttest laeuft nach jedem Deploy mit einem eigenen Konto, und das ist
    absichtlich nicht die Administration (er schreibt und loescht darin). Ohne
    zweiten Weg blieben genau die Pruefungen aus, die man am dringendsten
    braucht: Schema, Konfiguration, E-Mail-Versand. Deshalb zaehlt auch ein
    Geheimnis aus der Umgebung, gesetzt in der .env des Servers.
    """
    token = (os.environ.get("SELFTEST_TOKEN") or "").strip()
    mitgeschickt = (request.headers.get("X-Selftest-Token") or "").strip()
    if token and mitgeschickt and secrets.compare_digest(token, mitgeschickt):
        return None
    user = await get_current_user(request, Response(), db)
    if not ist_admin(user):
        raise HTTPException(403, "Nur für die Administration oder mit gültigem SELFTEST_TOKEN")
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
    "unterrichtsplanung": "/api/methoden",
    "notizbrett": "/api/notizblock",
    "code-detektiv": "/api/codedetektiv",
    "pap": "/api/pap",
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
        spalten, fks = {}, {}
        for t in inspector.get_table_names():
            spalten[t] = {c["name"] for c in inspector.get_columns(t)}
            for fk in inspector.get_foreign_keys(t):
                if len(fk["constrained_columns"]) == 1:
                    fks[(t, fk["constrained_columns"][0])] = \
                        ((fk.get("options") or {}).get("ondelete") or "NO ACTION").upper()
        return spalten, fks

    # Ueber den Inspector statt information_schema: derselbe Weg, den auch
    # _ensure_columns beim Start geht, und unabhaengig vom Datenbank-Dialekt.
    ist, ist_fks = await db.run_sync(lambda s: lies(s.connection()))

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

    # Fremdschluessel — die einzige Stelle, die die ECHTE Datenbank sieht.
    #
    # Namen zu vergleichen reicht nicht: eine per ALTER TABLE nachgezogene
    # Spalte heisst richtig und traegt trotzdem kein ON DELETE (siehe
    # _ensure_columns). Genau daran haengen Kontoloeschung (owner_id CASCADE,
    # Art. 17) und Themenloeschung (topic_id SET NULL). Bewusst nur eine
    # WARNUNG: nachruesten geht nur auf Postgres und erst beim naechsten Start —
    # ein Fehler wuerde den Selbsttest bis dahin rot faerben, ohne dass jemand
    # etwas falsch gemacht hat.
    fehlende_fks, falsche_fks = [], []
    for name, tabelle in Base.metadata.tables.items():
        if name not in ist:
            continue
        for spalte in tabelle.columns:
            if spalte.name not in ist[name]:
                continue
            for fk in spalte.foreign_keys:
                if not fk.ondelete:
                    continue
                soll = fk.ondelete.upper()
                hat = ist_fks.get((name, spalte.name))
                if hat is None:
                    fehlende_fks.append(f"{name}.{spalte.name} (ON DELETE {soll})")
                elif hat != soll:
                    falsche_fks.append(f"{name}.{spalte.name} ({hat} statt {soll})")
    schaeden = fehlende_fks + falsche_fks
    out.append(Check(
        gruppe="Schema", name="Fremdschluessel", ok=not schaeden, schwere="warnung",
        detail=(f"{len(schaeden)} ohne wirksames ON DELETE — Loeschungen raeumen dort nicht auf: "
                + ", ".join(sorted(schaeden)[:12]) + (" …" if len(schaeden) > 12 else ""))
               if schaeden else "alle ON-DELETE-Regeln der Modelle stehen in der Datenbank",
    ))


def _check_werkzeuge(out: List[Check]) -> None:
    """Externe Programme, auf die Funktionen bauen.

    LibreOffice wandelt Office-Dateien zum Ansehen nach PDF. Fehlt es, faellt
    genau diese Funktion aus — und zwar erst dann, wenn jemand im Unterricht auf
    seine Klassenarbeit klickt. Deshalb hier und nicht dort.
    """
    import shutil
    pfad = shutil.which("soffice") or shutil.which("libreoffice")
    out.append(Check(
        gruppe="Einrichtung", name="LibreOffice", ok=bool(pfad), schwere="warnung",
        detail=(f"{pfad} — Office-Dateien lassen sich im Browser ansehen" if pfad
                else "fehlt — Word/Excel/PowerPoint lassen sich nur herunterladen, nicht ansehen"),
    ))
    gs = shutil.which("gs")
    out.append(Check(
        gruppe="Einrichtung", name="Ghostscript", ok=bool(gs), schwere="warnung",
        detail=(f"{gs} — grosse PDFs werden fuer die Ansicht leichter gemacht" if gs
                else "fehlt — grosse PDFs werden in voller Groesse ausgeliefert (Ansicht laedt laenger)"),
    ))


def _check_config(out: List[Check]) -> None:
    # Die Fassung liest `admin.APP_VERSION` aus `apps/api/VERSION`. Fehlt die
    # Datei im Image, meldet der Server stillschweigend „0.0.0" — die Anzeige im
    # Profil stimmt dann nicht mehr und die Update-Pruefung haelt jede
    # Veroeffentlichung fuer neuer. Genau so war es unbemerkt ueber mehrere
    # Fassungen hinweg; deshalb steht es jetzt hier.
    from ..admin import APP_VERSION
    aktuell = APP_VERSION not in ("", "0.0.0")
    out.append(Check(gruppe="Konfiguration", name="Fassung", ok=aktuell,
                     detail=f"v{APP_VERSION}" if aktuell else
                            "0.0.0 — apps/api/VERSION fehlt im Image"))

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
        fehler("Host", f"'{host}' laesst sich nicht aufloesen — Tippfehler im "
                       "Hostnamen? Ohne ihn kommt keine einzige Mail an.")
        return
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
        fehler("Verbindung", f"{host}:{port} nimmt keine Verbindung an "
                             f"({str(e)[:100]}) — Port oder Firewall pruefen.")
        return
    out.append(Check(gruppe="E-Mail", name="Verbindung", ok=True, detail=f"{host}:{port} spricht SMTP"))

    try:
        if user:
            try:
                server.login(user, passwort)
                out.append(Check(gruppe="E-Mail", name="Anmeldung", ok=True,
                                 detail=f"{user} angenommen"))
            except Exception as e:
                fehler("Anmeldung", f"Der Mailserver lehnt SMTP_USER/SMTP_PASSWORD ab: "
                                    f"{str(e)[:150]}")
                return
        else:
            out.append(Check(gruppe="E-Mail", name="Anmeldung", ok=True, schwere="warnung",
                             detail="ohne SMTP_USER — Relay ohne Anmeldung"))

        # Absender anbieten. Genau hier meldet ein Relay ueblicherweise, dass
        # SMTP_FROM nicht freigegeben ist — die Fehlermeldung kommt woertlich
        # in den Bericht, damit niemand sie im Anbieter-Portal suchen muss.
        try:
            code, antwort = server.mail(absender)
            if code >= 400:
                fehler("Absender", f"Der Mailserver lehnt SMTP_FROM '{absender}' ab: "
                                   f"{antwort.decode('utf-8', 'replace')[:150]} — "
                                   "Absender beim Anbieter freigeben oder Domain "
                                   "authentifizieren.")
                return
            code, antwort = server.rcpt(empfaenger)
            if code >= 400:
                fehler("Absender", f"Empfaenger '{empfaenger}' abgelehnt: "
                                   f"{antwort.decode('utf-8', 'replace')[:150]}")
                return
            server.rset()
            out.append(Check(gruppe="E-Mail", name="Absender", ok=True,
                             detail=f"{absender} wird angenommen (keine Mail verschickt)"))
        except Exception as e:
            fehler("Absender", f"Probe fehlgeschlagen: {str(e)[:150]}")
            return
    finally:
        try:
            server.quit()
        except Exception:
            # Bewusst still: das Ergebnis der Probe steht schon im Bericht. Ein
            # Fehler beim Verabschieden (Verbindung schon zu, Timeout) sagt
            # nichts ueber den Mailversand und darf ihn nicht rot faerben.
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


# Bekannte DKIM-Selektoren je Versanddienst. Ein Selektor ist der Name, unter
# dem der Dienst seinen oeffentlichen Schluessel in DER EIGENEN Domain ablegt
# (<selektor>._domainkey.<domain>). Ohne diese Liste liesse sich von aussen gar
# nicht feststellen, ob DKIM eingerichtet ist — raten kann man sie nicht.
DKIM_SELEKTOREN = {
    "brevo": ("brevo1", "brevo2", "mail"),
    "sendgrid": ("s1", "s2"),
    "mailgun": ("mailo", "k1", "smtp"),
    "postmark": ("pm",),
    "mailjet": ("mailjet",),
    "amazonses": ("selector1", "selector2"),
    "google": ("google",),
}


def _check_dkim(domain: str, gruppe: tuple) -> tuple:
    """Steht ein DKIM-Schluessel des Dienstes unter dieser Domain?

    Rueckgabe: (gefunden, wo). Kein Treffer heisst nicht zwingend "kein DKIM" —
    manche Dienste (Amazon SES) benutzen wechselnde Selektoren, die sich nicht
    raten lassen. Deshalb ist ein fehlender Treffer allein nie ein Fehler,
    sondern nur zusammen mit fehlender SPF-Freigabe.
    """
    selektoren = ()
    for schluessel, sel in DKIM_SELEKTOREN.items():
        if any(schluessel in k for k in gruppe):
            selektoren = sel
            break
    for sel in selektoren:
        eintraege = _dns_txt(f"{sel}._domainkey.{domain}")
        if not eintraege:
            continue
        if any("v=dkim1" in e.lower() or "p=" in e.lower() for e in eintraege):
            return True, f"{sel}._domainkey.{domain}"
    return False, ""


def _check_absender_dns(absender: str, smtp_host: str, out: List[Check]) -> None:
    """Ist die Absender-Domain fuer den Versanddienst beglaubigt? SPF, DKIM, DMARC.

    Wichtig und lange falsch geprueft: **SPF gilt der Envelope-Absenderdomain
    (Return-Path), nicht der From-Adresse.** Versanddienste wie Brevo setzen
    dort ihre eigene Domain ein und bouncen selbst — die eigene Domain muss
    deren Server also gar nicht per SPF freigeben. Die DMARC-Ausrichtung
    entsteht dann ueber **DKIM**: der Dienst signiert mit einem Schluessel, der
    unter der eigenen Domain im DNS steht (`<selektor>._domainkey.<domain>`),
    und damit stimmt die Domain im From mit der Signatur ueberein.

    Beglaubigt ist die Domain also, wenn **eines von beidem** gilt: SPF gibt den
    Dienst frei ODER DKIM ist fuer ihn eingerichtet. Vorher verlangte dieser
    Test SPF und meldete eine sauber per DKIM beglaubigte Domain als Fehler —
    ein Fehlalarm, der zu falschen Aenderungen am DNS verleitet.
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
    # Freemailer-Adressen als Absender: deren SPF kennt nur die eigenen Server
    # und wird nie einen Versanddienst nennen. Das ist kein Konfigurationsfehler,
    # den man beheben koennte — nur eine schlechtere Zustellung. Also Warnung
    # statt Fehler, damit der Selbsttest nicht dauerhaft rot steht.
    FREEMAILER = ("t-online.de", "gmail.com", "googlemail.com", "gmx.de", "gmx.net",
                  "web.de", "outlook.com", "hotmail.com", "yahoo.de", "yahoo.com",
                  "icloud.com", "posteo.de", "mailbox.org")
    frei = domain in FREEMAILER

    eintrag = next((t for t in spf if t.lower().startswith("v=spf1")), "")
    spf_ok = bool(eintrag) and (not gruppe or any(k in eintrag.lower() for k in gruppe))

    # DKIM: der zweite, bei Versanddiensten der WICHTIGERE Weg. Die Selektoren
    # sind je Anbieter fest — nur damit laesst sich ohne Postfach pruefen, ob
    # die Domain wirklich signiert wird.
    dkim_ok, dkim_wo = _check_dkim(domain, gruppe)

    if dkim_ok:
        out.append(Check(gruppe="E-Mail", name="DKIM", ok=True,
                         detail=f"{dkim_wo} — die Domain wird signiert, DMARC richtet darueber aus"))
    if not eintrag:
        out.append(Check(
            gruppe="E-Mail", name="SPF", ok=dkim_ok,
            schwere="warnung" if dkim_ok else "fehler",
            detail=(f"{domain} hat keinen SPF-Eintrag. Notwendig ist er hier nicht (DKIM "
                    "beglaubigt bereits), aber er kostet nichts und hilft bei Empfaengern, "
                    "die nur SPF auswerten.") if dkim_ok else
                   (f"{domain} hat weder SPF- noch DKIM-Eintrag — Empfaenger sortieren die "
                    "Mails als Spam aus oder weisen sie ab.")))
    elif not spf_ok:
        if dkim_ok:
            # KEIN Fehler: der Envelope-Absender gehoert dem Dienst, SPF wird
            # gegen dessen Domain geprueft. Frueher stand hier rot.
            out.append(Check(
                gruppe="E-Mail", name="SPF", ok=True,
                detail=f"nennt {gruppe[0] if gruppe else 'den Dienst'} nicht — hier in Ordnung: "
                       "SPF gilt dem Return-Path, den der Versanddienst auf seine eigene Domain "
                       "setzt. Beglaubigt wird ueber DKIM."))
        elif frei:
            out.append(Check(
                gruppe="E-Mail", name="SPF", ok=False, schwere="warnung",
                detail=f"{domain} ist ein Freemailer und gibt {gruppe[0]} nicht frei — das laesst "
                       "sich nicht aendern. Die Adresse muss beim Versanddienst einzeln "
                       "freigegeben sein, Mails landen oefter im Spam. Eigene Domain als "
                       "Absender waere zuverlaessiger."))
        else:
            out.append(Check(
                gruppe="E-Mail", name="SPF", ok=False,
                detail=f"weder SPF-Freigabe fuer {gruppe[0]} noch DKIM fuer {domain} gefunden "
                       f"({eintrag[:70]}) — genau das meint der Anbieter mit 'authenticate your "
                       "domain'. Entweder DKIM beim Anbieter einrichten (empfohlen) oder den "
                       "SPF-Eintrag ergaenzen."))
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


def _check_backup(out: List[Check]) -> None:
    """Laesst sich in den Sicherungsordner wirklich schreiben?

    Der Ordner ist ein benanntes Volume. Fehlt er im Image, legt Docker ihn beim
    Mounten als root:root an — der Dienst laeuft aber als nuvora (uid 10001) und
    bekommt beim ersten Schreiben "PermissionError: [Errno 13]". Genau so ist es
    passiert: Ordner da, Anzeige "0 von hoechstens 7", und erst die Sicherung
    selbst scheitert. Ein Backup, von dem man erst im Ernstfall erfaehrt, dass es
    keins gab, ist schlimmer als gar keine Sicherungsfunktion.

    Geprueft wird mit einer echten Probedatei, nicht mit os.access() — das fragt
    nur die Rechtebits ab und liegt bei ACLs, schreibgeschuetzten Mounts oder
    vollem Datentraeger falsch.
    """
    for pfad, name, pflicht in ((BACKUP_DIR, "Sicherungsordner", True),
                                (BACKUP_DIR_EXTERN, "Sicherungsordner (extern)", False)):
        if not pfad:
            continue
        schwere = "fehler" if pflicht else "warnung"
        if not os.path.isdir(pfad):
            out.append(Check(gruppe="Sicherung", name=name, ok=False, schwere=schwere,
                             detail=f"{pfad} gibt es nicht (Volume nicht gemountet?)"))
            continue
        probe = os.path.join(pfad, ".selbsttest-schreibprobe")
        try:
            with open(probe, "wb") as f:
                f.write(b"probe")
            os.remove(probe)
        except Exception as e:
            out.append(Check(
                gruppe="Sicherung", name=name, ok=False, schwere=schwere,
                detail=f"{pfad} ist nicht beschreibbar: {type(e).__name__} — "
                       f"Eigentuemer des Volumes pruefen (der Dienst laeuft als uid 10001)"))
            continue
        out.append(Check(gruppe="Sicherung", name=name, ok=True,
                         detail=f"{pfad} beschreibbar"))


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
    await asyncio.to_thread(_check_werkzeuge, checks)
    _check_site_json(checks)
    _check_backup(checks)
    _check_module(request, checks)
    fehler = sum(1 for c in checks if not c.ok and c.schwere == "fehler")
    warnungen = sum(1 for c in checks if not c.ok and c.schwere == "warnung")
    return SelftestOut(ok=fehler == 0, fehler=fehler, warnungen=warnungen, checks=checks)
