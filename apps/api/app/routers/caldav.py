"""CalDAV-Server: den Kalender aus Apple und Outlook BESCHREIBEN.

Der Unterschied zum ICS-Abo (`/api/kalender/feed/…`) ist keine Feinheit,
sondern die ganze Sache: ein Abo wird geholt: der Client liest eine Datei und
bietet gar keinen „Termin hinzufuegen"-Knopf an. CalDAV ist dasselbe
Protokoll, das iCloud und Nextcloud sprechen — damit legt das Handy Termine an,
aendert und loescht sie, und sie stehen in Nuvora.

**Was in diesem Kalender liegt: nur die Kalender-Eintraege.** Freie Zeitraeume
und die wiederkehrenden Stundenplan-Stunden bleiben im ICS-Feed. CalDAV kennt
kein „dieses eine Ereignis ist schreibgeschuetzt"; waeren sie hier drin,
loeschte ein Wisch im Handy eine Stundenplan-Vorlage, die es als Ereignis gar
nicht gibt. Zwei Kalender im Handy sind ehrlicher als einer, der die Haelfte
nur so tut.

**Angemeldet wird mit einem Geraete-Passwort**, nie mit dem Kontopasswort:
Apple speichert die Zugangsdaten dauerhaft und schickt sie alle paar Minuten
mit, jahrelang, auf einem Geraet, das verloren gehen kann. Die Passwoerter
stehen in `caldav_tokens` und lassen sich einzeln zuruecknehmen.

**Der Zugang stirbt mit dem Modul.** Wie jeder ausgeteilte Zugang (QR-Code,
Sitzungscode) wird bei JEDEM Aufruf geprueft, ob das Modul Kalender noch an
ist — ein Geraet laesst sich nicht einsammeln.

Warum unter `/api/`: der Proxy leitet genau `/api/` und `/ws/` an die API,
alles andere an die Weboberflaeche. Apple sucht zuerst unter
`/.well-known/caldav`; dafuer steht in `nginx.conf` eine Weiterleitung hierher.
"""
import base64
import secrets
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import PlainTextResponse as _Text
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import caldav as X
from ..database import get_db
from ..models import CaldavToken, CalendarEntry, Kurs, SchoolClass, User
from ..zeit import tagesbeginn
from .auth import _hash_pw, _verify_pw, rate_limit
from .kalender import _kurs_label
from .modules import is_active, modul_pflicht

router = APIRouter(prefix="/api/caldav", tags=["caldav"])

MODULE_KEY = "kalender"
# Wie das Sammelverzeichnis im Client heisst.
KALENDER_NAME = "Nuvora"
# Der eine Kalender je Konto. Ein zweiter Name waere ein zweiter Kalender, und
# den gibt es hier bewusst nicht.
KALENDER = "kalender"

_DAV_KOPF = {
    # Ohne diese Kopfzeile haelt Apple den Server nicht fuer einen Kalender.
    "DAV": "1, 2, 3, calendar-access",
    "Cache-Control": "no-store",
}


def _pfad(user_id: int, name: str = "") -> str:
    basis = f"/api/caldav/p/{user_id}/{KALENDER}/"
    return basis + name if name else basis


# ─── Anmeldung ───

class _Unangemeldet(Exception):
    pass


async def _anmelden(request: Request, db: AsyncSession) -> User:
    """HTTP-Basic mit einem Geraete-Passwort.

    Basic ist hier kein Rueckschritt: CalDAV-Clients koennen nichts anderes,
    und die Verbindung laeuft ueber TLS. Der Schutz liegt darin, dass das
    Passwort NICHT das Kontopasswort ist und einzeln zurueckgenommen werden
    kann.
    """
    kopf = request.headers.get("authorization", "")
    if not kopf.lower().startswith("basic "):
        raise _Unangemeldet()
    try:
        roh = base64.b64decode(kopf[6:].strip()).decode("utf-8", "replace")
    except Exception:
        raise _Unangemeldet()
    if ":" not in roh:
        raise _Unangemeldet()
    kennung, passwort = roh.split(":", 1)

    # Bremse gegen Durchprobieren: ein CalDAV-Client meldet sich oft an, aber
    # nicht hundertmal in der Minute mit wechselnden Passwoertern.
    rate_limit("caldav", f"n{kennung.lower()[:80]}", 60, 60, "Zu viele Anmeldungen.")

    u = (await db.execute(select(User).where(User.email == kennung.strip().lower()))).scalar_one_or_none()
    if not u:
        raise _Unangemeldet()
    marken = (await db.execute(select(CaldavToken).where(CaldavToken.owner_id == u.id))).scalars().all()
    for m in marken:
        if _verify_pw(passwort, m.token_hash):
            m.last_used_at = datetime.now(timezone.utc)
            await db.commit()
            return u
    raise _Unangemeldet()


