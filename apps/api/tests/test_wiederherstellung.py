"""Aus einer Sicherung zurückholen: nur Eigenes, mit Vergleich, ohne zu löschen."""
import os

import pytest

from app import models as m
from app import wiederherstellung as wh
from app.routers import backup


@pytest.fixture
def ordner(tmp_path, monkeypatch):
    sich = tmp_path / "sicherungen"
    for name, wert in (("BACKUP_DIR", str(sich)), ("BACKUP_DIR_EXTERN", ""), ("UPLOAD_DIR", str(tmp_path / "up")),
                       ("CONFIG_DIR", str(tmp_path / "cfg"))):
        monkeypatch.setattr(backup, name, wert)
    monkeypatch.setenv("NUVORA_BACKUP_DIR", str(sich))
    (tmp_path / "up").mkdir()
    (tmp_path / "cfg").mkdir()
    return sich


async def _welt(s):
    """Zwei Lehrkräfte; jede mit Klasse, Kind, Spalte und zwei Noten."""
    ids = {}
    for n, mail in ((1, "a@s.de"), (2, "b@s.de")):
        u = m.User(email=mail, password_hash="x", name=f"Lehrkraft {n}", email_verified=True)
        s.add(u)
        await s.flush()
        c = m.SchoolClass(owner_id=u.id, name=f"7{n}")
        s.add(c)
        await s.flush()
        st = m.Student(class_id=c.id, card_id=1, name=f"Kind {n}", notizen="geheim", karten_token=f"tok-{n}")
        s.add(st)
        await s.flush()
        sec = m.GradeSection(owner_id=u.id, class_id=c.id, term="1", name="Mündlich")
        s.add(sec)
        await s.flush()
        cat = m.GradeCategory(owner_id=u.id, class_id=c.id, section_id=sec.id, name="Spalte")
        s.add(cat)
        await s.flush()
        e1 = m.GradeEntry(category_id=cat.id, student_id=st.id, kind="grade", value=2.0, note="gut")
        s.add(e1)
        st2 = m.Student(class_id=c.id, card_id=2, name=f"Zweit {n}")
        s.add(st2)
        await s.flush()
        e2 = m.GradeEntry(category_id=cat.id, student_id=st2.id, kind="grade", value=3.0, note="ok")
        s.add(e2)
        await s.flush()
        ids[n] = {"user": u.id, "e1": e1.id, "e2": e2.id, "st": st.id, "st2": st2.id, "cat": cat.id}
    await s.commit()
    return ids


async def _sichern(s):
    eintrag = await backup.sicherung_erstellen(s)
    return os.path.join(backup.BACKUP_DIR, eintrag["name"])


def test_waechter_jede_tabelle_ist_einem_modul_zugeordnet_oder_ausgenommen():
    """Eine neue Tabelle ohne Eintrag wäre bei der Wiederherstellung unsichtbar — oder, schlimmer, ungeprüft."""
    assert wh.unzugeordnet() == []


def test_waechter_jede_tabelle_gehoert_hoechstens_einem_modul():
    alle = [t for ts in wh.MODULE.values() for t in ts]
    assert len(alle) == len(set(alle)), "eine Tabelle steht in zwei Modulen"
    assert not (set(alle) & wh.AUSGENOMMEN)


@pytest.mark.asyncio
async def test_vergleich_zeigt_fehlt_anders_neu_und_nie_fremdes(s, ordner):
    ids = await _welt(s)
    pfad = await _sichern(s)
    a, b = ids[1], ids[2]
    # danach: A verliert e1, e2 wird geändert, eine neue Note kommt dazu; B verliert ebenfalls etwas
    await s.delete(await s.get(m.GradeEntry, a["e1"]))
    (await s.get(m.GradeEntry, a["e2"])).value = 5.0
    s.add(m.GradeEntry(category_id=a["cat"], student_id=a["st"], kind="grade", value=1.0, note="neu"))
    await s.delete(await s.get(m.GradeEntry, b["e1"]))
    await s.commit()

    sich = wh.lies_sicherung(pfad, a["user"], "auswertung")
    heute = {t: await wh.lade_heute(s, t, rows.keys()) for t, rows in sich["zeilen"].items()}
    erg = wh.vergleiche(sich, heute, await wh.eigene_ids_heute(s, a["user"]))
    tab = next(t for t in erg["tabellen"] if t["tabelle"] == "grade_entries")
    assert [z["id"] for z in tab["fehlt"]] == [a["e1"]]
    assert [z["id"] for z in tab["anders"]] == [a["e2"]]
    feld = tab["anders"][0]["felder"][0]
    assert (feld["spalte"], feld["jetzt"], feld["sicherung"]) == ("value", "5.0", "3.0")
    assert tab["neu_seitdem"] == 1
    await wh.anreichern(s, erg, sich)
    assert tab["fehlt"][0]["bezeichnung"].startswith("Kind 1 · Spalte")        # Kind und Spalte statt nur „value 2.0"
    # B taucht nirgends auf — weder mit Id noch mit Inhalt
    assert b["e1"] not in sich["zeilen"]["grade_entries"] and b["e2"] not in sich["zeilen"]["grade_entries"]
    assert "Kind 2" not in str(erg)


