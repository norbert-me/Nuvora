"""Optimistisches Sperren: die Zeile zaehlt ihre Aenderungen, der Client vergleicht.

Bewacht wird genau das, was den Offline-Betrieb sicher macht:

  * der Zaehler steigt bei jeder Aenderung — von selbst, nicht je Endpunkt,
  * ohne Kopfzeile bleibt alles wie bisher (kein Bestandsclient wird gesperrt),
  * mit einer VERALTETEN Nummer gibt es 409 statt eines stillen Ueberschreibens,
  * `*` heisst „meine Fassung gilt" und kommt durch,
  * die Antwort nennt den aktuellen Stand — daraus entscheidet der Client
    (Serverstand aelter als die eigene Aenderung → ohne Rueckfrage weiter).
"""
import pytest
from fastapi import HTTPException

from app.models import User, UserModule
from app.routers import todos as T
from app.versionierung import KOPF


class _Anfrage:
    """Nur die Kopfzeilen — mehr liest `pruefe` nicht."""

    def __init__(self, version=None):
        self.headers = {} if version is None else {KOPF: str(version)}


async def _konto(s, mail="v@b.de"):
    u = User(email=mail, password_hash="x", name="L")
    s.add(u)
    await s.flush()
    s.add(UserModule(user_id=u.id, module_key="notizbrett"))
    await s.commit()
    return u


@pytest.mark.asyncio
async def test_zaehler_steigt_bei_jeder_aenderung(s):
    u = await _konto(s)
    t = await T.create_todo(T.TodoIn(text="Konferenz"), user=u, db=s)
    assert t["version"] == 1, "neu angelegt faengt bei 1 an"
    t = await T.update_todo(t["id"], T.TodoPatch(text="Konferenz II"), user=u, db=s)
    assert t["version"] == 2
    t = await T.update_todo(t["id"], T.TodoPatch(done=True), user=u, db=s)
    assert t["version"] == 3
    assert t["geaendert_at"] is not None, "wann zuletzt — daraus entscheidet der Client ohne Rueckfrage"


@pytest.mark.asyncio
async def test_ohne_kopfzeile_wird_geschrieben_wie_bisher(s):
    """Jeder Bestandsclient (und der Selbsttest) schickt keine Version."""
    u = await _konto(s, "v2@b.de")
    t = await T.create_todo(T.TodoIn(text="A"), user=u, db=s)
    await T.update_todo(t["id"], T.TodoPatch(text="B"), user=u, db=s)   # Zaehler jetzt 2
    t = await T.update_todo(t["id"], T.TodoPatch(text="C"), request=None, user=u, db=s)
    assert t["text"] == "C"


@pytest.mark.asyncio
async def test_veraltete_version_gibt_409_mit_stand(s):
    u = await _konto(s, "v3@b.de")
    t = await T.create_todo(T.TodoIn(text="A"), user=u, db=s)
    gelesen = t["version"]
    # Jemand anderes (zweites Geraet) aendert dieselbe Zeile.
    await T.update_todo(t["id"], T.TodoPatch(text="von drueben"), user=u, db=s)

    with pytest.raises(HTTPException) as e:
        await T.update_todo(t["id"], T.TodoPatch(text="meins"), request=_Anfrage(gelesen), user=u, db=s)
    assert e.value.status_code == 409
    assert e.value.detail["fehler"] == "konflikt"
    assert e.value.detail["version"] == gelesen + 1, "der aktuelle Stand steht in der Antwort"
    assert e.value.detail["geaendert_at"], "und wann er entstand"

    liste = await T.list_todos(user=u, db=s)
    assert liste[0]["text"] == "von drueben", "abgelehnt heisst: nichts geschrieben"


@pytest.mark.asyncio
async def test_stern_setzt_die_eigene_fassung_durch(s):
    """Nachdem der Client entschieden hat (automatisch oder per Rueckfrage)."""
    u = await _konto(s, "v4@b.de")
    t = await T.create_todo(T.TodoIn(text="A"), user=u, db=s)
    await T.update_todo(t["id"], T.TodoPatch(text="von drueben"), user=u, db=s)
    t = await T.update_todo(t["id"], T.TodoPatch(text="meins"), request=_Anfrage("*"), user=u, db=s)
    assert t["text"] == "meins"


@pytest.mark.asyncio
async def test_passende_version_kommt_durch(s):
    u = await _konto(s, "v5@b.de")
    t = await T.create_todo(T.TodoIn(text="A"), user=u, db=s)
    t = await T.update_todo(t["id"], T.TodoPatch(text="B"), request=_Anfrage(t["version"]), user=u, db=s)
    assert t["text"] == "B" and t["version"] == 2