def _fordere_anmeldung() -> Response:
    return Response(status_code=401, headers={
        "WWW-Authenticate": f'Basic realm="{KALENDER_NAME}", charset="UTF-8"', **_DAV_KOPF})


async def _zugang(request: Request, db: AsyncSession):
    """(User, None) bei Erfolg, sonst (None, fertige Antwort)."""
    try:
        u = await _anmelden(request, db)
    except _Unangemeldet:
        return None, _fordere_anmeldung()
    if not await is_active(db, u.id, MODULE_KEY):
        # Dieselbe Regel wie bei jedem ausgeteilten Zugang: ein Geraet laesst
        # sich nicht einsammeln, also entscheidet der Server bei jedem Aufruf.
        return None, Response(status_code=403, headers=_DAV_KOPF)
    return u, None


# ─── Eintraege <-> Ressourcen ───

def _uid(e: CalendarEntry) -> str:
    """Die UID einer Ressource: die des Clients, sonst eine aus der ID."""
    return e.caldav_uid or f"nuvora-entry-{e.id}@nuvora"


def _dateiname(e: CalendarEntry) -> str:
    # Die UID kann alles Moegliche enthalten; im Pfad steht deshalb eine
    # entschaerfte Fassung. Eindeutig bleibt sie durch die angehaengte ID.
    sicher = "".join(c if c.isalnum() or c in "-_." else "-" for c in _uid(e))[:80]
    return f"{sicher}-{e.id}.ics"


async def _texte(db: AsyncSession, u: User, eintraege) -> dict:
    """Je Eintrag das fertige .ics — mit derselben Beschriftung wie ueberall
    („Fach · Kursname"), damit der Termin im Handy nicht anders heisst als im
    Browser."""
    kurse = {k.id: k for k in (await db.execute(select(Kurs).where(
        Kurs.owner_id == u.id, Kurs.deleted_at.is_(None)))).scalars().all()}
    klassen = {c.id: c for c in (await db.execute(select(SchoolClass).where(
        SchoolClass.owner_id == u.id))).scalars().all()}

    out = {}
    for e in eintraege:
        k = kurse.get(e.kurs_id) or kurse.get(getattr(klassen.get(e.class_id), "kurs_id", None))
        titel = e.title or _kurs_label(k) or getattr(klassen.get(e.class_id), "name", "") or "Termin"
        tag = e.date.date() if hasattr(e.date, "date") else e.date
        out[e.id] = X.baue_vevent(uid=_uid(e), tag=tag, titel=titel, notiz=e.notes or "",
                                  start_time=e.start_time or "", end_time=e.end_time or "",
                                  stand=e.created_at)
    return out


async def _alle(db: AsyncSession, u: User, fenster=None):
    q = select(CalendarEntry).where(CalendarEntry.owner_id == u.id)
    if fenster and fenster[0]:
        q = q.where(CalendarEntry.date >= tagesbeginn(fenster[0]))
    if fenster and fenster[1]:
        q = q.where(CalendarEntry.date < tagesbeginn(fenster[1]))
    return (await db.execute(q.order_by(CalendarEntry.date))).scalars().all()


# ─── Eigenschaften ───

