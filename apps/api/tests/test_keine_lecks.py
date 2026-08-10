"""Besonders schützenswerte Schülerdaten dürfen nirgends nach draußen.

`students.foerder` (Dyskalkulie, LRS …), `students.massnahmen`
(Nachteilsausgleiche) und `students.notizen` sind besondere Kategorien
personenbezogener Daten nach DSGVO Art. 9. CLAUDE.md sagt dazu: „Sie stehen in
keinem Export und in keiner Veröffentlichung."

Bisher hing das an einzelnen Tests und an Disziplin. Das reicht nicht: die
gefährliche Lücke ist nicht der Pfad, den jemand geprüft hat, sondern der, den
morgen jemand hinzufügt. Genau diese Sorte Lücke hat in dieser Codebasis schon
dreimal zugeschlagen (CardVote ohne Modulschranke, tote Modul-Schlüssel,
fehlende Kaskade).

Deshalb prüft dieser Test nicht einzelne bekannte Ausgaben, sondern **alle
gemounteten GET-Routen** — so wie `test_modul_schranke.py` es für die Schranke
macht. Er legt über die echten Router eine Klasse mit markierten Schülerdaten
an, ruft dann jede erreichbare GET-Route auf und sucht die Markierungen in der
Antwort. Eine neue Route, die diese Felder ausgibt, wird damit automatisch rot.

Wo die Felder legitim erscheinen dürfen (die Lehrkraft sieht ihre eigenen
Daten, und die Auskunft nach Art. 15 *muss* sie enthalten), steht der Pfad in
`ERLAUBT` — mit Begründung. Eine stillschweigende Ausnahme gibt es nicht.

Die Trennlinie, die dieser Test zieht:
  * **Leck** = die Daten erscheinen in einer Veröffentlichung (Marktplatz), in
    einer Ausgabedatei (PDF/Excel/CSV/ZIP/ICS) oder auf einem Weg, der ohne
    Anmeldung der Lehrkraft erreichbar ist (Schüler-Token, Sitzungscode).
  * **Kein Leck** = die angemeldete Lehrkraft sieht in ihrer eigenen
    Verwaltungsansicht die Daten ihrer eigenen Schüler.
"""
import asyncio
import base64
import io
import json
import re
import zipfile
import zlib

import pytest
import pytest_asyncio
from fastapi import Depends
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.database import get_db
from app.main import _global_hits, app
from app.models import Base, Scan, User, UserModule
from app.routers.auth import _buckets, get_current_user
from app.routers.modules import REGISTRY

# ── Markierungen ─────────────────────────────────────────────────────────────
# Unverwechselbar, damit ein Fund kein Zufall sein kann. Freitext ist nur in
# `notizen` und im `detail` einer Maßnahme möglich — `foerder` und die `art`
# einer Maßnahme kommen aus festen Vokabularen (FOERDER_VALUES /
# MASSNAHMEN_VALUES in classes.py). Dort wird deshalb auf die Werte selbst
# geprüft; „Dyskalkulie" in einer Ausgabe ist genauso ein Leck wie eine Notiz.
NOTIZ = "ZZLECK-NOTIZ-Q7X"
DETAIL = "ZZLECK-MASSNAHME-Q7X"
FOERDER = ["Dyskalkulie", "LRS"]
MASSNAHME_ART = "Zeitzuschlag"

MARKIERUNGEN = [NOTIZ, DETAIL] + FOERDER + [MASSNAHME_ART]

# Routen, in denen die Felder erscheinen DÜRFEN — jede mit ihrem Grund.
# Wer hier etwas einträgt, trifft eine Entscheidung und schreibt sie auf.
ERLAUBT = {
    "/api/classes":
        "Die Verwaltungsansicht der Lehrkraft für ihre eigenen Schüler — genau "
        "hier werden die Angaben gepflegt.",
    "/api/classes/{class_id}":
        "dito, einzelne Klasse.",
    "/api/classes/{class_id}/massnahmen":
        "Zweck des Endpunkts: der Kalender zeigt am Klassenarbeitstermin die "
        "vereinbarten Nachteilsausgleiche. Angemeldet, eigene Klasse.",
    "/api/kurse/{kurs_id}/massnahmen":
        "dito für den Kurs.",
    "/api/me/export":
        "Auskunft nach DSGVO Art. 15 — sie MUSS vollständig sein. Dass die "
        "Felder hier drinstehen, prüft test_auskunft_enthaelt_die_felder "
        "eigens, damit sie niemand aus lauter Vorsicht überall entfernt.",
}
# Bewusst NICHT in ERLAUBT, obwohl man es erwarten würde: /api/sitzplan/…,
# /api/orga/… und /api/kurse/{id}/students geben heute nur Name und Niveau
# heraus. Sie stehen hier nicht, damit es auffällt, falls jemand die
# Förderangaben dort „für die Anzeige" mitschickt — das wäre eine Entscheidung,
# die jemand treffen und aufschreiben muss.

