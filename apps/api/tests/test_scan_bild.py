"""Der Weg, den die Lehrkraft im Unterricht wirklich geht: Klasse abfotografieren.

Die Schueler halten ihre gedruckte Karte hoch, gedreht so, dass ihre Antwort oben
steht. Ein Foto, ein Aufruf von /api/scan-image — und aus Drehwinkeln werden
Antworten. Getestet war davon bisher nichts: /api/scan (results.py) bekommt den
Buchstaben schon fertig geliefert, die eigentliche Erkennung in
app/routers/scan_image.py lief ungeprueft.

Die Testbilder entstehen hier selbst mit OpenCV (dieselbe Bibliothek und dasselbe
Woerterbuch DICT_6X6_50, aus dem cards.py die Karten druckt) — kein Beispielfoto,
das irgendwann nicht mehr zum Code passt.

Die Erwartung wird nicht aus scan_image.py abgeschrieben, sondern aus der
*gedruckten Karte* hergeleitet: cards.py:41-46 setzt A oben, B rechts, C unten,
D links. Wer die Karte um θ im Uhrzeigersinn dreht, bringt damit den Buchstaben
nach oben, der vorher bei -θ stand. Genau das rechnet erwartete_antwort().

Lauf:  cd apps/api && pip install -r requirements-dev.txt && pytest tests/test_scan_bild.py
"""
import base64

import cv2
import numpy as np
import pytest
from fastapi import HTTPException
import pytest_asyncio
from sqlalchemy import event, select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from app.models import Base, User, Question, Scan, Session as CvSession
from app.routers.scan_image import (
    detect_markers, scan_image, confirm_scans, ScanImageRequest, ConfirmScanRequest,
)

WOERTERBUCH = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_6X6_50)

# So steht es auf der gedruckten Karte (cards.py:41-46), im Uhrzeigersinn ab oben.
BESCHRIFTUNG_IM_UHRZEIGERSINN = {0: "A", 90: "B", 180: "C", 270: "D"}


def erwartete_antwort(drehung_grad: int) -> str:
    """Welcher Buchstabe steht oben, wenn die Karte um θ im Uhrzeigersinn gedreht wird?

    Ein Buchstabe, der auf der Karte bei φ sitzt, landet nach der Drehung bei
    φ+θ. Oben (0°) steht also der Buchstabe von φ = -θ.
    """
    return BESCHRIFTUNG_IM_UHRZEIGERSINN[(-drehung_grad) % 360]


def marker_bild(marker_id: int, drehung_grad: float = 0.0, groesse: int = 400) -> np.ndarray:
    """Ein Marker auf weissem Grund, um θ im Uhrzeigersinn gedreht (Bildkoordinaten)."""
    marker = cv2.aruco.generateImageMarker(WOERTERBUCH, marker_id, 200)
    blatt = np.full((groesse, groesse), 255, np.uint8)
    rand = (groesse - 200) // 2
    blatt[rand:rand + 200, rand:rand + 200] = marker
    # Negativer Winkel = im Uhrzeigersinn, weil die Bild-Y-Achse nach unten zeigt.
    m = cv2.getRotationMatrix2D((groesse / 2, groesse / 2), -drehung_grad, 1.0)
    return cv2.warpAffine(blatt, m, (groesse, groesse), borderValue=255, flags=cv2.INTER_CUBIC)


def klassenfoto(karten: list[tuple[int, float]], kachel: int = 400) -> np.ndarray:
    """Mehrere Karten nebeneinander — wie ein Foto der hochhaltenden Klasse."""
    return np.hstack([marker_bild(mid, grad, kachel) for mid, grad in karten])


def als_png(bild: np.ndarray) -> bytes:
    ok, puffer = cv2.imencode(".png", bild)
    assert ok
    return puffer.tobytes()


def als_data_url(bild: np.ndarray) -> str:
    return "data:image/png;base64," + base64.b64encode(als_png(bild)).decode()


# ─── Erkennung, ohne Datenbank ───

@pytest.mark.parametrize("drehung", [0, 90, 180, 270])
def test_vier_drehlagen_ergeben_die_vier_antworten(drehung):
    """Der Kern der Sache: Drehwinkel → Buchstabe, hergeleitet aus dem Kartendruck."""
    karten = detect_markers(als_png(marker_bild(7, drehung)))
    assert len(karten) == 1, f"genau eine Karte erwartet bei {drehung}°"
    assert karten[0].marker_id == 7
    assert karten[0].answer == erwartete_antwort(drehung), (
        f"Karte um {drehung}° gedreht: oben steht {erwartete_antwort(drehung)}"
    )


def test_mehrere_karten_in_einem_bild():
    """Der Regelfall im Unterricht: ein Foto, die halbe Klasse drauf."""
    gestellt = [(3, 0), (11, 90), (42, 180), (0, 270)]
    karten = detect_markers(als_png(klassenfoto(gestellt)))
    gefunden = {k.marker_id: k.answer for k in karten}
    assert gefunden == {mid: erwartete_antwort(grad) for mid, grad in gestellt}


