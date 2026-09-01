"""Nuvora-Kern: Modulregister.

Nuvora ist die Basis — sie besitzt Konten, Klassen und Schueler. Module wie
CardVote oder Lernpfad arbeiten auf diesen Daten, besitzen sie aber nicht, und
werden pro Lehrkraft zugeschaltet.

Die Liste der verfuegbaren Module steht hier im Code (REGISTRY), nicht in der
Datenbank: ein Modul existiert nur, wenn es auch Code dazu gibt. In der DB
steht ausschliesslich, wer was aktiviert hat.
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import User, UserModule
from .auth import get_current_user

router = APIRouter(prefix="/api/modules", tags=["modules"])


class ModulOption(BaseModel):
    """Ein abschaltbarer TEIL eines Moduls.

    Nicht jede Schule arbeitet mit allem, was ein Modul mitbringt: SEGEL ist
    ein Konzept einer einzelnen Schule, und wer es nicht kennt, hat im Sitzplan
    einen Schalter und ein Kuerzel am Platz, die ihm nichts sagen. Ein ganzes
    Modul dafuer abzuschalten waere zu grob — dann waeren auch Anwesenheit und
    Ausleihe weg.

    Ausdruecklich eine ANZEIGE-Option, keine Schranke: sie blendet aus, sie
    sperrt nicht. Wer eine Schranke braucht, nimmt `modul_pflicht`.
    """
    key: str
    name: str
    description: str = ""
    # Voreinstellung. an=True heisst: da, bis jemand es abschaltet.
    an: bool = True


class ModuleDef(BaseModel):
    key: str
    name: str
    description: str
    # Pfad in der Shell, unter dem das Modul haengt.
    path: str
    # Module, die noch nicht im Rahmen laufen, sind sichtbar aber nicht waehlbar.
    available: bool = True
    # Laeuft das Modul ausserhalb der React-App (eigene Seite hinter dem Proxy)?
    # Dann muss die Shell es per echtem Seitenwechsel oeffnen, nicht per Route.
    external: bool = False
    # Reifegrad: "beta" = laeuft, aber in Entwicklung; "alpha" = frueh, Daten
    # koennen verloren gehen. Die Shell zeigt das als Badge.
    stage: str = "alpha"
    # Gruppe für die Modulübersicht: "unterricht" | "organisation" | "werkzeug".
    group: str = "werkzeug"
    # Abschaltbare Teile dieses Moduls (leer = das Modul ist unteilbar).
    optionen: List[ModulOption] = []


REGISTRY: List[ModuleDef] = [
    ModuleDef(
        key="cardvote",
        group="unterricht",
        name="CardVote",
        description=(
            "Abstimmen im Unterricht ohne Geräte: Lernende halten bedruckte "
            "Karten hoch, du scannst sie mit dem Handy. Live-Ergebnisse, "
            "Spiel-Modus, Auswertung mit Notenschlüssel, Übernahme als "
            "Notenspalte, Export und Marktplatz."
        ),
        path="/cardvote",
        stage="stable",
    ),
    ModuleDef(
        key="lernpfad",
        group="unterricht",
        name="Lernpfad",
        description=(
            "Aufgaben und Lernpfade (aus mehreren Lernleitern) verwalten — auf "
            "denselben Themen, Klassen und Kursen wie der Rest von Nuvora. Der "
            "Generator verteilt Aufgaben differenziert je Schüler; Lernleitern "
            "lassen sich über den Marktplatz teilen."
        ),
        path="/lernpfad",
        stage="stable",
    ),
    ModuleDef(
        key="auswertung",
        group="werkzeug",
        # Angezeigt heisst das Modul „Noten" — Schluessel und Pfad bleiben
        # „auswertung" (sie stehen in user_modules, in Lesezeichen und in den
        # Proben).
        name="Noten",
        description=(
            "Leistung auswerten an einem Ort — zwei Reiter: Notenbuch (eigene "
            "Spalten mit Gewichten, gewichteter Schnitt und Trend je Schüler; die "
            "Zeugnisnote bleibt deine Entscheidung, Beobachtungen zählen nie mit; "
            "CardVote-/Karten-/Code-Detektiv-Ergebnisse als Spalte übernehmbar) und "
            "Klassenarbeit (Punkte je Aufgabe und Teilaufgabe, Thema bis auf die "
            "Teilaufgabe genau → Fehlerprofil und gezielte Wiederholung). Die Arbeit "
            "und ihr Erwartungshorizont hängen als Datei daran; dieselbe Arbeit lässt "
            "sich in eine andere Klasse kopieren und danach über die Klassen "
            "vergleichen — je Aufgabe mit Trennschärfe, Nuller-Anteil und Streuung, "
            "damit eine missverständliche Aufgabe von einer schweren zu unterscheiden "
            "ist. Je Kind zeigt der Themenstand, wie sicher jedes Unterthema sitzt "
            "und ob es besser wird — über alle Arbeiten und Quizze hinweg."
        ),
        path="/auswertung",
        stage="stable",
    ),
    ModuleDef(
        key="code-detektiv",
        group="werkzeug",
        name="Code-Detektiv",
        description=(
            "Programmier-Rätsel für den Informatikunterricht: Code-Bausteine per "
            "Drag & Drop in die richtige Reihenfolge bringen — allein oder in "
            "einer Klassen-Session (Beitritt per Code, ohne Login). Themen-getaggt."
        ),
        path="/code-detektiv",
        stage="beta",
    ),
    ModuleDef(
        key="karten",
        group="unterricht",
        name="Karteikarten",
        description=(
            "Karteikarten mit Spaced Repetition. Alle Stapel liegen in EINER "
            "Sammlung; ausgerollt werden sie über die Stunde: wer einen Stapel "
            "im Kalender einplant, gibt ihn damit für diesen Kurs frei. Ohne "
            "das Modul Kalender lässt sich alles anlegen, ändern und drucken — "
            "nur ausgerollt wird nichts. "
            "Die Lernenden üben ohne Konto per QR-Code; ihren Reifegrad siehst "
            "du im Modul. Optional an ein Thema gebunden (der Kalender schaltet "
            "den Stapel am Tag frei); die Meisterung als Notenspalte "
            "übernehmbar. Zugangs-Codes druckst du als PDF aus der Klasse (ein "
            "QR je Kind); schaltest du das Modul ab, liefern sie nichts mehr. "
            "E/G je Karte schaltest du am Stapel ein (wie am Quiz) — aus sehen "
            "alle alles, an ist eine neue Karte Grundstoff (G), bis du sie auf E "
            "schaltest. Ein ganzer Stapel kann zusätzlich nur für E oder nur "
            "für G gelten."
        ),
        path="/karten",
        stage="stable",
    ),
    ModuleDef(
        key="kalender",
        group="organisation",
        name="Kalender",
        description=(
            "Unterrichtsplanung: Tag-, Wochen-, Monatsansicht und ein "
            "wiederkehrender Stundenplan. An einen Eintrag lässt sich ein Quiz, "
            "ein Karten-Deck oder eine Lernleiter planen; freie Tage blenden "
            "Stunden aus. Ein Klassenarbeitstermin legt mit dem Modul To-do ein "
            "Korrektur-To-do eine Woche danach an. Kalender-Sync in beide "
            "Richtungen (eigener ICS-Feed zum Abonnieren + externer Kalender "
            "read-only)."
        ),
        path="/kalender",
        stage="stable",
    ),
    ModuleDef(
        key="orga",
        group="organisation",
        name="Orga",
        description=(
            "Werkzeuge zur Klassenführung in Reitern: Sammel-Checklisten (z.B. "
            "„Unterschrift der Klassenarbeit gesehen“), Anwesenheit/Fehlzeiten "
            "(mit PDF-Report), Material-Ausleihe (verleihen, Rückgabe im Blick) "
            "und Sitzplan (Tische frei platzieren, optional SEGEL-Stufen je "
            "Schüler)."
        ),
        path="/orga",
        stage="stable",
        optionen=[
            ModulOption(
                key="segel",
                name="SEGEL-Stufen",
                description=(
                    "Hafen → Küste → Meer → Welt am Sitzplatz: das Helios-Konzept "
                    "zunehmender Selbststeuerung. Kennt deine Schule es nicht, "
                    "schalte es ab — dann verschwinden Schalter und Kürzel aus dem "
                    "Sitzplan. Eingetragene Stufen bleiben erhalten."
                ),
            ),
        ],
    ),
    ModuleDef(
        key="zufall",
        group="werkzeug",
        name="Zufall",
        description=(
            "Zwei Werkzeuge: Zufallsschüler zieht per Knopfdruck eine faire "
            "Person aus der Klasse (gewichtet nach Zeit seit dem letzten Ziehen), "
            "Zufallsgruppe teilt die Klasse in Gruppen — nach Anzahl oder Größe."
        ),
        path="/zufall",
        stage="stable",
    ),
    ModuleDef(
        key="unterrichtsplanung",
        group="unterricht",
        # Angezeigt heisst das Modul „Einstiege" — es hat genau einen Reiter, und
        # „Unterrichtsplanung" versprach die ganze Jahresplanung. Der SCHLUESSEL
        # bleibt: an ihm haengen die Aktivierungen in `user_modules`, die Route
        # und jede Probe der Testsuite.
        name="Einstiege",
        description=(
            "Ideen für den Unterrichtseinstieg sammeln: Idee, Ablauf, Material, "
            "Dauer — an Kalender-Stunden zuweisbar und themen-getaggt. Die "
            "Jahresplanung liegt bei den Themen im Kern (Reihenfolge, Lernziele, "
            "E/G-Anforderungen), nicht hier."
        ),
        path="/unterrichtsplanung",
        stage="beta",
    ),
    ModuleDef(
        key="notizbrett",
        group="organisation",
        name="Notizbrett",
        description=(
            "Notizen und Aufgaben an einem Ort — zwei Reiter: freie Notizzettel "
            "(Titel + Text, sortierbar) und eine To-do-Liste. Datierte Aufgaben "
            "erscheinen zusätzlich im Kalender; ein Klassenarbeitstermin legt "
            "hier von selbst ein Korrektur-To-do an. Nicht an Schüler gebunden "
            "(das sind die Beobachtungen)."
        ),
        path="/notizbrett",
        stage="stable",
    ),
    ModuleDef(
        key="tafel",
        group="werkzeug",
        name="Tafel",
        description=(
            "Classroom-Screen für den Beamer: frei platzierbare Textfelder, in "
            "Größe und Schriftgröße anpassbar. Für Arbeitsaufträge, Hinweise und "
            "alles, was gerade an die Tafel soll. Reines Werkzeug, ohne Daten."
        ),
        path="/tafel",
        stage="beta",
    ),
    ModuleDef(
        key="mathespiele",
        group="unterricht",
        name="Mathespiele",
        description=(
            "Sammlung von Mathe-Spielen für den Unterricht. Aktuell Mathefußball: "
            "Kopfrechen-Spiel für zwei Teams am Beamer — richtige Antwort schiebt den "
            "Ball Richtung Tor. Zahlenraum und Rechenarten einstellbar. Reines Spiel, "
            "ohne Daten."
        ),
        path="/mathespiele",
        stage="beta",
    ),
]

_BY_KEY = {m.key: m for m in REGISTRY}


class ModuleOut(ModuleDef):
    active: bool
    # Wirksamer Stand je Option: Voreinstellung aus der REGISTRY, ueberschrieben
    # von dem, was diese Lehrkraft eingestellt hat. Die Shell fragt nur das ab
    # und muss die Voreinstellungen nicht ein zweites Mal kennen.
    optionen_an: dict = {}
    # Wie viele Lehrkräfte dieses Modul aktiviert haben — Orientierung beim
    # Einstieg („was nutzen andere?"). Global, nicht personenbezogen.
    popularity: int = 0


async def _active_keys(db: AsyncSession, user_id: int) -> set[str]:
    result = await db.execute(select(UserModule.module_key).where(UserModule.user_id == user_id))
    return set(result.scalars().all())


def _optionen_an(mod: ModuleDef, gespeichert: Optional[dict]) -> dict:
    """Wirksamer Stand je Option: Voreinstellung, ueberschrieben vom Gespeicherten.

    Nur deklarierte Optionen kommen heraus — steht in der Datenbank noch ein
    Schluessel aus einer Fassung, in der es die Option gab, faellt er hier
    heraus statt als Geist weiterzuleben.
    """
    werte = {}
    for opt in mod.optionen:
        wert = (gespeichert or {}).get(opt.key)
        werte[opt.key] = bool(wert) if isinstance(wert, bool) else opt.an
    return werte


async def option_an(db: AsyncSession, user_id: int, key: str, option: str) -> bool:
    """Ist dieser TEIL eines Moduls eingeschaltet?

    Fuer den Server selten noetig (es sind Anzeige-Optionen), aber vorhanden,
    damit eine Auswertung nicht ueber etwas rechnet, das niemand sieht.
    """
    mod = _BY_KEY.get(key)
    if not mod:
        return False
    row = (await db.execute(select(UserModule).where(
        UserModule.user_id == user_id, UserModule.module_key == key))).scalar_one_or_none()
    if not row:
        return False               # Modul gar nicht aktiv
    return _optionen_an(mod, row.optionen).get(option, False)


async def is_active(db: AsyncSession, user_id: int, key: str) -> bool:
    """Fuer Modul-Router: laeuft dieses Modul fuer diese Lehrkraft?"""
    result = await db.execute(
        select(UserModule.id).where(UserModule.user_id == user_id, UserModule.module_key == key)
    )
    return result.scalar_one_or_none() is not None


def modul_pflicht(key: str, name: str = ""):
    """Baut die Schranke eines Moduls: ohne Aktivierung 403, kein Datenzugriff.

    Bis dahin schrieb jeder Modul-Router seine eigene Fassung ab — und CardVote
    hatte schlicht keine, obwohl es das groesste Modul ist. Eine Quelle, damit
    ein neues Modul die Schranke nicht vergessen kann.

    Der Name kommt aus dem REGISTRY, er wird nicht uebergeben. Die 16 Kopien
    hatten ihn abgetippt, und nach den Modul-Zusammenlegungen nannte die Meldung
    Module, die es in der Uebersicht gar nicht mehr gibt ("Modul Sitzplan ist
    nicht aktiviert", waehrend dort Orga steht) — die Lehrkraft konnte den
    Fehler nicht beheben. Ein falscher SCHLUESSEL faellt jetzt beim Import auf,
    nicht erst in einer 403-Meldung im Unterricht.
    """
    mod = _BY_KEY.get(key)
    if not mod:
        raise KeyError(f"Modul '{key}' steht nicht im REGISTRY (modules.py)")
    anzeige = name or mod.name

    async def schranke(user: User = Depends(get_current_user),
                       db: AsyncSession = Depends(get_db)) -> User:
        if not await is_active(db, user.id, key):
            raise HTTPException(403, f"Modul {anzeige} ist nicht aktiviert")
        return user
    return schranke


@router.get("", response_model=List[ModuleOut])
async def list_modules(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Alle Module mit Aktivierungsstand — die Shell baut daraus ihre Navigation."""
    active = await _active_keys(db, user.id)
    # Globale Aktivierungszahl je Modul (für „Beliebt"-Hinweis beim Einstieg).
    counts = dict((await db.execute(
        select(UserModule.module_key, func.count()).group_by(UserModule.module_key)
    )).all())
    # Gespeicherte Optionen in einem Rutsch (nicht je Modul eine Abfrage).
    zeilen = {r.module_key: r.optionen for r in (await db.execute(
        select(UserModule).where(UserModule.user_id == user.id))).scalars().all()}
    return [ModuleOut(**m.model_dump(), active=m.key in active, popularity=counts.get(m.key, 0),
                      optionen_an=_optionen_an(m, zeilen.get(m.key)))
            for m in REGISTRY]


@router.post("/{key}/activate", response_model=ModuleOut)
async def activate(
    key: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    mod = _BY_KEY.get(key)
    if not mod:
        raise HTTPException(404, "Modul unbekannt")
    if not mod.available:
        raise HTTPException(409, "Modul ist noch nicht verfuegbar")

    if not await is_active(db, user.id, key):
        db.add(UserModule(user_id=user.id, module_key=key))
        await db.commit()
    return ModuleOut(**mod.model_dump(), active=True, optionen_an=_optionen_an(mod, None))


@router.delete("/{key}/activate", response_model=ModuleOut)
async def deactivate(
    key: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Abschalten blendet das Modul nur aus — die Daten dahinter bleiben."""
    mod = _BY_KEY.get(key)
    if not mod:
        raise HTTPException(404, "Modul unbekannt")

    result = await db.execute(
        select(UserModule).where(UserModule.user_id == user.id, UserModule.module_key == key)
    )
    row = result.scalar_one_or_none()
    if row:
        await db.delete(row)
        await db.commit()
    return ModuleOut(**mod.model_dump(), active=False, optionen_an=_optionen_an(mod, None))


class OptionenIn(BaseModel):
    """{"segel": false} — nur deklarierte Schluessel, nur Wahrheitswerte."""
    optionen: dict


@router.put("/{key}/optionen", response_model=ModuleOut)
async def set_optionen(
    key: str,
    body: OptionenIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Abschaltbare Teile eines Moduls ein- oder ausstellen.

    Nur fuer ein AKTIVES Modul: eine Option an einem abgeschalteten Modul waere
    eine Einstellung an etwas, das es fuer diese Lehrkraft nicht gibt — und
    beim naechsten Aktivieren stuende sie unerwartet anders als beim ersten Mal.
    """
    mod = _BY_KEY.get(key)
    if not mod:
        raise HTTPException(404, "Modul unbekannt")
    if not mod.optionen:
        raise HTTPException(409, "Dieses Modul hat keine Optionen")
    row = (await db.execute(select(UserModule).where(
        UserModule.user_id == user.id, UserModule.module_key == key))).scalar_one_or_none()
    if not row:
        raise HTTPException(409, f"Modul {mod.name} ist nicht aktiviert")

    erlaubt = {o.key for o in mod.optionen}
    unbekannt = set(body.optionen) - erlaubt
    if unbekannt:
        # Ausdruecklich ein Fehler, nicht stilles Verwerfen: ein Tippfehler im
        # Schluessel sieht sonst aus wie „gespeichert" und wirkt einfach nie.
        raise HTTPException(400, f"Unbekannte Option: {', '.join(sorted(unbekannt))}")
    neu = dict(row.optionen or {})
    for k, v in body.optionen.items():
        if not isinstance(v, bool):
            raise HTTPException(400, f"Option {k} braucht true oder false")
        neu[k] = v
    row.optionen = {k: v for k, v in neu.items() if k in erlaubt} or None
    await db.commit()
    return ModuleOut(**mod.model_dump(), active=True, optionen_an=_optionen_an(mod, row.optionen))