# Routen, die der Rundlauf nicht sinnvoll aufrufen kann — mit Begründung.
# Ohne diese Liste würde ein „geht halt nicht" still zum blinden Fleck.
NICHT_AUTOMATISCH = {
    "/api/selftest":
        "verlangt Administrationsrechte bzw. SELFTEST_TOKEN; prüft die "
        "Installation, nicht Schülerdaten.",
    "/api/auth/admin/users":
        "Administrationsansicht (Konten, keine Schülerdaten).",
    "/api/admin/setup":
        "Ersteinrichtung der Installation, kennt keine Schüler.",
    "/api/health":
        "Lebenszeichen ohne Datenbankzugriff.",
    "/api/version":
        "Versionsnummer.",
    "/api/material/{material_id}/download":
        "Die Datei entsteht nur über einen Multipart-Upload; sie gibt zurück, "
        "was die Lehrkraft selbst hochgeladen hat, und liest keine Schülerdaten.",
    "/api/classes/students/{student_id}/photo":
        "Liefert ein hochgeladenes Foto (Bytes) — dafür bräuchte es einen "
        "Multipart-Upload. Ein Bild trägt keine Förderangaben.",
    "/api/karten/cards/{card_id}/image/{side}":
        "dito: Bild einer Karteikarte, nur nach Multipart-Upload vorhanden.",
    "/api/karten/lernen/{token}/image/{card_id}/{side}":
        "dito, derselbe Bildabruf auf dem anmeldefreien Weg.",
}


# ── Winziger ASGI-Client ─────────────────────────────────────────────────────
# Bewusst kein httpx/TestClient: das würde eine neue Testabhängigkeit bedeuten.
# Die App ist eine ASGI-Anwendung; sie direkt aufzurufen kostet zwanzig Zeilen
# und geht durch dieselben Middlewares wie im Betrieb.
class Antwort:
    def __init__(self, status: int, body: bytes, headers: dict):
        self.status = status
        self.body = body
        self.headers = headers

    def json(self):
        return json.loads(self.body or b"null")


async def _ruf(method: str, pfad: str, body=None, query: str = "") -> Antwort:
    payload = json.dumps(body).encode() if body is not None else b""
    scope = {
        "type": "http", "asgi": {"version": "3.0", "spec_version": "2.3"},
        "http_version": "1.1", "method": method, "scheme": "http",
        "path": pfad, "raw_path": pfad.encode(), "query_string": query.encode(),
        "root_path": "", "client": ("127.0.0.1", 12345), "server": ("testserver", 80),
        "headers": [
            (b"host", b"testserver"),
            (b"content-type", b"application/json"),
            (b"content-length", str(len(payload)).encode()),
        ],
    }
    gesendet = {"status": 500, "body": b"", "headers": {}}
    geschickt = False
    fertig = asyncio.Event()

    async def receive():
        """Nach dem Rumpf NICHT sofort 'http.disconnect' melden.

        Starlettes BaseHTTPMiddleware horcht auf die Trennung und bricht die
        Antwort dann mitten im Strom ab — eine PDF kam so nur als erste Zeile
        an und jede Prüfung ihres Inhalts wäre ein Trugschluss.
        """
        nonlocal geschickt
        if not geschickt:
            geschickt = True
            return {"type": "http.request", "body": payload, "more_body": False}
        await fertig.wait()
        return {"type": "http.disconnect"}

    async def send(message):
        if message["type"] == "http.response.body" and not message.get("more_body", False):
            fertig.set()
        if message["type"] == "http.response.start":
            gesendet["status"] = message["status"]
            # latin-1: Dateinamen in `content-disposition` tragen Umlaute, und
            # eine Kopfzeile darf am Test nicht scheitern.
            gesendet["headers"] = {k.decode("latin-1").lower(): v.decode("latin-1")
                                   for k, v in message.get("headers", [])}
        elif message["type"] == "http.response.body":
            gesendet["body"] += message.get("body", b"")

    await app(scope, receive, send)
    return Antwort(gesendet["status"], gesendet["body"], gesendet["headers"])


