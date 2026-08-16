"""Der Themenstand wird nachgerechnet, nicht geglaubt.

Er beantwortet zwei Fragen, die eine einzelne Arbeit nicht beantwortet: „Wie gut
sitzt dieses Unterthema?" und „Wird es besser?" — und beide dürfen nicht aus zu
wenigen Punkten behauptet werden.
"""
from datetime import datetime, timedelta, timezone

import pytest

from app.models import Card, CardDeck, CardReview, SchoolClass, Student, Topic, User, UserModule
from app.routers import karten as K
from app.themenprofil import (MINDEST_KARTEN, MINDEST_PUNKTE, Erhebung, KartenStand,
                              Messung, profil)

START = datetime(2026, 2, 1)


def erhebung(nr, tage, *messungen, art="arbeit"):
    return Erhebung(id=nr, name=f"E{nr}", datum=START + timedelta(days=tage), art=art,
                    messungen=[Messung(t, e, m) for t, e, m in messungen])


def finde(res, topic_id):
    return next(x for x in res if x["topic_id"] == topic_id)


def test_punkte_werden_nach_gewicht_zusammengefasst():
    # 3/10 und 8/10 → 11 von 20 Punkten = 55 %, NICHT der Mittelwert der
    # Prozentwerte (der waere 55 % nur zufaellig gleich; bei ungleichen
    # Maximalpunkten laufen beide auseinander).
    res = profil([erhebung(1, 0, (1, 3, 10)), erhebung(2, 30, (1, 8, 10))])
    t = finde(res, 1)
    assert t["punkte"] == 11.0 and t["max"] == 20.0
    assert t["pct"] == 55.0


def test_grosse_aufgabe_wiegt_schwerer_als_kleine():
    # 1/1 (perfekt) und 2/9 (schwach) → 3 von 10 = 30 %. Der Mittelwert der
    # Quoten waere 61 % und wuerde das Koennen deutlich zu gut darstellen.
    res = profil([erhebung(1, 0, (1, 1, 1)), erhebung(2, 30, (1, 2, 9))])
    assert finde(res, 1)["pct"] == 30.0


def test_zu_wenige_punkte_ergeben_keine_zahl():
    res = profil([erhebung(1, 0, (7, 1, 3))])
    t = finde(res, 7)
    assert t["genug"] is False
    assert t["pct"] is None          # kein Prozentwert, der nach Wissen aussieht
    assert t["max"] < MINDEST_PUNKTE


def test_trend_erkennt_verbesserung():
    # 30 %, 55 %, 80 % — erste Haelfte gegen zweite.
    res = profil([erhebung(1, 0, (1, 3, 10)), erhebung(2, 20, (1, 5.5, 10)),
                  erhebung(3, 40, (1, 8, 10))])
    t = finde(res, 1)
    assert t["trend"]["richtung"] == "auf"
    assert t["trend"]["delta"] > 10


def test_trend_erkennt_verschlechterung():
    res = profil([erhebung(1, 0, (1, 9, 10)), erhebung(2, 20, (1, 6, 10)),
                  erhebung(3, 40, (1, 3, 10))])
    assert finde(res, 1)["trend"]["richtung"] == "ab"


def test_kleine_schwankung_ist_kein_trend():
    # 60 %, 65 %, 62 % — das ist Rauschen zwischen zwei Arbeiten, kein Verlauf.
    res = profil([erhebung(1, 0, (1, 6, 10)), erhebung(2, 20, (1, 6.5, 10)),
                  erhebung(3, 40, (1, 6.2, 10))])
    assert finde(res, 1)["trend"]["richtung"] == "gleich"


def test_zwei_messpunkte_ergeben_noch_keinen_trend():
    # Bewusst: aus zwei Arbeiten eine Richtung abzulesen waere geraten.
    res = profil([erhebung(1, 0, (1, 3, 10)), erhebung(2, 30, (1, 9, 10))])
    assert finde(res, 1)["trend"] is None