def _props(u: User, *, art: str, href: str, etag_wert: str = "",
           ctag_wert: str = "", gefragt=None) -> str:
    """Die Antwort auf ein PROPFIND fuer EINE Ressource.

    `art` ist einer von vier Werten, und der Unterschied ist nicht kosmetisch —
    Apple prueft beim Anmelden genau daran, ob es einen Kalenderserver vor sich
    hat:

    * "wurzel"    — nur ein Verzeichnis. Es sagt, wo der Principal liegt.
    * "principal" — WER angemeldet ist. Muss `<D:principal/>` im resourcetype
      tragen; ein Principal, der sich als Kalender ausgibt, laesst die
      Kontoeinrichtung mit „Accountname/Passwort konnte nicht ueberprueft
      werden" abbrechen — Apple sucht dort einen Principal und findet keinen.
      Er ist zugleich das calendar-home (so macht es auch Radicale): die
      Sammlung, in der die Kalender liegen.
    * "kalender"  — DER Kalender. Nur er traegt `<C:calendar/>`.
    * "datei"     — ein einzelner Termin.
    """
    ich = f"/api/caldav/p/{u.id}/"
    alle = {
        "current-user-principal": f"<D:current-user-principal><D:href>{ich}</D:href></D:current-user-principal>",
    }
    if art == "wurzel":
        alle["resourcetype"] = "<D:resourcetype><D:collection/></D:resourcetype>"
        alle["displayname"] = f"<D:displayname>{KALENDER_NAME}</D:displayname>"
    elif art == "principal":
        # `<D:principal/>` ist der Punkt, an dem Apple erkennt, dass die
        # Anmeldung geglueckt ist. `<C:calendar/>` darf hier NICHT stehen —
        # sonst haelt der Client die Sammlung selbst fuer einen Kalender und
        # legt sie neben dem echten noch einmal an.
        alle["resourcetype"] = "<D:resourcetype><D:collection/><D:principal/></D:resourcetype>"
        alle["displayname"] = f"<D:displayname>{_xml(u.name or KALENDER_NAME)}</D:displayname>"
        alle["principal-URL"] = f"<D:principal-URL><D:href>{ich}</D:href></D:principal-URL>"
        # Wo Principals ueberhaupt liegen. Apple fragt das beim Einrichten ab;
        # fehlt es, gilt der Server manchen Fassungen als unvollstaendig.
        alle["principal-collection-set"] = "<D:principal-collection-set><D:href>/api/caldav/</D:href></D:principal-collection-set>"
        alle["calendar-home-set"] = f"<C:calendar-home-set><D:href>{ich}</D:href></C:calendar-home-set>"
        # Leer, aber vorhanden: fehlt sie ganz, fragt Apple sie bei jedem
        # Abgleich erneut ab. Eine E-Mail-Adresse gehoert nicht hinein — dieser
        # Kalender laedt niemanden ein.
        alle["calendar-user-address-set"] = "<C:calendar-user-address-set/>"
        alle["supported-report-set"] = _REPORTS
    elif art == "kalender":
        alle["resourcetype"] = "<D:resourcetype><D:collection/><C:calendar/></D:resourcetype>"
        alle["displayname"] = f"<D:displayname>{KALENDER_NAME}</D:displayname>"
        alle["calendar-description"] = f"<C:calendar-description>{KALENDER_NAME}</C:calendar-description>"
        # Nur Termine. Genau deshalb lehnt PUT eine VTODO ab, statt sie
        # stillschweigend wegzuwerfen.
        alle["supported-calendar-component-set"] = '<C:supported-calendar-component-set><C:comp name="VEVENT"/></C:supported-calendar-component-set>'
        alle["supported-report-set"] = _REPORTS
        alle["owner"] = f"<D:owner><D:href>{ich}</D:href></D:owner>"
    else:   # datei
        alle["resourcetype"] = "<D:resourcetype/>"
        alle["getcontenttype"] = "<D:getcontenttype>text/calendar; charset=utf-8; component=VEVENT</D:getcontenttype>"
        alle["owner"] = f"<D:owner><D:href>{ich}</D:href></D:owner>"

    if ctag_wert:
        alle["getctag"] = f"<CS:getctag>{ctag_wert}</CS:getctag>"
    if etag_wert:
        alle["getetag"] = f"<D:getetag>{etag_wert}</D:getetag>"

    if gefragt is None:
        return X.response(href, alle)
    gefunden, fehlend = {}, []
    for raum, name in gefragt:
        if name in alle:
            gefunden[name] = alle[name]
        else:
            # Was wir nicht fuehren, muss ausdruecklich als 404 kommen — sonst
            # fragt der Client es bei jedem Abgleich erneut. Und zwar im
            # Namensraum, in dem GEFRAGT wurde: ein CalDAV-Merkmal als
            # <D:…> zurueckzumelden waere eine andere Eigenschaft.
            fehlend.append(f"{_PRAEFIX.get(raum, 'D')}:{name}")
    return X.response(href, gefunden, fehlend)


_REPORTS = ("<D:supported-report-set>"
            "<D:supported-report><D:report><C:calendar-query/></D:report></D:supported-report>"
            "<D:supported-report><D:report><C:calendar-multiget/></D:report></D:supported-report>"
            "</D:supported-report-set>")

# Namensraum -> Praefix, damit eine fehlende Eigenschaft dort gemeldet wird, wo
# nach ihr gefragt wurde.
_PRAEFIX = {u: p for p, u in X.NS.items()}


