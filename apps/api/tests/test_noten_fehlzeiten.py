"""Passen die zwei Aufrufe zusammen, aus denen die Faerbung im Notenbuch entsteht?

Die Notenseite holt ihre ZEILEN (`/api/noten/classes/{id}/summary`) und ihre
SPALTEN (`/sections`, jede mit Datum) — und dazu die Fehlzeiten
(`/api/anwesenheit/{id}/tage?kanonisch=true&dates=…`). Gefaerbt wird, wo beides
zusammentrifft: derselbe Tag als Schluessel, dieselbe student_id darunter.

Genau daran ist es zweimal gescheitert, ohne dass irgendwo ein Fehler stand:
einmal am Tagesbegriff (UTC statt Schulzeitzone), einmal an zwei verschiedenen
Definitionen von „dieselbe Person". Beide Male blieb die Tabelle einfach farblos.
Deshalb steht hier der ganze Weg als ein Test.

Ende zu Ende auf der echten Logik: Kurs mit Klasse, Kind, Notenspalte mit Datum,
Fehlzeit an dem Tag — und dann genau die zwei Aufrufe, die die Notenseite macht.
"""
from datetime import date as D, datetime, timezone

import pytest

from app.models import User, SchoolClass, Student, Kurs, UserModule, GradeSection, GradeCategory
from app.routers import anwesenheit as an
from app.routers import noten as N


async def _welt(s):
    u = User(email="d@e.de", password_hash="x", name="L"); s.add(u); await s.flush()
    s.add(UserModule(user_id=u.id, module_key="orga"))
    s.add(UserModule(user_id=u.id, module_key="auswertung"))
    k = Kurs(owner_id=u.id, name="WP-INF 8"); s.add(k); await s.flush()
    c = SchoolClass(name="WP-INF 8", owner_id=u.id, kurs_id=k.id); s.add(c); await s.flush()
    st = Student(card_id=1, name="Ibrahim A.", class_id=c.id, kurs_id=k.id); s.add(st); await s.flush()
    sec = GradeSection(owner_id=u.id, class_id=c.id, kurs_id=k.id, term="1", name="Mündlich", weight=30, position=0)
    s.add(sec); await s.flush()
    cat = GradeCategory(owner_id=u.id, class_id=c.id, section_id=sec.id, name="08.09.26",
                        position=0, date=D(2026, 9, 8))
    s.add(cat)
    await s.commit()
    return u, c, st, cat


@pytest.mark.asyncio
async def test_wie_die_notenseite_es_macht(s):
    u, c, st, cat = await _welt(s)

    # 1. Die Lehrkraft trägt in der Anwesenheit ein — so wie der Browser es schickt:
    #    Mitternacht Ortszeit, in UTC also 22:00 des Vortags.
    orts_mitternacht = datetime(2026, 9, 7, 22, 0, tzinfo=timezone.utc)
    await an.mark(c.id, an.MarkIn(student_id=st.id, date=orts_mitternacht, status="fehlt", period=None), user=u, db=s)

    # 2. Die Notenseite holt ihre Zeilen …
    kurs_id = c.kurs_id
    zeilen = await N.summary(c.id, term="1", kurs_id=kurs_id, user=u, db=s)
    ids = [z.student_id for z in zeilen]

    # … und die Spalten (daraus nimmt sie die Datumsangaben).
    abschnitte = await N.list_sections(c.id, term="1", kurs_id=kurs_id, user=u, db=s)
    # So, wie es ueber die Leitung geht (response_model=SectionOut):
    drahtform = [N.SectionOut.model_validate(a) for a in abschnitte]
    tage = [k.date for a in drahtform for k in a.categories]

    # 3. Und dann die Fehlzeiten zu genau diesen Tagen.
    out = await an.get_tage(c.id, dates=",".join(t for t in tage if t), kanonisch=True, user=u, db=s)

    assert tage == ["2026-09-08"], "die Spalte muss ihr Datum als YYYY-MM-DD melden"
    assert "2026-09-08" in out, "der Tag fehlt in der Antwort"
    assert str(ids[0]) in out["2026-09-08"], "der Schlüssel passt nicht zur Zeile der Notenseite"
    assert out["2026-09-08"][str(ids[0])] == "fehlt"
