"""Karteikarten: Auswertung je Stapel — welche Karte faellt schwer?

Geprueft wird das, was man der Zahl nicht ansieht:

- die Quote wird nachgerechnet (`Treffer = reps`, `Versuche = reps + lapses`;
  eine Karte mit `reps=0, lapses=3` ist die schwaechste im Stapel, nicht die
  unbenutzte),
- die MINDESTZAHL: unter `MINDEST_VERSUCHE` gibt es keine Quote, sondern „zu
  wenig Daten" — und solche Karten stehen am Ende, nicht an der Spitze,
- E/G: ein G-Kind erzeugt an einer E-Karte keine Versuche und zaehlt dort auch
  nicht als „sichtbar",
- fremder Stapel/Kurs und abgeschaltetes Modul kommen gar nicht erst durch.
"""
import pytest
from fastapi import HTTPException

from app.models import (Kurs, KursTag, SchoolClass, Student, User, UserModule)
from app.routers import karten as K


async def _lehrkraft(s, mail="l@d.de", modul=True):
    u = User(email=mail, password_hash="x", name="L")
    s.add(u)
    await s.flush()
    if modul:
        s.add(UserModule(user_id=u.id, module_key="karten"))
    await s.commit()
    return u


async def _kurs_mit_kindern(s, u, name, kinder):
    """Ein Kurs mit Fach-Klasse; `kinder` ist [(token, niveau), …]."""
    k = Kurs(owner_id=u.id, name=name)
    s.add(k)
    await s.flush()
    c = SchoolClass(name=f"{name} Klasse", owner_id=u.id, kurs_id=k.id)
    s.add(c)
    await s.flush()
    s.add(KursTag(kurs_id=k.id, class_id=c.id))
    out = []
    for i, (token, niveau) in enumerate(kinder, start=1):
        st = Student(card_id=i, position=i, name=f"Kind {token}", class_id=c.id,
                     karten_token=token, niveau=niveau)
        s.add(st)
        out.append(st)
    await s.commit()
    return k, c, out


async def _stapel(s, u, kurs, karten, niveau_aktiv=False):
    """Stapel in der Sammlung, dem Kurs zugewiesen, ausgerollt."""
    deck = await K.create_collection_deck(
        K.DeckIn(name="Stapel", kurs_ids=[kurs.id], niveau_aktiv=niveau_aktiv), user=u, db=s)
    ids = []
    for front, niveau in karten:
        ids.append((await K.add_card(deck.id, K.CardIn(front=front, back="x", niveau=niveau),
                                     user=u, db=s)).id)
    await K.release_deck(deck.id, K.ReleaseIn(now=True), user=u, db=s)
    return deck, ids


def _karte(aus, card_id):
    return next(z for z in aus.cards if z.card_id == card_id)


@pytest.mark.asyncio
async def test_quote_und_mindestzahl(s):
    """Drei Versuche geben eine Quote, zwei nicht — und die Reihenfolge stimmt."""
    u = await _lehrkraft(s)
    kurs, _, _ = await _kurs_mit_kindern(s, u, "Mathe", [("tok-a", "")])
    deck, (schwer, gut, kaum) = await _stapel(
        s, u, kurs, [("schwer", ""), ("gut", ""), ("kaum", "")])

    # „schwer": dreimal daneben -> reps=0, lapses=3. Genau der Fall, den ein
    # Filter auf reps > 0 verschlucken wuerde.
    for _ in range(3):
        await K.submit_review("tok-a", K.ReviewIn(card_id=schwer, grade=0), db=s)
    # „gut": zweimal richtig, einmal daneben -> reps=1 (grade 0 setzt zurueck),
    # lapses=1 … deshalb noch einmal richtig, damit die Rechnung eindeutig ist.
    for grad in (3, 3, 3):
        await K.submit_review("tok-a", K.ReviewIn(card_id=gut, grade=grad), db=s)
    # „kaum": zwei Versuche -> unter der Mindestzahl. Erst daneben, dann richtig:
    # umgekehrt setzte `grade 0` die reps wieder auf 0 und es waere nur einer.
    for grad in (0, 3):
        await K.submit_review("tok-a", K.ReviewIn(card_id=kaum, grade=grad), db=s)

    aus = await K.deck_auswertung(deck.id, user=u, db=s)
    assert aus.mindest == K.MINDEST_VERSUCHE == 3
    assert aus.karten == 3 and aus.kinder == 1

    z = _karte(aus, schwer)
    assert (z.versuche, z.fehler, z.quote, z.genug) == (3, 3, 0, True)
    assert z.kinder == 1, "ein Kind hat sie gehabt, auch ohne einen einzigen Treffer"

    z = _karte(aus, gut)
    assert (z.versuche, z.fehler, z.quote, z.genug) == (3, 0, 100, True)

    z = _karte(aus, kaum)
    assert z.versuche == 2 and z.genug is False
    assert z.quote is None, "unter der Mindestzahl gibt es KEINE Quote"

    # Schwerste zuerst, „zu wenig Daten" ans Ende.
    assert [c.card_id for c in aus.cards] == [schwer, gut, kaum]
    # Deck-Summe: 8 Versuche, 4 Fehler -> 50 %.
    assert (aus.versuche, aus.fehler, aus.quote) == (8, 4, 50)
    assert aus.schwer == 1, "nur die 0-%-Karte gilt als schwer"