def test_quiz_und_arbeit_zaehlen_zusammen():
    res = profil([erhebung(1, 0, (1, 3, 10)),
                  erhebung(2, 10, (1, 2, 4), art="quiz")])
    t = finde(res, 1)
    assert t["erhebungen"] == 2
    assert {p["art"] for p in t["verlauf"]} == {"arbeit", "quiz"}
    assert t["pct"] == 35.7          # 5 von 14 Punkten


def test_schwaechstes_thema_steht_oben_duennes_am_ende():
    res = profil([erhebung(1, 0, (1, 9, 10), (2, 2, 10), (3, 1, 2))])
    assert [x["topic_id"] for x in res] == [2, 1, 3]   # 20 %, 90 %, dann „zu dünn"


# ─── Dritte Quelle: Karteikarten ───

def stand(treffer, patzer, karten, faellig=0):
    """Ein Kartenstand, wie ihn `karten.themen_lernstand` liefert."""
    return KartenStand(treffer=treffer, versuche=treffer + patzer, karten=karten, faellig=faellig)


def test_karten_zaehlen_versuche_nicht_karten():
    # 4 Karten, zusammen 7 Treffer bei 10 Versuchen = 70 %. Die Zahl der Karten
    # ist NICHT der Nenner — eine oft geuebte Karte wiegt mehr als eine einmal
    # gesehene, weil mehr gemessen wurde.
    res = profil([], {1: stand(7, 3, 4)})
    t = finde(res, 1)
    assert t["pct"] == 70.0
    assert t["punkte"] == 7.0 and t["max"] == 10.0
    assert t["quellen"] == ["karten"]


def test_karten_und_erhebungen_landen_in_einer_zahl():
    # Arbeit 3/10 plus Karten 6/10 → 9 von 20 = 45 %, und die Herkunft steht
    # dabei.
    res = profil([erhebung(1, 0, (1, 3, 10))], {1: stand(6, 4, 5)})
    t = finde(res, 1)
    assert t["pct"] == 45.0
    assert t["quellen"] == ["arbeit", "karten"]


def test_karten_stehen_nicht_im_verlauf_und_nicht_im_trend():
    # Karten haben kein Datum — sie duerfen die Zeitleiste nicht auffuellen,
    # sonst behauptet der Trend einen Verlauf, den niemand gemessen hat.
    res = profil([erhebung(1, 0, (1, 3, 10)), erhebung(2, 20, (1, 5, 10))],
                 {1: stand(9, 1, 6)})
    t = finde(res, 1)
    assert t["erhebungen"] == 2
    assert [v["art"] for v in t["verlauf"]] == ["arbeit", "arbeit"]
    assert t["trend"] is None          # zwei Messpunkte bleiben zwei Messpunkte


def test_zu_wenige_karten_ergeben_keine_zahl_aber_die_faelligen():
    # Zwei Karten sind ein Einzelfall, kein Thema — auch wenn genug Versuche
    # zusammenkommen. Gezeigt wird trotzdem, was ansteht.
    res = profil([], {1: stand(6, 2, MINDEST_KARTEN - 1, faellig=4)})
    t = finde(res, 1)
    assert t["genug"] is False and t["pct"] is None
    assert t["max"] == 0.0             # der Stand geht gar nicht erst ein
    assert t["quellen"] == []
    assert t["faellig"] == 4           # die Zaehlung bleibt, sie bewertet nichts
    assert t["karten"]["zaehlt"] is False


def test_zu_wenige_versuche_ergeben_keine_zahl():
    # Drei Karten, aber je nur ein Versuch: unter MINDEST_PUNKTE bleibt es beim
    # Hinweis — dieselbe Zurueckhaltung wie bei Arbeiten.
    res = profil([], {1: stand(2, 1, 3)})
    t = finde(res, 1)
    assert t["max"] == 3.0 < MINDEST_PUNKTE
    assert t["genug"] is False and t["pct"] is None