# ── Lesbarmachen von Ausgabedateien ──────────────────────────────────────────
def _lesbar(antwort: Antwort) -> str:
    """Alles, was in der Antwort an Text steckt — auch verpackt oder gepackt.

    Bei Excel und PDF reicht der Statuscode nicht: die Markierung steckt in
    einem ZIP bzw. in einem komprimierten PDF-Stream. Wer nur die rohen Bytes
    durchsucht, baut eine Scheinprüfung.
    """
    roh = antwort.body or b""
    # Kopfzeilen zaehlen mit: ein Dateiname (content-disposition) ist genauso
    # eine Ausgabe wie der Rumpf.
    teile = [roh.decode("utf-8", "replace"), " ".join(antwort.headers.values())]

    # xlsx/zip: alle enthaltenen Dateien mitlesen (die Zellwerte stehen in XML).
    if roh[:2] == b"PK":
        try:
            with zipfile.ZipFile(io.BytesIO(roh)) as z:
                for name in z.namelist():
                    teile.append(z.read(name).decode("utf-8", "replace"))
        except Exception:
            pass

    # PDF: der sichtbare Text steht in Streams, die reportlab per ASCII85 UND
    # Flate verpackt (Filter [/ASCII85Decode /FlateDecode]). Beide Wege
    # probieren, sonst findet die Suche nur den Dateikopf — und meldet jede
    # PDF als sauber. Dass es wirklich greift, sichert
    # test_pdf_wird_wirklich_durchsucht ab.
    if roh[:4] == b"%PDF":
        for stream in re.findall(rb"stream\r?\n(.*?)endstream", roh, re.S):
            stream = stream.strip(b"\r\n")
            for entpacken in (lambda b: zlib.decompress(b),
                              lambda b: zlib.decompress(base64.a85decode(b, adobe=True)),
                              lambda b: base64.a85decode(b, adobe=True)):
                try:
                    teile.append(entpacken(stream).decode("latin-1", "replace"))
                    break
                except Exception:
                    continue

    return "\n".join(teile)


def _funde(antwort: Antwort) -> list:
    text = _lesbar(antwort)
    return [m for m in MARKIERUNGEN if m in text]


# ── Aufbau: eine Lehrkraft, eine Klasse, ein Datensatz je Modul ──────────────
@pytest_asyncio.fixture
async def welt(tmp_path):
    """Eine vollständige kleine Installation im Speicher.

    Datei statt `:memory:`, weil jede Anfrage ihre eigene Verbindung öffnet —
    eine reine In-Memory-Datenbank wäre für jede davon leer.
    """
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'leck.db'}")

    @event.listens_for(engine.sync_engine, "connect")
    def _fk_on(dbapi_conn, _):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    # Die Zaehler der Rate-Limits leben im Prozess und haengen an der Nutzer-ID.
    # Dieser Test veroeffentlicht mehrfach je Durchlauf und wuerde sonst nach
    # ein paar Tests fremde Tests mit 429 statt 403 antworten lassen.
    _buckets.clear()
    _global_hits.clear()

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    Sitzung = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with Sitzung() as s:
        u = User(email="leck@test.de", password_hash="x", name="Testlehrkraft", email_verified=True)
        s.add(u)
        await s.commit()
        # Alle Module zuschalten — sonst antworten die Modulrouten nur mit 403
        # und der Rundlauf prüfte in Wahrheit nichts.
        for m in REGISTRY:
            s.add(UserModule(user_id=u.id, module_key=m.key))
        await s.commit()
        user_id = u.id

    async def _db():
        async with Sitzung() as s:
            yield s

    async def _user(db: AsyncSession = Depends(get_db)):
        return await db.get(User, user_id)

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_current_user] = _user
    try:
        daten = await _daten_anlegen(Sitzung, user_id)
        daten["sitzung"] = Sitzung
        yield daten
    finally:
        app.dependency_overrides.clear()
        await engine.dispose()