@pytest.mark.asyncio
async def test_eg_ein_g_kind_erzeugt_keine_versuche_an_e_karten(s):
    """Eine E-Karte zaehlt nur bei Kindern, die sie ueberhaupt sehen."""
    u = await _lehrkraft(s)
    kurs, _, _ = await _kurs_mit_kindern(s, u, "Mathe", [("tok-e", "E"), ("tok-g", "G")])
    deck, (e_karte, g_karte) = await _stapel(
        s, u, kurs, [("nur E", "E"), ("auch G", "G")], niveau_aktiv=True)

    # Das G-Kind bekommt die E-Karte gar nicht erst ausgeteilt.
    sitzung = await K.student_session("tok-g", all=True, db=s)
    assert {c["front"] for c in sitzung["cards"]} == {"auch G"}
    for _ in range(3):
        await K.submit_review("tok-e", K.ReviewIn(card_id=e_karte, grade=3), db=s)
        await K.submit_review("tok-g", K.ReviewIn(card_id=g_karte, grade=0), db=s)

    aus = await K.deck_auswertung(deck.id, user=u, db=s)
    assert aus.kinder == 2

    z = _karte(aus, e_karte)
    assert z.sichtbar == 1, "nur das E-Kind sieht sie — sonst stuende sie als versaeumt da"
    assert (z.versuche, z.quote) == (3, 100)
    assert z.hist["neu"] == 0, "das G-Kind darf hier gar nicht auftauchen"

    z = _karte(aus, g_karte)
    assert z.sichtbar == 2, "E bekommt den Grundstoff mit"
    assert (z.versuche, z.fehler, z.quote) == (3, 3, 0)
    assert z.faellig == 1, ("nur das E-Kind hatte sie nie — die verpatzte Karte "
                            "des G-Kindes kommt erst in zehn Minuten wieder")


@pytest.mark.asyncio
async def test_fremder_stapel_und_fremder_kurs(s):
    u = await _lehrkraft(s)
    fremd = await _lehrkraft(s, "fremd@d.de")
    kurs, _, _ = await _kurs_mit_kindern(s, u, "Mathe", [("tok-a", "")])
    f_kurs, _, _ = await _kurs_mit_kindern(s, fremd, "Fremd", [("tok-f", "")])
    deck, _ = await _stapel(s, u, kurs, [("2+2", "")])

    with pytest.raises(HTTPException) as ex:
        await K.deck_auswertung(deck.id, user=fremd, db=s)
    assert ex.value.status_code == 404, "ein fremder Stapel existiert fuer niemanden sonst"

    with pytest.raises(HTTPException) as ex:
        await K.deck_auswertung(deck.id, kurs_id=f_kurs.id, user=u, db=s)
    assert ex.value.status_code == 404, "der Kurs aus der URL wird geprueft, nicht geglaubt"


@pytest.mark.asyncio
async def test_ohne_modul_kein_zugang(s):
    """Die Schranke des Moduls (modul_pflicht) steht auch vor der Auswertung."""
    u = await _lehrkraft(s, "ohne@d.de", modul=False)
    with pytest.raises(HTTPException) as ex:
        await K.require_module(user=u, db=s)
    assert ex.value.status_code == 403


@pytest.mark.asyncio
async def test_g_kind_kann_keine_e_karte_bewerten(s):
    """Ein G-Kind bekommt eine E-Karte nie ausgeteilt — und darf auch mit
    bekannter card_id keine Bewertung darauf schreiben."""
    from fastapi import HTTPException

    from app.models import Card, CardDeck, SchoolClass, Student, User, UserModule
    from app.routers import karten as K

    u = User(email="niveau@b.de", password_hash="x", name="L"); s.add(u); await s.flush()
    s.add(UserModule(user_id=u.id, module_key="karten"))
    c = SchoolClass(name="7a", owner_id=u.id); s.add(c); await s.flush()
    kind = Student(card_id=1, name="Gus", class_id=c.id, niveau="G", karten_token="tok-g-kind")
    d = CardDeck(owner_id=u.id, class_id=c.id, name="Mix", niveau_aktiv=True,
                 released_at=K._now())
    s.add_all([kind, d]); await s.flush()
    e_karte = Card(deck_id=d.id, front="E-Frage", back="E-Antwort", niveau="E")
    s.add(e_karte); await s.commit()

    with pytest.raises(HTTPException) as e:
        await K.submit_review("tok-g-kind", K.ReviewIn(card_id=e_karte.id, grade=2), db=s)
    assert e.value.status_code == 403