def test_karten_thema_ohne_erhebung_verschwindet_nicht():
    # Ein Thema, das es nur in den Karten gibt, gehoert in die Liste — „4
    # faellig, zu wenig fuer eine Aussage" ist eine Auskunft, eine fehlende
    # Zeile waere keine.
    res = profil([erhebung(1, 0, (1, 8, 10))], {9: stand(0, 0, 0, faellig=4)})
    assert {x["topic_id"] for x in res} == {1, 9}
    assert finde(res, 9)["faellig"] == 4


def test_ohne_karten_rechnet_alles_wie_vorher():
    # Regel 3: ohne das Modul „Karten" faellt nur die Quelle weg.
    ohne = finde(profil([erhebung(1, 0, (1, 3, 10))]), 1)
    assert ohne["pct"] == 30.0 and ohne["faellig"] == 0 and ohne["karten"] is None


# ─── Die Kartenquelle selbst: was gezaehlt wird und was nicht ───


async def _aufbau(s, niveau_aktiv=False):
    """Eine Klasse, ein E- und ein G-Kind, ein ausgerollter Stapel mit Thema."""
    u = User(email="l@d.de", password_hash="x", name="L")
    s.add(u)
    await s.flush()
    s.add(UserModule(user_id=u.id, module_key="karten"))
    thema = Topic(owner_id=u.id, name="Bruchrechnung")
    cls = SchoolClass(name="7a", owner_id=u.id)
    s.add_all([thema, cls])
    await s.flush()
    e_kind = Student(card_id=1, name="Ida", class_id=cls.id, niveau="E")
    g_kind = Student(card_id=2, name="Ben", class_id=cls.id, niveau="G")
    deck = CardDeck(owner_id=u.id, class_id=cls.id, name="Brueche", topic_id=thema.id,
                    niveau_aktiv=niveau_aktiv,
                    released_at=datetime.now(timezone.utc) - timedelta(hours=1))
    s.add_all([e_kind, g_kind, deck])
    await s.flush()
    await s.commit()
    return u, cls, thema, e_kind, g_kind, deck


async def _karte(s, deck, niveau="", pos=0):
    c = Card(deck_id=deck.id, front=f"F{pos}", back="R", position=pos, niveau=niveau)
    s.add(c)
    await s.flush()
    return c


def _rev(s, kind, karte, reps, lapses, due=None):
    s.add(CardReview(student_id=kind.id, card_id=karte.id, reps=reps, lapses=lapses,
                     due=due or datetime.now(timezone.utc) - timedelta(days=1)))


@pytest.mark.asyncio
async def test_schwache_karte_verschwindet_nicht(s):
    """Der Fehler, der schon einmal passiert ist: nach `reps > 0` filtern.

    SM-2 setzt `reps` beim Fehler auf 0 zurueck und zaehlt `lapses` hoch — eine
    Karte mit reps=0, lapses=3 ist die SCHWAECHSTE im Stapel. Wer sie
    wegfiltert, sieht nur noch die Karten, die sitzen, und meldet ein sicheres
    Thema.
    """
    u, cls, thema, e_kind, g_kind, deck = await _aufbau(s)
    a, b, c = [await _karte(s, deck, pos=i) for i in range(3)]
    _rev(s, e_kind, a, reps=0, lapses=3)       # dreimal daneben
    _rev(s, e_kind, b, reps=2, lapses=0)
    _rev(s, e_kind, c, reps=1, lapses=1)
    await s.commit()

    stand = (await K.themen_lernstand(s, u, cls.id, [e_kind]))[e_kind.id][thema.id]
    assert stand.karten == 3                    # die schwache Karte zaehlt mit
    assert stand.treffer == 3 and stand.versuche == 7      # 3 Treffer, 4 Patzer
    assert profil([], {thema.id: stand})[0]["pct"] == 42.9