async def _daten_anlegen(Sitzung, user_id: int) -> dict:
    """Legt über die echten Router an, was es zu lecken gäbe."""
    ids = {"student_id": 0}

    # Kern: Klasse mit zwei Schülern, beide mit Art.-9-Angaben.
    r = await _ruf("POST", "/api/classes", {
        "name": "ZZ-Leck 7a",
        "students": [
            {"card_id": 1, "name": "Anna Leck", "niveau": "G", "foerder": FOERDER,
             "massnahmen": [{"art": MASSNAHME_ART, "detail": DETAIL, "arbeit": True}],
             "notizen": NOTIZ},
            {"card_id": 2, "name": "Ben Leck", "niveau": "E", "foerder": ["LRS"],
             "massnahmen": [{"art": MASSNAHME_ART, "detail": DETAIL, "arbeit": False}],
             "notizen": NOTIZ},
        ],
    })
    assert r.status == 201, f"Klasse anlegen fehlgeschlagen: {r.status} {r.body[:400]}"
    klasse = r.json()
    ids["class_id"] = klasse["id"]
    ids["kurs_id"] = klasse["kurs_id"]
    ids["student_id"] = klasse["students"][0]["id"]
    ids["card_id"] = 1

    # Kern: Thema (hängen Aufgaben, Karten und Notenspalten dran).
    r = await _ruf("POST", "/api/topics", {"name": "ZZ-Leck Bruchrechnung"})
    if r.status in (200, 201):
        ids["topic_id"] = r.json().get("id")

    # CardVote: Ordner, Fragen, Frageset, Sitzung, gescannte Antworten.
    r = await _ruf("POST", "/api/folders", {"name": "ZZ-Leck Ordner"})
    if r.status in (200, 201):
        ids["folder_id"] = r.json().get("id")
    frage_ids = []
    for i in range(2):
        r = await _ruf("POST", "/api/questions", {
            "text": f"ZZ-Leck Frage {i}", "choices": {"A": "a", "B": "b", "C": "c", "D": "d"},
            "correct_answer": "A",
        })
        assert r.status == 201, r.body[:300]
        frage_ids.append(r.json()["id"])
    ids["question_id"] = frage_ids[0]
    r = await _ruf("POST", "/api/question-sets", {
        "name": "ZZ-Leck Quiz", "question_ids": frage_ids,
        "niveau_aktiv": True, "niveaus": {str(frage_ids[1]): "E"},
    })
    assert r.status == 201, r.body[:300]
    ids["set_id"] = r.json()["id"]
    r = await _ruf("POST", "/api/sessions", {
        "name": "ZZ-Leck Test", "class_id": ids["class_id"], "question_set_id": ids["set_id"],
    })
    assert r.status == 201, r.body[:300]
    ids["session_id"] = r.json()["id"]
    ids["code"] = r.json()["code"]

    # Antworten: über den Scan-Router ginge nur mit Bild — hier direkt, denn
    # geprüft wird die Ausgabe, nicht der Weg hinein. `Scan.student_id` ist die
    # Kartennummer, nicht die Schüler-ID (so liest es auch export_import.py);
    # mit der falschen Zahl gälten alle als krank und die PDF bliebe leer.
    async with Sitzung() as s:
        for karte in (1, 2):
            for qid in frage_ids:
                s.add(Scan(session_id=ids["session_id"], student_id=karte,
                           question_id=qid, answer="A"))
        await s.commit()

    # Karten: Stapel, Karte, Freigabe, Schüler-Token (Weg ohne Anmeldung).
    r = await _ruf("POST", f"/api/karten/classes/{ids['class_id']}/decks", {"name": "ZZ-Leck Stapel"})
    if r.status == 201:
        ids["deck_id"] = r.json()["id"]
        await _ruf("POST", f"/api/karten/decks/{ids['deck_id']}/cards",
                   {"front": "ZZ-Leck vorn", "back": "ZZ-Leck hinten"})
        await _ruf("POST", f"/api/karten/decks/{ids['deck_id']}/release", {})
    r = await _ruf("POST", f"/api/karten/classes/{ids['class_id']}/tokens", {})
    if r.status == 200 and r.json():
        ids["token"] = r.json()[0]["token"]

    # Lernpfad: Aufgabe, Pfad, Lernleiter mit Zuweisung an den Schüler.
    r = await _ruf("POST", "/api/lernpfad/exercises",
                   {"kategorie": "ZZ-Leck", "aufgabentext": "ZZ-Leck Aufgabe", "loesung": "42"})
    if r.status == 201:
        ids["exercise_id"] = r.json()["id"]
    r = await _ruf("POST", "/api/lernpfad/paths", {"name": "ZZ-Leck Pfad"})
    if r.status == 201:
        ids["path_id"] = r.json()["id"]
        r = await _ruf("POST", f"/api/lernpfad/paths/{ids['path_id']}/ladders", {
            "class_id": ids["class_id"], "topic_id": ids.get("topic_id"), "notizen": "ZZ-Leck Notiz",
            "assignments": [{"student_id": ids["student_id"], "exercise_ids": [ids.get("exercise_id")]}],
        })
        if r.status == 201:
            ids["ladder_id"] = r.json()["id"]

    # Methoden (teilbar über den Marktplatz).
    r = await _ruf("POST", "/api/methoden/", {"title": "ZZ-Leck Methode", "description": "x", "ablauf": "y"})
    if r.status == 201:
        ids["method_id"] = r.json()["id"]

    # Auswertung: Notenspalte + Note + Beobachtung, damit Zeugnis und Export
    # tatsächlich etwas ausgeben.
    r = await _ruf("POST", f"/api/noten/classes/{ids['class_id']}/sections",
                   {"name": "ZZ-Leck Schriftlich", "weight": 50})
    if r.status == 201:
        r = await _ruf("POST", "/api/noten/categories",
                       {"name": "ZZ-Leck Arbeit 1", "section_id": r.json()["id"]})
        if r.status == 201:
            ids["category_id"] = r.json()["id"]
            await _ruf("POST", "/api/noten/entries", {
                "category_id": ids["category_id"], "student_id": ids["student_id"],
                "kind": "grade", "value": 2.0,
            })

    # Klassenarbeit.
    r = await _ruf("POST", "/api/klassenarbeit/works", {"class_id": ids["class_id"], "name": "ZZ-Leck KA"})
    if r.status == 201:
        ids["work_id"] = r.json()["id"]

    # Klassenleitung: Beobachtung und Elternkontakt zum Schüler — die Ansichten
    # daneben, in denen Förderangaben am ehesten „mitgenommen" würden.
    await _ruf("POST", "/api/notizen", {"student_id": ids["student_id"], "text": "ZZ-Leck Beobachtung"})
    await _ruf("POST", "/api/elternlog", {"student_id": ids["student_id"], "text": "ZZ-Leck Elterngespräch"})

    # Code-Detektiv: Sitzung mit sechsstelligem Code (Weg ohne Anmeldung).
    r = await _ruf("POST", "/api/codedetektiv/sessions",
                   {"puzzles": [{"id": "p1", "title": "ZZ-Leck", "blocks": []}]})
    if r.status == 201:
        ids["cd_code"] = r.json().get("code")

    # Kalender-Abo (ICS ohne Anmeldung, nur mit Token).
    r = await _ruf("GET", "/api/kalender/subscribe")
    if r.status == 200:
        ids["ics_token"] = r.json()["url"].rsplit("/", 1)[-1].removesuffix(".ics")

    # Marktplatz: alles veröffentlichen, was sich veröffentlichen lässt.
    veroeffentlicht = []
    r = await _ruf("POST", "/api/marketplace/publish", {"set_id": ids["set_id"], "description": "ZZ-Leck"})
    if r.status == 201:
        veroeffentlicht.append(r.json()["id"])
    if ids.get("deck_id"):
        r = await _ruf("POST", "/api/marketplace/publish/deck", {"deck_id": ids["deck_id"]})
        if r.status == 201:
            veroeffentlicht.append(r.json()["id"])
    if ids.get("method_id"):
        r = await _ruf("POST", "/api/marketplace/publish/method", {"method_id": ids["method_id"]})
        if r.status == 201:
            veroeffentlicht.append(r.json()["id"])
    if ids.get("ladder_id"):
        r = await _ruf("POST", "/api/marketplace/publish/ladder", {"ladder_id": ids["ladder_id"]})
        if r.status == 201:
            veroeffentlicht.append(r.json()["id"])
    ids["marktplatz"] = veroeffentlicht
    if veroeffentlicht:
        ids["quiz_id"] = veroeffentlicht[0]

    # Ein Aufbau, der still weniger anlegt, prüft still weniger. Deshalb hier
    # hart nachfragen statt hoffen: fehlt eins der Stücke, sagt der Test das,
    # statt einen halben Rundlauf als Erfolg zu melden.
    fehlt = [name for name in ("topic_id", "folder_id", "deck_id", "token", "ladder_id",
                               "method_id", "category_id", "work_id", "cd_code", "ics_token")
             if not ids.get(name)]
    assert not fehlt, f"Aufbau unvollständig, diese Testdaten fehlen: {fehlt}"
    assert len(veroeffentlicht) == 4, (
        f"Es sollten vier Marktplatz-Arten veröffentlicht sein, es sind {len(veroeffentlicht)} — "
        "eine ungeprüfte Veröffentlichungsart ist genau die Lücke, um die es geht."
    )

    return ids


