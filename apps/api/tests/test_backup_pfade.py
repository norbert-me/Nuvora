"""Sicherungen: bestimmt die Anfrage, welche Datei angefasst wird?

Die Antwort muss „nein" sein. Ein Endpunkt wie `GET /api/admin/backup/{name}`
ist die klassische Stelle für einen Pfadwechsel: wer `../../etc/passwd`
unterbringt, liest Dateien, die ihn nichts angehen. Dass hier ohnehin nur die
Administration hinkommt, ist kein Ersatz für die Prüfung — sondern der Grund,
warum ein Treffer besonders teuer wäre.

Geprüft wird beides, damit der Beweis nicht an einer Ebene hängt:

  * `_vorhandene_datei()` unmittelbar — auch mit Namen, die über die Route gar
    nicht erst ankämen (absolute Pfade, roher `..`-Anteil).
  * die echten Routen (Herunterladen, Prüfen, Löschen) über denselben winzigen
    ASGI-Aufruf wie `test_backup.py`.

Dazu drei Dinge, die beim Aufräumen der CodeQL-Meldungen aufgefallen sind und
sonst niemand bemerkt hätte:

  * `\\d` traf ohne `re.ASCII` auch arabisch-indische Ziffern.
  * Ein **Symlink** im Ablageordner führte am Muster vorbei aus dem Ordner
    heraus — deshalb wird nach `realpath` belegt, dass das Ergebnis drinliegt.
  * Die Prüfung eines kaputten Archivs gab die Ausnahmemeldung samt Pfaden an
    die Aufruferin weiter.

Lauf:  cd apps/api && pytest tests/test_backup_pfade.py
"""
import pytest
from fastapi import HTTPException

from app.routers import backup
import test_backup

# Alle drei Namen ausdrücklich hergeholt, und zwar auf **einem** Weg: ein
# `import test_backup` neben einem `from test_backup import …` ist zweimal
# dasselbe Modul in zwei Formen (CodeQL py/import-and-import-from).
#
# `welt` ist der Grund für die Form: eine pytest-Fixture wird über den
# Parameternamen gezogen und nie aufgerufen, ein `from … import welt` sähe für
# jeden Prüfer ungenutzt aus. Zugewiesen findet pytest sie unverändert, und es
# steht im Code, dass sie gebraucht wird — statt in einem `# noqa`.
_ruf = test_backup._ruf
_sichern = test_backup._sichern
welt = test_backup.welt


# Namen, die niemals eine Datei bestimmen dürfen. Der rohe `..`-Anteil kommt
# über die Route nicht an (Starlette lässt kein `/` in den Pfadparameter), über
# einen internen Aufruf aber sehr wohl — deshalb steht er hier trotzdem.
BOESE = [
    "../../etc/passwd",
    "/etc/passwd",
    "..%2F..%2Fetc%2Fpasswd",
    "....//....//etc/passwd",
    "nuvora-20260101-000000.zip/../../../etc/passwd",
    "nuvora-20260101-000000.zip.sha256",
    "nuvora-2026.zip",
    "beliebig.zip",
    "",
    ".",
    "..",
    # Ohne `re.ASCII` kam das durch: `\d` trifft in Python auch diese Ziffern.
    "nuvora-٠١٢٣٤٥٦٧-٠١٢٣٤٥.zip",
]


@pytest.mark.asyncio
async def test_vorhandene_datei_weist_jeden_pfadwechsel_ab(welt):  # noqa: F811
    """Kein böser Name darf einen Pfad zurückbekommen — und schon gar keinen
    außerhalb des Ablageordners."""
    await _sichern()
    ordner = str(welt["sicherungen"])
    for name in BOESE:
        with pytest.raises(HTTPException) as raus:
            backup._vorhandene_datei(ordner, name)
        assert raus.value.status_code in (400, 404), f"{name!r} -> {raus.value.status_code}"


@pytest.mark.asyncio
async def test_gueltiger_name_funktioniert_weiter(welt):  # noqa: F811
    """Der Gegenbeweis: die Abwehr darf den Normalfall nicht miterschlagen."""
    eintrag = await _sichern()
    voll = backup._vorhandene_datei(str(welt["sicherungen"]), eintrag["name"])
    assert voll.endswith(eintrag["name"])
    assert backup._liegt_in(voll, str(welt["sicherungen"]))

    r = await _ruf("GET", f"/api/admin/backup/{eintrag['name']}")
    assert r.status == 200 and r.body[:2] == b"PK"
    r = await _ruf("POST", f"/api/admin/backup/{eintrag['name']}/pruefen")
    assert r.status == 200 and r.json()["ok"] is True, r.json()
    r = await _ruf("DELETE", f"/api/admin/backup/{eintrag['name']}")
    assert r.status == 204
    assert not (welt["sicherungen"] / eintrag["name"]).exists()


