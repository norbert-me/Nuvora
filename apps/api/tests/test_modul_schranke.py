"""Jedes Modul haelt seine Tuer zu.

Der Systemtest fand, dass CardVote — das groesste Modul — als einziges gar
keine Schranke hatte: mit abgeschaltetem Modul lieferten `/api/questions`,
`/api/sessions-list` und `/api/folders` weiter Daten. Das bricht Regel 3 von
der Seite, von der man sie nicht erwartet: nicht ein Modul, das ein anderes
voraussetzt, sondern eins, das sich gar nicht abschalten laesst.

Der Test liest die gemounteten Routen aus der App und prueft an der Route
selbst, ob die Schranke daran haengt — nicht am Quelltext, damit ein
umgebauter Router ihn nicht still aushebelt.
"""
import pytest

from app.main import app
from app.routers.modules import modul_pflicht


# Routen, die bewusst ohne Modulschranke laufen — mit dem Grund dafuer.
# Wer hier etwas eintraegt, trifft eine Entscheidung und schreibt sie auf.
OFFEN = {
    "/api/sessions/{session_id}/qr":
        "Das QR-Bild laedt der Browser per <img src> und schickt keinen Token mit.",
    "/api/weak-topics":
        "Kern-Sicht (Kalender): fasst schwache Themen aller Module zusammen.",
    "/api/karten/classes/{class_id}/zugaenge.pdf":
        "Zugangs-Zettel: derselbe Code fuehrt zu Karten ODER Testergebnissen, gilt "
        "also solange EINES der beiden Module laeuft. Der Endpunkt prueft das selbst "
        "und antwortet ohne beide mit 409 statt mit einem leeren Blatt.",
    "/api/weak-review":
        "Kern-Sicht (Startseite): schliesst die Bruecke schwach -> geuebt.",
}

# Praefixe der Kern-Router. Der Kern gehoert allen, er hat keine Schranke.
KERN = (
    "/api/auth", "/api/classes", "/api/students", "/api/kurse", "/api/topics",
    "/api/modules", "/api/me", "/api/trash", "/api/selftest", "/api/marketplace",
    "/api/site", "/api/health", "/api/version",
    # Dateiablage der Lehrkraft: haengt an Themen (Kern), gehoert keinem Modul.
    "/api/material",
    # Klassen-Export/-Import gehoeren dem Kern. Die Fragen-, Ordner- und
    # Sitzungs-Ausgaben im selben Router haengen einzeln an CardVote.
    "/api/export/class", "/api/import/class",
    # Serververwaltung: haengt an `_require_admin`, gehoert keinem Modul.
    "/api/mail-test", "/api/admin/",
    # Fehlermeldung aus der Oberflaeche: braucht ein Konto (das IST der
    # Spam-Schutz), aber kein Modul — gemeldet wird von ueberall.
    "/api/bugreport",
)

CARDVOTE = (
    "/api/questions", "/api/folders", "/api/question-sets", "/api/root-question-sets",
    "/api/sessions", "/api/sessions-list", "/api/scan", "/api/scan-image",
    "/api/scan-confirm", "/api/stats/dashboard",
    "/api/export/question-set", "/api/export/folder",
    "/api/import/question-set", "/api/import/folder", "/api/import/questions",
)


def _schranken(route) -> list:
    """Namen der Modul-Schranken, die an dieser Route haengen."""
    return [d.call.__qualname__ for d in getattr(route, "dependant", None).dependencies
            if getattr(d, "call", None) is not None]


def _routen():
    """Alle /api-Routen — auch die, die FastAPI in `_IncludedRouter` einpackt.

    Seit FastAPI 0.14x steht in `app.routes` nicht die Route, sondern ein
    Wrapper um den eingebundenen Router. Wer nur eine Ebene schaut, findet
    nichts und haelt das faelschlich fuer "alles sauber".
    """
    def lauf(traeger, tiefe=0):
        if tiefe > 5:
            return
        for r in getattr(traeger, "routes", []):
            pfad = getattr(r, "path", "")
            if pfad.startswith("/api/") and hasattr(r, "dependant"):
                yield r
            inner = getattr(r, "original_router", None) or getattr(r, "router", None)
            if inner is not None and inner is not traeger:
                yield from lauf(inner, tiefe + 1)

    gesehen = set()
    for r in lauf(app):
        schluessel = (r.path, tuple(sorted(getattr(r, "methods", []) or [])))
        if schluessel not in gesehen:
            gesehen.add(schluessel)
            yield r