# ── Der Rundlauf über alle GET-Routen ────────────────────────────────────────
def _routen():
    """Alle /api-GET-Routen — auch die, die FastAPI in `_IncludedRouter` packt.

    Seit FastAPI 0.14x steht in `app.routes` nicht die Route, sondern ein
    Wrapper um den eingebundenen Router. Wer nur eine Ebene schaut, findet drei
    Routen und hält das fälschlich für „alles geprüft" (siehe
    test_modul_schranke.py, dasselbe Problem).
    """
    def lauf(traeger, tiefe=0):
        if tiefe > 5:
            return
        for r in getattr(traeger, "routes", []):
            if getattr(r, "path", "").startswith("/api/") and hasattr(r, "dependant"):
                yield r
            inner = getattr(r, "original_router", None) or getattr(r, "router", None)
            if inner is not None and inner is not traeger:
                yield from lauf(inner, tiefe + 1)

    gesehen = set()
    for r in lauf(app):
        if "GET" not in (getattr(r, "methods", set()) or set()):
            continue
        if r.path in gesehen:
            continue
        gesehen.add(r.path)
        yield r


# Zusätzliche Abfrageparameter, ohne die eine Route nur mit 422 antwortet —
# eine 422 prüft nichts.
QUERY = {
    "/api/noten/categories/{category_id}/compare": "other_id={category_id}",
    "/api/kalender/entries": "von=2020-01-01&bis=2030-01-01",
    "/api/kalender/external-events": "von=2020-01-01&bis=2030-01-01",
    "/api/kalender/quiz-session": "set_id={set_id}&class_id={class_id}",
    "/api/anwesenheit/{class_id}": "date=2026-01-15",
    "/api/notizen": "student_id={student_id}",
    "/api/notizen/counts": "class_id={class_id}",
    "/api/elternlog": "student_id={student_id}",
    "/api/elternlog/counts": "class_id={class_id}",
    "/api/weak-topics": "frm=2020-01-01T00:00:00&to=2030-01-01T00:00:00",
}

# Für welchen Pfadparameter welcher Wert einzusetzen ist. Mehrdeutige Namen
# (`code`, `token`) haengen an der konkreten Route, nicht am Namen.
SPEZIAL = {
    "/api/codedetektiv/sessions/{code}": {"code": "cd_code"},
    "/api/kalender/feed/{token}.ics": {"token": "ics_token"},
}


