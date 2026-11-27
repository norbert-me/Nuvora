"""Personenbezogene Spalten sind verschluesselt — und bleiben es.

Die Tests pruefen die Zusage, nicht die Mechanik: in der Datenbank steht
Chiffretext, die Anwendung sieht Klartext, ein falscher Schluessel oder eine
veraenderte Zelle faellt laut auf, und der Bestand im Klartext wird beim Start
umgeschrieben, ohne dass etwas verloren geht.
"""

import pytest
from sqlalchemy import select, text

from app import krypto, verschluesselung
from app.models import (Base, GradeEntry, SchoolClass,
                        Student, User, WorkAnalysis)


async def _roh(s, tabelle, spalte, pk):
    """Die Zelle so, wie sie in der Datenbank steht (ohne Entschluesselung)."""
    return (await s.execute(text(f"SELECT {spalte} FROM {tabelle} WHERE id = :i"), {"i": pk})).scalar()


async def _klasse(s):
    u = User(email="a@schule.de", password_hash="x", name="Frau Beispiel", email_verified=True)
    s.add(u)
    await s.flush()
    c = SchoolClass(owner_id=u.id, name="7a")
    s.add(c)
    await s.flush()
    return u, c


@pytest.mark.asyncio
async def test_in_der_datenbank_steht_chiffretext_die_anwendung_sieht_klartext(s):
    u, c = await _klasse(s)
    st = Student(class_id=c.id, card_id=1, name="Anna Muster", foerder=["LRS"],
                 massnahmen=[{"art": "Zeit", "arbeit": True}], notizen="Dyskalkulie",
                 klassenlehrer="Herr Lehmann", photo=b"\xff\xd8\xffJPEGDATEN")
    s.add(st)
    await s.flush()
    g = GradeEntry(category_id=None, student_id=st.id, kind="grade", value=2.3, tendency=1, note="mündlich gut")
    s.add(g)
    await s.commit()
    sid, gid, uid = st.id, g.id, u.id

    for tab, col, pk, klar in [
        ("students", "name", sid, "Anna Muster"),
        ("students", "notizen", sid, "Dyskalkulie"),
        ("students", "foerder", sid, "LRS"),
        ("students", "klassenlehrer", sid, "Lehmann"),
        ("grade_entries", "note", gid, "mündlich"),
        ("users", "email", uid, "a@schule.de"),
        ("users", "name", uid, "Beispiel"),
    ]:
        roh = await _roh(s, tab, col, pk)
        assert isinstance(roh, str) and roh.startswith(krypto.PRAEFIX), f"{tab}.{col} steht im Klartext: {roh!r}"
        assert klar not in roh
    # Noten stehen nicht als Zahl da
    assert str(await _roh(s, "grade_entries", "value", gid)).startswith(krypto.PRAEFIX)
    foto = await _roh(s, "students", "photo", sid)
    assert bytes(foto).startswith(krypto.PRAEFIX_B) and b"JPEGDATEN" not in bytes(foto)

    s.expire_all()
    st2 = (await s.execute(select(Student).where(Student.id == sid))).scalar_one()
    assert st2.name == "Anna Muster" and st2.foerder == ["LRS"] and st2.notizen == "Dyskalkulie"
    assert st2.massnahmen == [{"art": "Zeit", "arbeit": True}]
    g2 = (await s.execute(select(GradeEntry).where(GradeEntry.id == gid))).scalar_one()
    assert g2.value == 2.3 and g2.tendency == 1 and g2.note == "mündlich gut"


@pytest.mark.asyncio
async def test_gleicher_text_gibt_verschiedenen_chiffretext(s):
    """Sonst saehe man, welche Kinder gleich heissen oder dieselbe Note haben."""
    u, c = await _klasse(s)
    a = Student(class_id=c.id, card_id=1, name="Max")
    b = Student(class_id=c.id, card_id=2, name="Max")
    s.add_all([a, b])
    await s.commit()
    assert await _roh(s, "students", "name", a.id) != await _roh(s, "students", "name", b.id)