def test_bild_ohne_marker_bleibt_leer():
    """Ein Foto ohne hochgehaltene Karte ist kein Fehler, nur ein leeres Ergebnis."""
    assert detect_markers(als_png(np.full((300, 300), 255, np.uint8))) == []


def test_kartennummern_ausserhalb_des_woerterbuchs_gibt_es_nicht():
    """DICT_6X6_50 kennt 0..49 — es kann gar keine Karte 50 gedruckt werden.

    Die Schranke haelt also am Druck (cards.py). Erkannt werden kann darum nie
    eine Nummer ausserhalb; die offene Flanke liegt bei /api/scan-confirm, wo
    die Nummer vom Client kommt (siehe test_scan_confirm_nimmt_jede_...).
    """
    with pytest.raises(cv2.error):
        cv2.aruco.generateImageMarker(WOERTERBUCH, 50, 200)

    for marker_id in (0, 49):
        karten = detect_markers(als_png(marker_bild(marker_id)))
        assert [k.marker_id for k in karten] == [marker_id]


def test_zwischenlage_kippt_an_der_kante_und_die_zuversicht_sagt_es():
    """Die Viertelung des Kreises bleibt — aber sie ist jetzt ablesbar.

    answer_from_angle teilt den Kreis in vier Viertel; zwischen 44 und 45 Grad
    springt die Antwort von A auf D. Das laesst sich nicht wegkonstruieren: vier
    Antworten auf 360 Grad heisst vier Grenzen, irgendwo muss die Kante liegen.

    Frueher stand `confidence` fest auf 0.95, egal ob die Karte gerade oder 44
    Grad schief gehalten wurde — die Zahl war wertlos, obwohl das Antwortmodell
    sie genau dafuer vorsieht. Jetzt faellt sie mit der Schieflage, und die
    Lehrkraft sieht, welche Karte grenzwertig lag.
    """
    def eine(grad):
        karten = detect_markers(als_png(marker_bild(7, grad)))
        assert len(karten) == 1
        return karten[0]

    # Schieflagen weit vor der Kante bleiben bei der gemeinten Antwort.
    for grad in (5, 20, 40, 44):
        assert eine(grad).answer == "A", f"{grad} Grad Schieflage darf A nicht kippen"

    # Und einen Grad spaeter ist es eine andere Antwort — das ist die Kante.
    assert eine(45).answer == "D"
    assert eine(46).answer == "D"

    # Der Unterschied zu vorher: die Zuversicht macht die Kante sichtbar.
    gerade = eine(1).confidence
    schief = eine(44).confidence
    assert gerade > 0.9, "eine gerade gehaltene Karte ist eindeutig"
    assert schief < 0.1, "44 Grad Schieflage ist ein Grenzfall und muss so aussehen"
    assert gerade > schief, "die Zahl muss mit der Schieflage fallen"


# ─── Datenbank: vom Bild zur gespeicherten Antwort ───

@pytest_asyncio.fixture
async def db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")

    @event.listens_for(engine.sync_engine, "connect")
    def _fk_an(dbapi_conn, _):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)() as s:
        yield s
    await engine.dispose()


async def _sitzung(s):
    """Lehrkraft, Frage und eine laufende Sitzung, die auf dieser Frage steht."""
    user = User(email="a@b.de", password_hash="x", name="Lehrkraft")
    s.add(user)
    await s.flush()
    frage = Question(text="Wie viel ist 2+2?", owner_id=user.id)
    s.add(frage)
    await s.flush()
    sitzung = CvSession(name="Probe", owner_id=user.id, current_question_id=frage.id)
    s.add(sitzung)
    await s.commit()
    return user, sitzung


@pytest.mark.asyncio
async def test_scan_image_speichert_die_erkannten_antworten(db):
    """Der ganze Weg: Foto rein, Antworten in der Datenbank."""
    user, sitzung = await _sitzung(db)
    gestellt = [(3, 0), (11, 270)]
    antwort = await scan_image(
        ScanImageRequest(session_id=sitzung.id, image=als_data_url(klassenfoto(gestellt))),
        user=user, db=db,
    )
    erwartet = {mid: erwartete_antwort(grad) for mid, grad in gestellt}
    assert {k.marker_id: k.answer for k in antwort.cards} == erwartet

    gespeichert = (await db.execute(select(Scan))).scalars().all()
    assert {sc.student_id: sc.answer for sc in gespeichert} == erwartet