def _pfad_fuellen(pfad: str, ids: dict):
    """Setzt echte IDs ein. Gibt None zurück, wenn ein Wert fehlt."""
    ersetzt = pfad
    for name in re.findall(r"{(\w+)}", pfad):
        quelle = SPEZIAL.get(pfad, {}).get(name, name)
        wert = ids.get(quelle)
        if wert in (None, ""):
            if name == "side":
                wert = "front"
            else:
                return None
        ersetzt = ersetzt.replace("{" + name + "}", str(wert))
    return ersetzt


@pytest.mark.asyncio
async def test_keine_get_route_gibt_art9_daten_heraus(welt):
    """Der eigentliche Wert dieses Tests: er erfasst auch neue Routen.

    Jede gemountete GET-Route wird mit echten IDs aufgerufen und die Antwort
    (inklusive ausgepacktem Excel und entpacktem PDF) nach den Markierungen
    durchsucht. Wer künftig einen Endpunkt ergänzt, der Förderschwerpunkte,
    Maßnahmen oder Notizen mitliefert, bekommt hier einen roten Test — statt
    dass es erst jemandem auffällt, dem die Daten in die Hände fallen.
    """
    lecks, ohne_inhalt, geprueft, mit_inhalt = [], [], 0, 0
    for route in _routen():
        if route.path in NICHT_AUTOMATISCH:
            continue
        ziel = _pfad_fuellen(route.path, welt)
        if ziel is None:
            ohne_inhalt.append(f"keine ID {route.path}")
            continue
        query = QUERY.get(route.path, "").format(**{k: v for k, v in welt.items() if isinstance(v, (int, str))})
        antwort = await _ruf("GET", ziel, query=query)
        geprueft += 1
        if antwort.status == 200 and antwort.body:
            mit_inhalt += 1
        else:
            ohne_inhalt.append(f"{antwort.status} {ziel}")
        funde = _funde(antwort)
        if funde and route.path not in ERLAUBT:
            lecks.append(f"{ziel} [{antwort.status}] -> {funde}")

    # Beim Bau des Tests antworteten alle 114 erreichbaren Routen mit 200.
    # Die Grenzen liegen darunter, damit gewollte Umbauten nicht sofort rot
    # werden — aber hoch genug, dass ein still zerfallender Rundlauf auffällt.
    assert geprueft >= 100, (
        f"Nur {geprueft} Routen aufgerufen — der Rundlauf greift nicht mehr "
        f"(fehlende IDs?). Ein Test, der nichts aufruft, findet auch nichts: {ohne_inhalt}"
    )
    assert mit_inhalt >= 95, (
        f"Nur {mit_inhalt} von {geprueft} Routen lieferten Inhalt — dann prüft "
        f"der Rundlauf überwiegend Fehlerseiten: {ohne_inhalt}"
    )
    assert not lecks, (
        "Diese Routen geben besonders schützenswerte Schülerdaten heraus "
        "(DSGVO Art. 9 — Förderschwerpunkt, Nachteilsausgleich, Notiz):\n  "
        + "\n  ".join(lecks)
        + "\nEntweder das Feld dort entfernen oder — wenn es die eigene Ansicht "
          "der Lehrkraft ist — mit Begründung in ERLAUBT eintragen."
    )


def test_die_ausnahmelisten_zeigen_auf_echte_routen():
    """Eine Ausnahme, die auf keine Route mehr zeigt, ist eine Lüge im Test —
    und verdeckt beim nächsten Umbau ein echtes Leck."""
    pfade = {r.path for r in _routen()}
    verwaist = sorted(p for p in (set(ERLAUBT) | set(NICHT_AUTOMATISCH)) if p not in pfade)
    assert not verwaist, f"ERLAUBT/NICHT_AUTOMATISCH nennen Routen, die es nicht gibt: {verwaist}"


@pytest.mark.asyncio
async def test_erlaubnisliste_wird_auch_wirklich_gebraucht(welt):
    """Und umgekehrt: was in ERLAUBT steht, muss die Daten heute auch ausgeben.

    Sonst wächst die Liste zu einem Vorrat an Freibriefen heran, unter dem ein
    späteres, echtes Leck unbemerkt Platz findet. Wer ein Feld aus einer Route
    entfernt, streicht sie hier mit.
    """
    unnoetig = []
    for route in _routen():
        if route.path not in ERLAUBT:
            continue
        ziel = _pfad_fuellen(route.path, welt)
        assert ziel, f"{route.path} steht in ERLAUBT, lässt sich aber nicht aufrufen"
        antwort = await _ruf("GET", ziel, query=QUERY.get(route.path, "").format(
            **{k: v for k, v in welt.items() if isinstance(v, (int, str))}))
        if not _funde(antwort):
            unnoetig.append(f"{ziel} [{antwort.status}]")
    assert not unnoetig, (
        "Diese Routen stehen in ERLAUBT, geben die Art.-9-Felder aber gar nicht "
        f"mehr aus — Eintrag streichen: {unnoetig}"
    )