@pytest.mark.asyncio
async def test_einspielen_holt_fehlendes_und_ueberschreibt_nur_Gewaehltes(s, ordner):
    ids = await _welt(s)
    pfad = await _sichern(s)
    a = ids[1]
    await s.delete(await s.get(m.GradeEntry, a["e1"]))
    (await s.get(m.GradeEntry, a["e2"])).value = 5.0
    await s.commit()

    erg = await wh.anwenden(s, pfad, a["user"], "auswertung", [
        {"t": "grade_entries", "id": a["e1"], "aktion": "einfuegen"},
        {"t": "grade_entries", "id": a["e2"], "aktion": "ueberschreiben"},
    ])
    assert erg["eingefuegt"] == 1 and erg["ueberschrieben"] == 1 and erg["uebersprungen"] == []
    s.expire_all()
    e1 = await s.get(m.GradeEntry, a["e1"])
    e2 = await s.get(m.GradeEntry, a["e2"])
    assert (e1.value, e1.note) == (2.0, "gut")          # entschlüsselt lesbar, Chiffretext nicht doppelt verschlüsselt
    assert e2.value == 3.0


@pytest.mark.asyncio
async def test_fremde_zeilen_lassen_sich_nicht_zurueckholen(s, ordner):
    ids = await _welt(s)
    pfad = await _sichern(s)
    a, b = ids[1], ids[2]
    await s.delete(await s.get(m.GradeEntry, b["e1"]))
    await s.commit()
    erg = await wh.anwenden(s, pfad, a["user"], "auswertung", [{"t": "grade_entries", "id": b["e1"], "aktion": "einfuegen"}])
    assert erg["eingefuegt"] == 0 and erg["uebersprungen"][0]["id"] == b["e1"]
    assert await s.get(m.GradeEntry, b["e1"]) is None


@pytest.mark.asyncio
async def test_ueberschreiben_fasst_nichts_an_was_heute_nicht_mehr_eigen_ist(s, ordner):
    ids = await _welt(s)
    pfad = await _sichern(s)
    a, b = ids[1], ids[2]
    # B's Zeile mit A's Konto überschreiben zu wollen scheitert schon an der Sicherung (nicht A's Besitz)
    erg = await wh.anwenden(s, pfad, a["user"], "auswertung", [{"t": "grade_entries", "id": b["e2"], "aktion": "ueberschreiben"}])
    assert erg["ueberschrieben"] == 0 and len(erg["uebersprungen"]) == 1


@pytest.mark.asyncio
async def test_zeile_ohne_ihre_eltern_wird_nicht_eingefuegt_sondern_erklaert(s, ordner):
    ids = await _welt(s)
    pfad = await _sichern(s)
    a = ids[1]
    # Das Kind ist weg (samt Noten über die Kaskade) — die Note allein kann nicht zurück.
    await s.delete(await s.get(m.Student, a["st"]))
    await s.commit()
    erg = await wh.anwenden(s, pfad, a["user"], "auswertung", [{"t": "grade_entries", "id": a["e1"], "aktion": "einfuegen"}])
    assert erg["eingefuegt"] == 0
    assert "students#" in erg["uebersprungen"][0]["grund"]


@pytest.mark.asyncio
async def test_kern_holt_das_kind_zurueck_ohne_den_alten_zugangstoken(s, ordner):
    ids = await _welt(s)
    pfad = await _sichern(s)
    a = ids[1]
    await s.delete(await s.get(m.Student, a["st"]))
    await s.commit()
    erg = await wh.anwenden(s, pfad, a["user"], "kern", [{"t": "students", "id": a["st"], "aktion": "einfuegen"}])
    assert erg["eingefuegt"] == 1, erg
    s.expire_all()
    kind = await s.get(m.Student, a["st"])
    assert kind.name == "Kind 1" and kind.notizen == "geheim"
    assert kind.karten_token is None, "ein alter Zugangstoken darf nicht wiederauferstehen"


@pytest.mark.asyncio
async def test_unzulaessige_auswahl_wird_abgelehnt(s, ordner):
    ids = await _welt(s)
    pfad = await _sichern(s)
    with pytest.raises(ValueError):
        await wh.anwenden(s, pfad, ids[1]["user"], "auswertung", [{"t": "users", "id": 1, "aktion": "ueberschreiben"}])
    with pytest.raises(ValueError):
        await wh.anwenden(s, pfad, ids[1]["user"], "auswertung", [{"t": "grade_entries", "id": 1, "aktion": "loeschen"}])


def test_sicherungspfad_laesst_nur_echte_dateien_im_ordner_zu(ordner):
    ordner.mkdir(parents=True, exist_ok=True)
    (ordner / "nuvora-20261123-101010.zip").write_bytes(b"x")
    assert wh.sicherungs_pfad("nuvora-20261123-101010.zip")
    for schlecht in ("../etc/passwd", "nuvora-20261123-101010.zip/../x", "x.zip", "", "nuvora-20261124-101010.zip"):
        assert wh.sicherungs_pfad(schlecht) is None