@pytest.mark.asyncio
async def test_email_wird_ueber_den_suchwert_gefunden(s):
    u, _ = await _klasse(s)
    await s.commit()
    gefunden = (await s.execute(select(User).where(User.email_idx == krypto.suchwert("  A@Schule.DE ")))).scalar_one()
    assert gefunden.id == u.id and gefunden.email == "a@schule.de"
    # Suchwert folgt einer Adressaenderung
    gefunden.email = "neu@schule.de"
    await s.commit()
    assert (await s.execute(select(User).where(User.email_idx == krypto.suchwert("neu@schule.de")))).scalar_one().id == u.id
    assert (await s.execute(select(User).where(User.email_idx == krypto.suchwert("a@schule.de")))).first() is None


def test_falscher_schluessel_und_veraenderte_zelle_scheitern_laut(monkeypatch):
    zelle = krypto.text_verschluesseln("Anna", "students.name")
    assert krypto.text_entschluesseln(zelle, "students.name") == "Anna"
    # in eine andere Spalte kopiert → AAD stimmt nicht
    with pytest.raises(krypto.DatenschluesselFehler):
        krypto.text_entschluesseln(zelle, "students.notizen")
    # veraendert
    kaputt = zelle[:-4] + ("AAAA" if not zelle.endswith("AAAA") else "BBBB")
    with pytest.raises(krypto.DatenschluesselFehler):
        krypto.text_entschluesseln(kaputt, "students.name")
    # anderer Schluessel
    monkeypatch.setenv(krypto.ENV, krypto.neuer_schluessel())
    with pytest.raises(krypto.DatenschluesselFehler):
        krypto.text_entschluesseln(zelle, "students.name")


def test_fehlender_oder_kaputter_schluessel_meldet_sich(monkeypatch):
    monkeypatch.delenv("NUVORA_LOKAL", raising=False)
    monkeypatch.setenv(krypto.ENV, "")
    with pytest.raises(krypto.DatenschluesselFehler, match="fehlt"):
        krypto.text_verschluesseln("x", "a.b")
    monkeypatch.setenv(krypto.ENV, "zu-kurz")
    with pytest.raises(krypto.DatenschluesselFehler):
        krypto.text_verschluesseln("x", "a.b")


@pytest.mark.asyncio
async def test_klartext_bestand_bleibt_lesbar_und_wird_beim_start_umgeschrieben(s):
    u, c = await _klasse(s)
    await s.commit()
    # Bestand von vor der Umstellung: Klartext direkt in die Zellen
    await s.execute(text("INSERT INTO students (id, class_id, card_id, position, name, foerder, massnahmen, notizen, "
                         "klassenlehrer, photo_mime, niveau) VALUES (900, :c, 1, 0, 'Altbestand', '[\"LRS\"]', NULL, "
                         "'alte Notiz', 'Lehmann', '', '')"), {"c": c.id})
    await s.execute(text("INSERT INTO grade_entries (id, student_id, kind, value, tendency, note, term) "
                         "VALUES (901, 900, 'grade', 2.7, -1, 'alt', '1')"))
    await s.commit()
    s.expire_all()
    # lesbar schon vor dem Umschreiben
    alt = (await s.execute(select(Student).where(Student.id == 900))).scalar_one()
    assert alt.name == "Altbestand" and alt.foerder == ["LRS"]
    g = (await s.execute(select(GradeEntry).where(GradeEntry.id == 901))).scalar_one()
    assert g.value == 2.7 and g.tendency == -1

    engine = s.bind
    n = await verschluesselung.bestand_verschluesseln(engine)
    assert n.get("students.name", 0) >= 1 and n.get("grade_entries.value", 0) >= 1
    for tab, col, pk in [("students", "name", 900), ("students", "foerder", 900), ("grade_entries", "value", 901),
                         ("grade_entries", "note", 901), ("students", "notizen", 900)]:
        assert str(await _roh(s, tab, col, pk)).startswith(krypto.PRAEFIX), f"{tab}.{col}"
    s.expire_all()
    alt = (await s.execute(select(Student).where(Student.id == 900))).scalar_one()
    assert (alt.name, alt.foerder, alt.notizen, alt.klassenlehrer) == ("Altbestand", ["LRS"], "alte Notiz", "Lehmann")
    g = (await s.execute(select(GradeEntry).where(GradeEntry.id == 901))).scalar_one()
    assert (g.value, g.tendency, g.note) == (2.7, -1, "alt")
    # idempotent: ein zweiter Lauf fasst nichts mehr an
    assert await verschluesselung.bestand_verschluesseln(engine) == {}