# ── Veröffentlichung: der Marktplatz ist öffentlich ──────────────────────────
@pytest.mark.asyncio
async def test_marktplatz_traegt_nichts_aus_der_klasse_hinaus(welt):
    """Der Marktplatz ist die einzige Stelle, an der Inhalte einer Lehrkraft
    für alle anderen sichtbar werden. Ein Kartenstapel und eine Lernleiter
    hängen an einer Klasse — dort ist der Weg nach draußen am kürzesten."""
    assert welt["marktplatz"], "Nichts veröffentlicht — der Test prüfte sonst nichts"
    fehler = []
    liste = await _ruf("GET", "/api/marketplace")
    if _funde(liste):
        fehler.append(f"/api/marketplace -> {_funde(liste)}")
    for quiz_id in welt["marktplatz"]:
        einzeln = await _ruf("GET", f"/api/marketplace/{quiz_id}")
        assert einzeln.status == 200
        if _funde(einzeln):
            fehler.append(f"/api/marketplace/{quiz_id} -> {_funde(einzeln)}")
    assert not fehler, f"Veröffentlichung enthält Art.-9-Daten: {fehler}"

    # Und auch im gespeicherten Schnappschuss selbst nicht — die Ansicht könnte
    # heute filtern und morgen nicht mehr.
    async with welt["sitzung"]() as s:
        from app.models import MarketplaceQuiz
        for quiz_id in welt["marktplatz"]:
            quiz = await s.get(MarketplaceQuiz, quiz_id)
            blob = json.dumps(quiz.payload, ensure_ascii=False)
            treffer = [m for m in MARKIERUNGEN if m in blob]
            assert not treffer, f"Schnappschuss {quiz_id} ({quiz.kind}) enthält {treffer}"


# ── Wege ohne Anmeldung ──────────────────────────────────────────────────────
@pytest.mark.asyncio
async def test_schuelerwege_ohne_anmeldung_sehen_nichts(welt):
    """Lernende haben kein Konto; sie kommen über einen Token bzw. einen
    Sitzungscode herein. Was dort ausgegeben wird, sieht ein Kind — und unter
    Umständen sein Sitznachbar. Art.-9-Angaben haben dort nichts verloren.
    """
    ohne_login = []
    if welt.get("token"):
        ohne_login += [f"/api/karten/lernen/{welt['token']}",
                       f"/api/karten/lernen/{welt['token']}/results"]
    if welt.get("cd_code"):
        ohne_login.append(f"/api/codedetektiv/sessions/{welt['cd_code']}")
    if welt.get("ics_token"):
        ohne_login.append(f"/api/kalender/feed/{welt['ics_token']}.ics")
    assert ohne_login, "Kein einziger anmeldefreier Weg aufgebaut — Test wertlos"

    fehler = []
    for pfad in ohne_login:
        antwort = await _ruf("GET", pfad)
        assert antwort.status == 200, f"{pfad} antwortet {antwort.status}: {antwort.body[:200]}"
        if _funde(antwort):
            fehler.append(f"{pfad} -> {_funde(antwort)}")
    assert not fehler, f"Anmeldefreie Wege geben Art.-9-Daten heraus: {fehler}"


@pytest.mark.asyncio
async def test_falscher_token_bekommt_gar_nichts(welt):
    """Gegenprobe: der anmeldefreie Weg darf nicht durch Raten aufgehen."""
    antwort = await _ruf("GET", "/api/karten/lernen/diesentokengibtesnicht")
    assert antwort.status in (401, 403, 404), antwort.status
    assert not _funde(antwort)


# ── Ausgabedateien: PDF, Excel, CSV, ZIP ─────────────────────────────────────
DATEIEN = [
    ("/api/sessions/{session_id}/evaluation-xlsx", "Auswertung als Excel"),
    ("/api/sessions/{session_id}/evaluation-scsv", "Auswertung als CSV"),
    ("/api/sessions/{session_id}/all-students-pdf", "Rückmeldebögen aller Schüler"),
    ("/api/sessions/{session_id}/student-pdf/{card_id}", "Rückmeldebogen eines Schülers"),
    ("/api/classes/{class_id}/all-tests-student-pdf/{card_id}", "alle Tests eines Schülers"),
    ("/api/classes/{class_id}/cards-pdf", "Abstimmkarten der Klasse"),
    ("/api/noten/classes/{class_id}/export", "Notenexport"),
    ("/api/noten/classes/{class_id}/export.zip", "Notenexport als ZIP"),
    ("/api/noten/classes/{class_id}/zeugnis.pdf", "Zeugnisübersicht"),
    ("/api/anwesenheit/{class_id}/report.pdf", "Anwesenheitsbericht"),
    ("/api/anwesenheit/{class_id}/student/{student_id}/report.pdf", "Anwesenheit je Schüler"),
    ("/api/kalender/export", "Kalenderexport"),
    ("/api/methoden/export", "Methodenexport"),
    ("/api/export/question-set/{set_id}", "Quiz-Export"),
    ("/api/export/folder/{folder_id}", "Ordner-Export"),
]