@pytest.mark.asyncio
async def test_routen_liefern_nichts_und_loeschen_nichts(welt):  # noqa: F811
    """Alle drei Namensrouten, nicht nur der Download — Löschen mit einem
    fremden Pfad wäre der teuerste der drei Fehler."""
    eintrag = await _sichern()
    for name in BOESE:
        for methode, pfad in (("GET", f"/api/admin/backup/{name}"),
                              ("POST", f"/api/admin/backup/{name}/pruefen"),
                              ("DELETE", f"/api/admin/backup/{name}")):
            r = await _ruf(methode, pfad)
            assert r.status in (400, 404, 405, 307), f"{methode} {name!r} -> {r.status}"
            assert b"root:" not in r.body, f"{methode} {name!r} hat /etc/passwd ausgeliefert"
    # Und die echte Sicherung liegt unversehrt da.
    assert (welt["sicherungen"] / eintrag["name"]).is_file()


@pytest.mark.asyncio
async def test_symlink_aus_dem_ordner_heraus_wird_nicht_ausgeliefert(welt):  # noqa: F811
    """Ein Name kann dem Muster entsprechen und trotzdem woanders hinzeigen.
    Deshalb reicht die Musterprüfung nicht — es zählt, wo die Datei liegt."""
    await _sichern()
    ziel = welt["tmp"] / "geheim.txt"
    ziel.write_bytes(b"root:x:0:0:GEHEIM")
    link = welt["sicherungen"] / "nuvora-20990101-000000.zip"
    link.symlink_to(ziel)

    with pytest.raises(HTTPException) as raus:
        backup._vorhandene_datei(str(welt["sicherungen"]), link.name)
    assert raus.value.status_code == 404

    r = await _ruf("GET", f"/api/admin/backup/{link.name}")
    assert r.status == 404
    assert b"GEHEIM" not in r.body


@pytest.mark.asyncio
async def test_pruefung_gibt_keine_ausnahmemeldung_heraus(welt):  # noqa: F811
    """Ein kaputtes Archiv muss gemeldet werden — aber ohne Pfade, Zeilennummern
    oder Ausnahmetext. Die gehören ins Protokoll des Dienstes."""
    await _sichern()
    kaputt = welt["sicherungen"] / "nuvora-20990102-000000.zip"
    kaputt.write_bytes(b"kein zip, nur muell")

    bericht = backup.pruefen("lokal", kaputt.name)
    assert bericht["ok"] is False and bericht["fehler"]
    text = " ".join(bericht["fehler"])
    assert "Archiv nicht lesbar" in text
    for verraeterisch in (str(welt["tmp"]), "Traceback", ".py", "File \""):
        assert verraeterisch not in text, f"Die Antwort verraet zu viel: {text}"


def test_anleitung_hat_alle_schritte():
    """`anleitung()` besteht aus mehrzeiligen Einträgen. Fehlt irgendwo ein
    Trennzeichen, kleben zwei Schritte still zusammen und einer verschwindet —
    das faellt sonst niemandem auf."""
    schritte = backup.anleitung()
    # Schritt 0 ist der Weg über die Oberfläche (hochladen, Probelauf,
    # einspielen); 1–5 sind der Weg von Hand für den Fall, dass die Oberfläche
    # nicht mehr läuft.
    assert len(schritte) == 7, schritte
    for nummer, schritt in enumerate(schritte[:6], start=0):
        assert schritt.startswith(f"{nummer}. "), schritt
    assert schritte[6].startswith("Nicht enthalten")


def test_pflichteintraege_sind_einzelne_namen():
    """Dieselbe Falle bei den Konstanten: `("a.json" "b.ndjson")` waere ein
    einziger Name — und die Vollstaendigkeitspruefung damit blind."""
    for eintrag in backup.PFLICHT_EINTRAEGE:
        assert eintrag.count(".") == 1, f"Zwei Namen zusammengeklebt: {eintrag!r}"
    assert set(backup.PFLICHT_EINTRAEGE) == {"manifest.json", "datenbank.ndjson"}
    assert len(backup.PLAENE) == 3 and "aus" in backup.PLAENE