def _multistatus(inhalt: str) -> Response:
    return Response(content=inhalt, status_code=207,
                    media_type="application/xml; charset=utf-8", headers=_DAV_KOPF)


# ─── Endpunkte ───

@router.api_route("/", methods=["OPTIONS", "PROPFIND", "GET"])
@router.api_route("/p/{user_id}/", methods=["OPTIONS", "PROPFIND", "GET"])
async def wurzel(request: Request, user_id: Optional[int] = None,
                 db: AsyncSession = Depends(get_db)):
    """Der Einstieg: „wer bin ich" und „wo liegt mein Kalender".

    Apple geht diesen Weg in drei Schritten (Wurzel, Principal, Kalender), und
    jeder Schritt muss antworten — bricht einer ab, sagt die Kontoeinrichtung
    nur „Server nicht gefunden", ohne zu sagen, welcher.
    """
    if request.method == "OPTIONS":
        return Response(status_code=200, headers={
            **_DAV_KOPF, "Allow": "OPTIONS, PROPFIND, REPORT, GET, PUT, DELETE, HEAD"})
    if request.method == "GET":
        # Wer die Adresse in den Browser tippt, bekam bisher „Method Not
        # Allowed" — richtig (ein Browser spricht kein CalDAV), aber es liest
        # sich wie ein Fehler und hat genau so schon einmal zu einer falschen
        # Fehlersuche gefuehrt. Ein Satz Klartext kostet nichts und beantwortet
        # die Frage, die derjenige wirklich hat.
        return _Text(
            "Das ist der CalDAV-Zugang von Nuvora.\n\n"
            "Diese Adresse gehoert in die Kalender-App (Apple, Outlook, "
            "Thunderbird), nicht in den Browser — ein Browser kann CalDAV "
            "nicht sprechen.\n\n"
            "Serveradresse, Benutzername und ein Geraete-Passwort stehen in "
            "Nuvora unter Kalender -> Kalender teilen.\n",
            media_type="text/plain; charset=utf-8", headers=_DAV_KOPF)
    u, absage = await _zugang(request, db)
    if absage:
        return absage
    # Ein fremder Principal-Pfad darf nicht die eigenen Daten zeigen. Der
    # Zugang haengt am angemeldeten Konto, nicht am Pfad.
    if user_id is not None and user_id != u.id:
        return Response(status_code=403, headers=_DAV_KOPF)

    gefragt = X.gefragte_props(X.parse_xml(await request.body()))
    tiefe = request.headers.get("depth", "0")
    href = f"/api/caldav/p/{u.id}/" if user_id is not None else "/api/caldav/"
    antworten = [_props(u, art=("principal" if user_id is not None else "wurzel"),
                        href=href, gefragt=gefragt)]
    if tiefe != "0" and user_id is not None:
        eintraege = await _alle(db, u)
        texte = await _texte(db, u, eintraege)
        antworten.append(_props(u, art="kalender", href=_pfad(u.id),
                                ctag_wert=X.ctag([X.etag(t) for t in texte.values()]),
                                gefragt=gefragt))
    return _multistatus(X.multistatus(antworten))


@router.api_route("/p/{user_id}/" + KALENDER + "/", methods=["OPTIONS", "PROPFIND", "REPORT"])
async def sammlung(request: Request, user_id: int, db: AsyncSession = Depends(get_db)):
    """Der Kalender selbst: seine Eigenschaften, seine Termine, seine Abfragen."""
    if request.method == "OPTIONS":
        return Response(status_code=200, headers={
            **_DAV_KOPF, "Allow": "OPTIONS, PROPFIND, REPORT, GET, PUT, DELETE, HEAD"})
    u, absage = await _zugang(request, db)
    if absage:
        return absage
    if user_id != u.id:
        return Response(status_code=403, headers=_DAV_KOPF)

    try:
        baum = X.parse_xml(await request.body())
    except X.CaldavFehler as e:
        return Response(status_code=e.status, headers=_DAV_KOPF)
    gefragt = X.gefragte_props(baum)

    if request.method == "REPORT":
        art = X.lokal(baum.tag) if baum is not None else ""
        if art == "calendar-multiget":
            gewuenscht = {h.rstrip("/").rsplit("/", 1)[-1] for h in X.multiget_hrefs(baum)}
            eintraege = [e for e in await _alle(db, u) if _dateiname(e) in gewuenscht]
        else:
            # calendar-query. Das Zeitfenster zu beachten ist nicht Pflicht (der
            # Client filtert selbst), spart beim ersten Abgleich aber die ganze
            # Historie.
            eintraege = await _alle(db, u, X.zeitfenster(baum))
        texte = await _texte(db, u, eintraege)
        antworten = []
        for e in eintraege:
            text = texte[e.id]
            props = {"getetag": f"<D:getetag>{X.etag(text)}</D:getetag>",
                     "calendar-data": f"<C:calendar-data>{_xml(text)}</C:calendar-data>"}
            antworten.append(X.response(_pfad(u.id, _dateiname(e)), props))
        return _multistatus(X.multistatus(antworten))

    # PROPFIND
    eintraege = await _alle(db, u)
    texte = await _texte(db, u, eintraege)
    antworten = [_props(u, art="kalender", href=_pfad(u.id),
                        ctag_wert=X.ctag([X.etag(t) for t in texte.values()]), gefragt=gefragt)]
    if request.headers.get("depth", "0") != "0":
        for e in eintraege:
            antworten.append(_props(u, art="datei", href=_pfad(u.id, _dateiname(e)),
                                    etag_wert=X.etag(texte[e.id]), gefragt=gefragt))
    return _multistatus(X.multistatus(antworten))