@pytest.mark.asyncio
async def test_g_kind_bekommt_keine_e_karten_angerechnet(s):
    """Ein G-Kind sieht die E-Karten nie — also darf es dafuer auch keinen
    Rueckstand angerechnet bekommen (weder als faellig noch als Versuch)."""
    u, cls, thema, e_kind, g_kind, deck = await _aufbau(s, niveau_aktiv=True)
    frei = await _karte(s, deck, pos=0)
    await _karte(s, deck, niveau="E", pos=1)
    # Die freie Karte sitzt beim E-Kind (naechster Termin in der Zukunft).
    _rev(s, e_kind, frei, reps=1, lapses=0, due=datetime.now(timezone.utc) + timedelta(days=5))
    await s.commit()

    alle = await K.themen_lernstand(s, u, cls.id, [e_kind, g_kind])
    assert alle[e_kind.id][thema.id].faellig == 1       # nur die E-Karte offen
    assert alle[g_kind.id][thema.id].faellig == 1       # nur die freie Karte
    # Die E-Karte taucht beim G-Kind nirgends auf: eine offene Karte, nicht zwei.
    assert alle[g_kind.id][thema.id].karten == 0


@pytest.mark.asyncio
async def test_ohne_niveau_schalter_sehen_alle_alle_karten(s):
    """`card_decks.niveau_aktiv` schaltet die Unterscheidung je Karte erst ein.
    Aus heisst: das Niveau an der Karte spielt keine Rolle."""
    u, cls, thema, e_kind, g_kind, deck = await _aufbau(s, niveau_aktiv=False)
    await _karte(s, deck, pos=0)
    await _karte(s, deck, niveau="E", pos=1)
    await s.commit()

    alle = await K.themen_lernstand(s, u, cls.id, [g_kind])
    assert alle[g_kind.id][thema.id].faellig == 2


@pytest.mark.asyncio
async def test_entwurf_und_stapel_ohne_thema_zaehlen_nicht(s):
    """Ein nicht ausgerollter Stapel ist fuer niemanden faellig, und ein Stapel
    ohne Thema gehoert in keine Themenzeile."""
    u, cls, thema, e_kind, g_kind, deck = await _aufbau(s)
    entwurf = CardDeck(owner_id=u.id, class_id=cls.id, name="Entwurf", topic_id=thema.id,
                       released_at=None)
    ohne_thema = CardDeck(owner_id=u.id, class_id=cls.id, name="Frei", topic_id=None,
                          released_at=datetime.now(timezone.utc) - timedelta(hours=1))
    s.add_all([entwurf, ohne_thema])
    await s.flush()
    await _karte(s, entwurf, pos=0)
    await _karte(s, ohne_thema, pos=0)
    await _karte(s, deck, pos=0)
    await s.commit()

    stand = (await K.themen_lernstand(s, u, cls.id, [e_kind]))[e_kind.id]
    assert list(stand) == [thema.id] and stand[thema.id].faellig == 1


@pytest.mark.asyncio
async def test_geloeschte_karte_bleibt_nicht_ewig_faellig(s):
    """Wie in der Fortschrittsuebersicht: was geloescht ist, wird nie gelernt —
    und darf deshalb nicht dauerhaft als offen dastehen."""
    u, cls, thema, e_kind, g_kind, deck = await _aufbau(s)
    weg = await _karte(s, deck, pos=0)
    weg.deleted_at = datetime.now(timezone.utc)
    await _karte(s, deck, pos=1)
    await s.commit()

    assert (await K.themen_lernstand(s, u, cls.id, [e_kind]))[e_kind.id][thema.id].faellig == 1


@pytest.mark.asyncio
async def test_karte_mit_zukuenftigem_termin_ist_nicht_faellig(s):
    u, cls, thema, e_kind, g_kind, deck = await _aufbau(s)
    a = await _karte(s, deck, pos=0)
    _rev(s, e_kind, a, reps=2, lapses=0, due=datetime.now(timezone.utc) + timedelta(days=5))
    await s.commit()

    stand = (await K.themen_lernstand(s, u, cls.id, [e_kind]))[e_kind.id][thema.id]
    assert stand.faellig == 0 and stand.karten == 1 and stand.versuche == 2