def _namen(route) -> list:
    """Alle Abhaengigkeiten der Route, rekursiv, als Namen."""
    raus = []

    def sammeln(dep):
        for d in dep.dependencies:
            if d.call is not None:
                raus.append(getattr(d.call, "__qualname__", ""))
            sammeln(d)

    sammeln(route.dependant)
    return raus


def _hat_schranke(route) -> bool:
    """Haengt an der Route irgendeine Modulschranke?

    Sowohl die gemeinsame Fassung (`modul_pflicht`) als auch die aelteren
    modul-eigenen `require_module`-Kopien zaehlen.
    """
    return any("require_module" in n or "modul_pflicht" in n for n in _namen(route))


def _braucht_anmeldung(route) -> bool:
    """Verlangt die Route ein Konto?

    Oeffentliche Wege (Lernen per Token, Code-Detektiv per sechsstelligem Code)
    haben keins und brauchen darum auch keine Modulschranke — sie pruefen ihren
    eigenen Zugang.
    """
    return any("get_current_user" in n for n in _namen(route))


def test_cardvote_haengt_an_seiner_schranke():
    """Alle CardVote-Routen ausser den benannten Ausnahmen sind gesperrt."""
    offen = []
    for r in _routen():
        if not r.path.startswith(CARDVOTE):
            continue
        if r.path in OFFEN:
            continue
        if not _hat_schranke(r):
            offen.append(f"{sorted(r.methods)} {r.path}")
    assert not offen, (
        "CardVote-Routen ohne Modulschranke — mit abgeschaltetem Modul geben sie "
        f"weiter Daten heraus: {offen}"
    )


def test_die_ausnahmen_gibt_es_wirklich():
    """Eine Ausnahme, die auf keine Route mehr zeigt, ist eine Luege im Test."""
    pfade = {r.path for r in _routen()}
    verwaist = [p for p in OFFEN if p not in pfade]
    assert not verwaist, f"OFFEN nennt Routen, die es nicht gibt: {verwaist}"


def test_ausnahmen_sind_wirklich_offen():
    """Und umgekehrt: sie duerfen nicht heimlich doch gesperrt worden sein —
    sonst laedt das QR-Bild nicht mehr und die Startseite bleibt leer."""
    for r in _routen():
        if r.path in OFFEN:
            assert not _hat_schranke(r), f"{r.path} ist gesperrt, obwohl: {OFFEN[r.path]}"


def test_kein_modul_router_ohne_schranke():
    """Jede angemeldete /api-Route gehoert entweder dem Kern, ist eine benannte
    Ausnahme oder haengt an einer Schranke. Etwas Viertes gibt es nicht."""
    ungeschuetzt = [
        f"{sorted(r.methods)} {r.path}"
        for r in _routen()
        if _braucht_anmeldung(r)
        and not r.path.startswith(KERN)
        and r.path not in OFFEN
        and not _hat_schranke(r)
    ]
    assert not ungeschuetzt, (
        "Routen mit Anmeldung, aber ohne Modulschranke und ausserhalb des Kerns: "
        f"{ungeschuetzt}"
    )


@pytest.mark.asyncio
async def test_schranke_laesst_nur_mit_aktivem_modul_durch():
    """Die Schranke wird wirklich ausgeloest: ohne Aktivierung 403 mit dem
    Modulnamen in der Meldung, mit Aktivierung kommt die Lehrkraft durch."""
    from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
    from fastapi import HTTPException
    from app.models import Base, User, UserModule

    e = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with e.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    async with async_sessionmaker(e, class_=AsyncSession, expire_on_commit=False)() as db:
        u = User(email="s@d.de", password_hash="x", name="L")
        db.add(u)
        await db.commit()

        schranke = modul_pflicht("cardvote", "CardVote")
        with pytest.raises(HTTPException) as ex:
            await schranke(user=u, db=db)
        assert ex.value.status_code == 403
        assert "CardVote" in ex.value.detail, "die Meldung muss das Modul nennen"

        db.add(UserModule(user_id=u.id, module_key="cardvote"))
        await db.commit()
        assert await schranke(user=u, db=db) is u
    await e.dispose()