def _xml(text: str) -> str:
    from xml.sax.saxutils import escape
    return escape(text)


@router.api_route("/p/{user_id}/" + KALENDER + "/{name}", methods=["GET", "PUT", "DELETE", "HEAD"])
async def ressource(request: Request, user_id: int, name: str,
                    db: AsyncSession = Depends(get_db)):
    """Ein einzelner Termin: lesen, anlegen/aendern, loeschen."""
    u, absage = await _zugang(request, db)
    if absage:
        return absage
    if user_id != u.id:
        return Response(status_code=403, headers=_DAV_KOPF)

    eintraege = await _alle(db, u)
    treffer = next((e for e in eintraege if _dateiname(e) == name), None)

    if request.method in ("GET", "HEAD"):
        if not treffer:
            return Response(status_code=404, headers=_DAV_KOPF)
        text = (await _texte(db, u, [treffer]))[treffer.id]
        return Response(content="" if request.method == "HEAD" else text, status_code=200,
                        media_type="text/calendar; charset=utf-8",
                        headers={**_DAV_KOPF, "ETag": X.etag(text)})

    if request.method == "DELETE":
        if not treffer:
            return Response(status_code=404, headers=_DAV_KOPF)
        await db.delete(treffer)
        await db.commit()
        return Response(status_code=204, headers=_DAV_KOPF)

    # PUT: anlegen oder aendern.
    try:
        daten = X.parse_vevent((await request.body()).decode("utf-8", "replace"))
    except X.CaldavFehler as e:
        # Mit Vorbedingung, damit Apple sagen kann, WAS nicht ging — ein
        # nacktes 403 liest sich am Geraet als „keine Berechtigung".
        if e.precondition:
            return Response(content=X.fehler_xml(e.precondition), status_code=e.status,
                            media_type="application/xml; charset=utf-8", headers=_DAV_KOPF)
        return Response(status_code=e.status, headers=_DAV_KOPF)

    # If-Match / If-None-Match: der Schutz gegen verlorene Aenderungen. Zwei
    # Geraete am selben Termin ueberschrieben sich sonst gegenseitig, ohne dass
    # eines davon etwas merkt.
    if_match = request.headers.get("if-match")
    if_none = request.headers.get("if-none-match")
    if treffer:
        vorher = (await _texte(db, u, [treffer]))[treffer.id]
        if if_none == "*":
            return Response(status_code=412, headers=_DAV_KOPF)
        if if_match and if_match != "*" and X.etag(vorher) not in if_match:
            return Response(status_code=412, headers=_DAV_KOPF)
    elif if_match:
        return Response(status_code=412, headers=_DAV_KOPF)

    if treffer:
        treffer.date = tagesbeginn(daten["datum"])
        treffer.title = daten["title"]
        treffer.notes = daten["notes"]
        treffer.start_time = daten["start_time"]
        treffer.end_time = daten["end_time"]
        if daten["uid"]:
            treffer.caldav_uid = daten["uid"]
        e = treffer
        status = 204
    else:
        rate_limit("caldav_neu", f"u{u.id}", 200, 3600, "Zu viele neue Termine.")
        e = CalendarEntry(owner_id=u.id, date=tagesbeginn(daten["datum"]),
                          title=daten["title"], notes=daten["notes"],
                          start_time=daten["start_time"], end_time=daten["end_time"],
                          caldav_uid=daten["uid"] or None)
        db.add(e)
        status = 201
    await db.commit()
    await db.refresh(e)
    text = (await _texte(db, u, [e]))[e.id]
    # Der Ort der Ressource kann sich vom hochgeladenen Namen unterscheiden
    # (unsere Namen tragen die ID). Content-Location sagt dem Client, wo sie
    # wirklich liegt — sonst legt er sie beim naechsten Abgleich noch einmal an.
    return Response(status_code=status, headers={
        **_DAV_KOPF, "ETag": X.etag(text), "Content-Location": _pfad(u.id, _dateiname(e))})