@pytest.mark.asyncio
async def test_zweites_foto_ueberschreibt_statt_zu_verdoppeln(db):
    """Die Lehrkraft fotografiert oft zweimal. Es darf nur eine Antwort bleiben."""
    user, sitzung = await _sitzung(db)
    for grad in (0, 180):
        await scan_image(
            ScanImageRequest(session_id=sitzung.id, image=als_data_url(marker_bild(3, grad))),
            user=user, db=db,
        )
    gespeichert = (await db.execute(select(Scan))).scalars().all()
    assert len(gespeichert) == 1, "je Frage und Karte genau ein Eintrag"
    assert gespeichert[0].answer == "C", "die zweite Aufnahme gilt"


@pytest.mark.asyncio
async def test_scan_confirm_speichert_die_bestaetigte_antwort(db):
    """Der Weg nach der Sichtkontrolle: die Lehrkraft korrigiert und bestaetigt."""
    user, sitzung = await _sitzung(db)
    erkannt = detect_markers(als_png(klassenfoto([(3, 0), (11, 90)])))
    assert {k.marker_id: k.answer for k in erkannt} == {3: "A", 11: "D"}

    # Karte 11 lag schief, die Lehrkraft stellt sie auf B.
    korrigiert = [{"marker_id": k.marker_id, "answer": "B" if k.marker_id == 11 else k.answer}
                  for k in erkannt]
    assert await confirm_scans(
        ConfirmScanRequest(session_id=sitzung.id, scans=korrigiert), user=user, db=db
    ) == {"ok": True}

    gespeichert = (await db.execute(select(Scan))).scalars().all()
    assert {sc.student_id: sc.answer for sc in gespeichert} == {3: "A", 11: "B"}


@pytest.mark.asyncio
async def test_scan_confirm_weist_unmoegliche_kartennummern_ab(db):
    """Eine Kartennummer ausserhalb von 0..49 gehoert zu keiner Karte.

    Das Woerterbuch DICT_6X6_50 kennt genau diese Nummern; der Kartendruck kann
    keine andere erzeugen und die Erkennung keine andere liefern. Dieser
    Endpunkt nimmt seine Liste aber vom Client entgegen, und Scan.student_id ist
    ein blankes Integer ohne Fremdschluessel (models.py) — ohne Pruefung landete
    {"marker_id": 999} still in der Wertung und gehoerte zu keinem Kind.
    """
    user, sitzung = await _sitzung(db)
    for nummer in (999, -1, 50):
        with pytest.raises(HTTPException) as ex:
            await confirm_scans(
                ConfirmScanRequest(session_id=sitzung.id,
                                   scans=[{"marker_id": nummer, "answer": "A"}]),
                user=user, db=db,
            )
        assert ex.value.status_code == 400
        assert "Kartennummer" in ex.value.detail

    # Die Randwerte selbst muessen durchgehen — sonst waere die Schranke zu eng.
    await confirm_scans(
        ConfirmScanRequest(session_id=sitzung.id, scans=[
            {"marker_id": 0, "answer": "A"},
            {"marker_id": 49, "answer": "B"},
        ]),
        user=user, db=db,
    )
    gespeichert = (await db.execute(select(Scan))).scalars().all()
    assert {sc.student_id for sc in gespeichert} == {0, 49}


@pytest.mark.asyncio
async def test_kaputtes_bild_wird_abgewiesen(db):
    """Ein Nicht-Bild muss abgewiesen werden, nicht ignoriert.

    Vorher entschied cv2.imdecode, und bei None kam eine LEERE Kartenliste mit
    HTTP 200 zurueck. Fuer die Lehrkraft ist das nicht zu unterscheiden von
    "niemand hat eine Karte hochgehalten" — sie sucht den Fehler dann bei der
    Klasse. app/uploads.py:bildtyp() ist genau dafuer da und wird auf allen
    anderen Bildwegen (Schuelerfoto, Kartenbild) auch benutzt.
    """
    user, sitzung = await _sitzung(db)
    kein_bild = base64.b64encode(b"das ist kein Bild, sondern Text").decode()
    with pytest.raises(HTTPException) as ex:
        await scan_image(
            ScanImageRequest(session_id=sitzung.id, image=kein_bild), user=user, db=db
        )
    assert ex.value.status_code == 400
    assert "Bilddatei" in ex.value.detail


@pytest.mark.asyncio
async def test_unlesbares_base64_ergibt_400_statt_500(db):
    """Ein abgeschnittener Upload ist ein Bedienfall, kein Serverfehler.

    base64.b64decode warf bei falschen Fuellzeichen eine binascii.Error, die
    niemand fing — die Lehrkraft sah einen Serverfehler statt "Bild unlesbar,
    bitte neu aufnehmen". Auf dem Schulhof-WLAN kommt ein abgeschnittener
    Upload regelmaessig vor.
    """
    user, sitzung = await _sitzung(db)
    with pytest.raises(HTTPException) as ex:
        await scan_image(
            ScanImageRequest(session_id=sitzung.id, image="kaputt!!"), user=user, db=db
        )
    assert ex.value.status_code == 400
    assert "unvollstaendig" in ex.value.detail.lower()