@pytest.mark.asyncio
async def test_pruefwert_schuetzt_vor_einem_falschen_schluessel(s, monkeypatch):
    assert await verschluesselung.pruefwert_pruefen(s) == "neu"
    assert await verschluesselung.pruefwert_pruefen(s) == "ok"
    monkeypatch.setenv(krypto.ENV, krypto.neuer_schluessel())
    with pytest.raises(krypto.DatenschluesselFehler, match="passt nicht"):
        await verschluesselung.pruefwert_pruefen(s)


@pytest.mark.asyncio
async def test_json_spalten_der_klassenarbeit_sind_verschluesselt(s):
    u, c = await _klasse(s)
    w = WorkAnalysis(owner_id=u.id, class_id=c.id, name="Arbeit 1", results={"5": {"a": 3}}, absent=[5])
    s.add(w)
    await s.commit()
    wid = w.id
    roh = await _roh(s, "work_analyses", "results", wid)
    assert str(roh).startswith(krypto.PRAEFIX)
    s.expire_all()
    w2 = (await s.execute(select(WorkAnalysis).where(WorkAnalysis.id == wid))).scalar_one()
    assert w2.results == {"5": {"a": 3}} and w2.absent == [5]


# ── Waechter ────────────────────────────────────────────────────────────────
# Spalten, die personenbezogen sind und deshalb verschluesselt sein MUESSEN.
# Wer hier eine streicht, trifft eine Datenschutz-Entscheidung und schreibt sie auf.
MUSS_VERSCHLUESSELT = {
    "students": {"name", "foerder", "massnahmen", "notizen", "klassenlehrer", "photo", "photo_thumb"},
    "persons": {"name", "foerder", "massnahmen", "notizen", "klassenlehrer", "photo", "photo_thumb"},
    "users": {"email", "name", "pending_email", "untis_benutzer", "untis_ics_url", "external_ics_url"},
    "grade_entries": {"value", "tendency", "note"},
    "attendance": {"note"},
    "observations": {"category", "text"},
    "parent_contacts": {"text"},
    "notepad_notes": {"title", "content"},
    "todos": {"text", "notiz"},
    "pap_abgaben": {"daten"},
    "waage_abgaben": {"daten"},
    "work_analyses": {"results", "fehler", "wechsel", "absent", "unbewertet"},
    "bug_reports": {"email", "message"},
}


def test_waechter_personenbezogene_spalten_sind_verschluesselt():
    for tab, spalten in MUSS_VERSCHLUESSELT.items():
        t = Base.metadata.tables[tab]
        for sp in spalten:
            assert krypto.ist_enc(t.c[sp]), f"{tab}.{sp} muss verschluesselt sein (app/krypto.py)"


def test_waechter_jede_enc_spalte_traegt_ihr_label_und_hat_eine_id():
    """Das Label ist die AAD: stimmt es nicht mit Tabelle.Spalte ueberein, schuetzt es nichts
    (und die Migration braucht `id` als Schluessel)."""
    for t, c in verschluesselung.enc_spalten():
        assert c.type.label == f"{t.name}.{c.name}", f"{t.name}.{c.name}: Label {c.type.label!r}"
        assert "id" in t.c, f"{t.name} hat keine id — die Bestandsmigration braucht sie"


def test_waechter_email_ist_eindeutig_ueber_den_suchwert():
    t = Base.metadata.tables["users"]
    assert not t.c.email.unique and krypto.ist_enc(t.c.email)
    assert t.c.email_idx.unique


def test_waechter_jeder_enc_typ_hat_einen_cache_key():
    """`cache_ok` muss auf JEDER Unterklasse stehen. Fehlt es, schaltet SQLAlchemy das
    Statement-Caching fuer jede Abfrage mit dieser Spalte ab — das kostet im Betrieb
    spuerbar Zeit und faellt nur als Warnung im Protokoll auf."""
    for cls in (krypto.EncStr, krypto.EncJSON, krypto.EncFloat, krypto.EncInt, krypto.EncBytes):
        assert cls.__dict__.get("cache_ok") is True, f"{cls.__name__}.cache_ok fehlt"