# ─── Geraete-Passwoerter (normale, angemeldete API) ───

verwaltung = APIRouter(prefix="/api/caldav-zugaenge", tags=["caldav"])

# Die Geraete-Passwoerter gehoeren zum Modul Kalender — ohne das Modul gibt es
# nichts, wofuer sich ein Geraet anmelden koennte. Dieselbe Schranke wie ueberall
# (modules.modul_pflicht), damit hier keine zweite Fassung entsteht.
verwaltung_pflicht = modul_pflicht(MODULE_KEY)


@verwaltung.get("")
async def liste(request: Request, db: AsyncSession = Depends(get_db),
                user: User = Depends(verwaltung_pflicht)):
    """Die Geraete-Passwoerter dieses Kontos — ohne die Passwoerter selbst."""
    rows = (await db.execute(select(CaldavToken).where(CaldavToken.owner_id == user.id)
                             .order_by(CaldavToken.id))).scalars().all()
    return {
        "benutzer": user.email,
        # Die volle Adresse, wie sie ins Geraet gehoert. Selbst
        # zusammensetzen zu lassen ist die Stelle, an der die Einrichtung
        # scheitert — Apple sagt dazu nur „Server nicht gefunden".
        "server": str(request.base_url).rstrip("/") + "/api/caldav/",
        "zugaenge": [{"id": r.id, "name": r.name,
                      "angelegt": r.created_at.isoformat() if r.created_at else None,
                      "zuletzt": r.last_used_at.isoformat() if r.last_used_at else None}
                     for r in rows],
    }


class ZugangIn(BaseModel):
    name: str = ""


@verwaltung.post("", status_code=201)
async def anlegen(body: ZugangIn, db: AsyncSession = Depends(get_db),
                  user: User = Depends(verwaltung_pflicht)):
    """Ein neues Geraete-Passwort. Der Klartext kommt GENAU EINMAL zurueck.

    Danach steht nur noch der Hash in der Datenbank — ein Passwort, das sich
    nachtraeglich auslesen laesst, ist keins. Wer es verliert, legt ein neues
    an und nimmt das alte zurueck; das ist genau der Zweck von einem Passwort
    je Geraet.
    """
    rate_limit("caldav_zugang", f"u{user.id}", 10, 3600, "Zu viele Zugaenge. Bitte kurz warten.")
    vorhanden = (await db.execute(select(CaldavToken).where(
        CaldavToken.owner_id == user.id))).scalars().all()
    if len(vorhanden) >= 20:
        raise HTTPException(400, "Zu viele Geraete-Passwoerter. Bitte zuerst eins zuruecknehmen.")
    # Vier Gruppen zu fuenf Zeichen: lang genug gegen Raten, und man kann es
    # von einem Bildschirm auf ein Handy abtippen, ohne sich zu verzaehlen.
    klartext = "-".join(secrets.token_urlsafe(4)[:5] for _ in range(4))
    z = CaldavToken(owner_id=user.id, name=(body.name or "").strip()[:80] or "Gerät",
                    token_hash=_hash_pw(klartext))
    db.add(z)
    await db.commit()
    await db.refresh(z)
    return {"id": z.id, "name": z.name, "passwort": klartext}


@verwaltung.delete("/{zugang_id}", status_code=204)
async def zuruecknehmen(zugang_id: int, db: AsyncSession = Depends(get_db),
                        user: User = Depends(verwaltung_pflicht)):
    """Ein Geraet aussperren. Wirkt beim naechsten Abgleich — es gibt keine
    Sitzung, die noch weiterlaufen koennte."""
    z = (await db.execute(select(CaldavToken).where(
        CaldavToken.id == zugang_id, CaldavToken.owner_id == user.id))).scalar_one_or_none()
    if not z:
        raise HTTPException(404, "Zugang nicht gefunden")
    await db.delete(z)
    await db.commit()