@pytest.mark.asyncio
async def test_ausgabedateien_enthalten_keine_art9_daten(welt):
    """Dateien wandern aus der Anwendung heraus: in Mail-Anhänge, auf Papier,
    in Klassenordner. Was einmal in einer PDF steht, lässt sich nicht mehr
    zurückholen — deshalb wird hier in den Bytes gesucht, nicht im Statuscode.
    """
    fehler, geprueft, ausgefallen = [], [], []
    for muster, name in DATEIEN:
        ziel = _pfad_fuellen(muster, welt)
        antwort = await _ruf("GET", ziel) if ziel else None
        if antwort is None or antwort.status != 200:
            ausgefallen.append(f"{name} ({muster}) [{antwort.status if antwort else 'keine ID'}]")
            continue
        geprueft.append(name)
        if _funde(antwort):
            fehler.append(f"{name} ({ziel}) -> {_funde(antwort)}")
    assert not ausgefallen, (
        "Diese Ausgabedateien liessen sich nicht erzeugen — ungeprüft ist so gut "
        f"wie ungeschützt: {ausgefallen}"
    )
    assert len(geprueft) == len(DATEIEN), f"Nur geprüft: {geprueft}"
    assert not fehler, f"Ausgabedateien enthalten Art.-9-Daten: {fehler}"


@pytest.mark.asyncio
async def test_pdf_wird_wirklich_durchsucht(welt):
    """Ohne diese Gegenprobe wäre die PDF-Prüfung eine Scheinprüfung.

    reportlab schreibt Text in flate-komprimierte Streams. Findet `_lesbar`
    dort den Schülernamen — der im Bogen stehen MUSS —, dann würde es auch eine
    Notiz finden. Schlägt dieser Test fehl, ist nicht das PDF sauber, sondern
    die Suche blind.
    """
    ziel = _pfad_fuellen("/api/sessions/{session_id}/all-students-pdf", welt)
    antwort = await _ruf("GET", ziel)
    assert antwort.status == 200 and antwort.body[:4] == b"%PDF", antwort.status
    text = _lesbar(antwort)
    assert "Leck" in text, (
        "Im PDF ist nicht einmal der Schülername auffindbar — die Suche in "
        "PDF-Bytes greift nicht mehr, jede Sauberkeitsaussage darüber ist wertlos."
    )


@pytest.mark.asyncio
async def test_excel_wird_wirklich_durchsucht(welt):
    """Dieselbe Gegenprobe für Excel: die Zellwerte stecken in XML im ZIP."""
    ziel = _pfad_fuellen("/api/sessions/{session_id}/evaluation-xlsx", welt)
    antwort = await _ruf("GET", ziel)
    assert antwort.status == 200 and antwort.body[:2] == b"PK"
    assert "Anna Leck" in _lesbar(antwort), (
        "Der Schülername steht in der Tabelle, wird aber nicht gefunden — das "
        "Auspacken des xlsx greift nicht mehr."
    )


# ── Gegenprobe: die Felder dürfen nicht aus Vorsicht verschwinden ────────────
@pytest.mark.asyncio
async def test_auskunft_enthaelt_die_felder(welt):
    """DSGVO Art. 15 verlangt Vollständigkeit — hier MÜSSEN die Felder stehen.

    Ohne diese Gegenprobe ließe sich jedes Leck dadurch „beheben", dass die
    Felder überall verschwinden, auch dort, wo die Betroffenenauskunft sie
    schuldet.
    """
    antwort = await _ruf("GET", "/api/me/export")
    assert antwort.status == 200, antwort.body[:300]
    fehlt = [m for m in MARKIERUNGEN if m not in _lesbar(antwort)]
    assert not fehlt, f"Die Selbstauskunft ist unvollständig, es fehlen: {fehlt}"


@pytest.mark.asyncio
async def test_klassen_export_bleibt_sparsam(welt):
    """Der Klassen-Export gibt bewusst nur Kartennummer und Name heraus.

    Er ist eine Datei, die weitergegeben wird — an eine Kollegin, in eine
    andere Installation, notfalls per Mail. Kämen die Art.-9-Angaben hinein,
    wäre aus dem Klassenexport eine Förderakte geworden (so steht es auch als
    Warnung im Router). Der Name muss drin sein, sonst prüft der Test nichts.
    """
    antwort = await _ruf("GET", f"/api/export/class/{welt['class_id']}")
    assert antwort.status == 200, antwort.body[:300]
    text = _lesbar(antwort)
    assert "Anna Leck" in text, "ohne Namen im Export ist die Gegenprobe wertlos"
    assert not _funde(antwort), f"Der Klassen-Export trägt Art.-9-Daten hinaus: {_funde(antwort)}"
