"""Anmeldung, Token und Passwort-Reset — die Stellen, an denen ein Fehler
Fremdzugriff bedeutet.

`auth.py` war die einzige sicherheitskritische Datei ohne Netz: Passwortprüfung,
Bestätigungspflicht, Einmal-Link zum Zurücksetzen, Abmeldung aller Sitzungen.
Diese Tests halten das Verhalten fest, nicht die Umsetzung — sie überleben
also auch einen Wechsel des Hash-Verfahrens.
"""
import time

import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy import event
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from app.models import Base, User
from app.routers import auth as A


@pytest_asyncio.fixture
async def s():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")

    @event.listens_for(engine.sync_engine, "connect")
    def _fk_on(dbapi_conn, _):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)() as sess:
        yield sess
    await engine.dispose()


@pytest.fixture(autouse=True)
def _rate_limit_zuruecksetzen():
    """Das Anmelde-Limit zählt pro IP und lebt im Modul weiter. Ohne Zurücksetzen
    reißen sich die Tests gegenseitig in ein 429."""
    A._login_attempts.clear()
    yield
    A._login_attempts.clear()


class _Anfrage:
    """Reicht für die Endpunkte: sie lesen nur die Client-Adresse."""
    headers = {"X-Real-IP": "203.0.113.7"}
    client = None


async def _konto(s, bestaetigt=True, passwort="Geheim!2345"):
    u = User(email="lehrkraft@schule.de", password_hash=A._hash_pw(passwort),
             name="L", email_verified=bestaetigt)
    s.add(u)
    await s.commit()
    return u


# ─────────────────────────── Passwort ───────────────────────────

def test_passwort_hash_ist_gesalzen_und_prueft_richtig():
    a, b = A._hash_pw("Geheim!2345"), A._hash_pw("Geheim!2345")
    assert a != b, "gleiches Passwort muss unterschiedliche Hashes ergeben (Salt)"
    assert "Geheim" not in a, "das Passwort steht im Klartext im Hash"
    assert A._verify_pw("Geheim!2345", a)
    assert not A._verify_pw("geheim!2345", a), "Groß-/Kleinschreibung zählt"
    assert not A._verify_pw("", a)


def test_kaputter_hash_laesst_niemanden_durch():
    for kaputt in ("", "kein-dollar-zeichen", "a$b", "$$"):
        assert not A._verify_pw("Geheim!2345", kaputt)


def test_kaputter_argon2_string_wirft_nicht():
    """Argon2 wirft bei unlesbarem Hash eine Ausnahme — die darf nicht als
    HTTP 500 durchschlagen, sonst ist ein defektes Konto von außen erkennbar."""
    for kaputt in ("$argon2id$", "$argon2id$v=19$m=19456,t=2,p=1$kein-salt",
                   "$argon2id$v=19$m=19456,t=2,p=1$" + "A" * 22 + "$" + "B" * 43,
                   "$argon2xy$v=19$m=19456,t=2,p=1$AAAA$BBBB"):
        assert not A._verify_pw("Geheim!2345", kaputt)
        assert not A._pw_veraltet(kaputt), "ein unbrauchbarer Hash ist nichts zum Aufrüsten"


def test_neue_hashes_sind_argon2id_mit_owasp_parametern():
    """Argon2id ist das Standardverfahren; die Parameter stehen im Hash, damit
    sie sich später erhöhen lassen, ohne Bestandskonten auszusperren."""
    h = A._hash_pw("Geheim!2345")
    assert h.startswith("$argon2id$v=19$")
    assert f"m={A.ARGON2_MEMORY_COST},t={A.ARGON2_TIME_COST},p={A.ARGON2_PARALLELISM}" in h
    assert A.ARGON2_MEMORY_COST >= 19_456 and A.ARGON2_TIME_COST >= 2, "OWASP-Mindestwerte"
    assert A._verify_pw("Geheim!2345", h)
    assert not A._verify_pw("geheim!2345", h)
    assert not A._pw_veraltet(h), "frisch erzeugt — nichts zu wandern"


def _alter_hash(passwort: str) -> str:
    """Das Format vor der Umstellung: „salt$hash“ mit fest 100 000 Iterationen."""
    return f"{'ab' * 16}${A._pbkdf2(passwort, 'ab' * 16, A.PW_ITERATIONS_LEGACY)}"


def test_pbkdf2_hash_traegt_verfahren_und_iterationszahl():
    """Das zweite Bestandsformat: die Iterationszahl steht im Hash, sonst sperrt
    jede Erhöhung sämtliche damit angelegten Konten aus."""
    h = A._hash_pbkdf2("Geheim!2345")
    algo, iters, salt, digest = h.split("$")
    assert algo == "pbkdf2_sha256"
    assert int(iters) == A.PW_ITERATIONS >= 600_000, "OWASP-Empfehlung für PBKDF2-SHA256"
    assert len(salt) >= 16 and len(digest) == 64


def test_bestandskonten_in_beiden_pbkdf2_formaten_kommen_weiter_rein():
    alt = _alter_hash("Geheim!2345")
    assert alt.count("$") == 1, "das alte Format wird an der Zahl der Dollarzeichen erkannt"
    neu = A._hash_pbkdf2("Geheim!2345")
    for h in (alt, neu):
        assert A._verify_pw("Geheim!2345", h)
        assert not A._verify_pw("falsch", h)
        assert A._pw_veraltet(h), "PBKDF2 soll beim nächsten Login auf Argon2id wandern"
    assert not A._pw_veraltet(A._hash_pw("Geheim!2345"))


def test_manipulierte_iterationszahl_rechnet_nicht_endlos():
    """Ein Hash mit absurder Iterationszahl würde den Prozess blockieren —
    er gilt stattdessen als unbrauchbar."""
    assert not A._verify_pw("Geheim!2345", "pbkdf2_sha256$999999999$salt$" + "0" * 64)
    assert not A._verify_pw("Geheim!2345", "md5$600000$salt$" + "0" * 64)
    assert not A._verify_pw("Geheim!2345", "pbkdf2_sha256$viele$salt$" + "0" * 64)


@pytest.mark.asyncio
@pytest.mark.parametrize("bestand", ["alt", "pbkdf2"])
async def test_login_hebt_alten_hash_still_auf_argon2id(s, bestand):
    """Nur beim Login liegt der Klartext vor — also wird genau dort aufgerüstet,
    ohne dass die Lehrkraft etwas merkt. Beide PBKDF2-Formate wandern."""
    u = await _konto(s)
    u.password_hash = _alter_hash("Geheim!2345") if bestand == "alt" else A._hash_pbkdf2("Geheim!2345")
    await s.commit()

    await A.login(A.LoginBody(email="lehrkraft@schule.de", password="Geheim!2345"), _Anfrage(), s)

    assert u.password_hash.startswith("$argon2id$"), "Hash ist nicht auf Argon2id gewandert"
    assert not A._pw_veraltet(u.password_hash)
    assert A._verify_pw("Geheim!2345", u.password_hash), "das Passwort muss dasselbe bleiben"


@pytest.mark.asyncio
@pytest.mark.parametrize("bestand", ["alt", "pbkdf2"])
async def test_aufruesten_meldet_offene_sitzungen_nicht_ab(s, bestand):
    """Das Anheben ist eine interne Umformatierung, kein Passwortwechsel — würde
    token_version dabei steigen, flöge man auf allen anderen Geräten raus."""
    u = await _konto(s)
    u.password_hash = _alter_hash("Geheim!2345") if bestand == "alt" else A._hash_pbkdf2("Geheim!2345")
    vorher = u.token_version or 0
    await s.commit()

    await A.login(A.LoginBody(email="lehrkraft@schule.de", password="Geheim!2345"), _Anfrage(), s)

    assert (u.token_version or 0) == vorher
    assert A._verify_token(A._make_token(u.id, vorher)), "altes Token bleibt gültig"


# ─────────────────────────── Anmelden ───────────────────────────

@pytest.mark.asyncio
async def test_login_mit_falschem_passwort_scheitert(s):
    await _konto(s)
    with pytest.raises(HTTPException) as f:
        await A.login(A.LoginBody(email="lehrkraft@schule.de", password="falsch"), _Anfrage(), s)
    assert f.value.status_code == 401


@pytest.mark.asyncio
async def test_login_nennt_unbekanntes_konto_nicht_beim_namen(s):
    """Dieselbe Antwort wie bei falschem Passwort — sonst lassen sich vorhandene
    Adressen durchprobieren."""
    await _konto(s)
    with pytest.raises(HTTPException) as unbekannt:
        await A.login(A.LoginBody(email="niemand@schule.de", password="egal"), _Anfrage(), s)
    with pytest.raises(HTTPException) as falsch:
        await A.login(A.LoginBody(email="lehrkraft@schule.de", password="egal"), _Anfrage(), s)
    assert unbekannt.value.status_code == falsch.value.status_code == 401
    assert unbekannt.value.detail == falsch.value.detail


@pytest.mark.asyncio
async def test_ohne_bestaetigte_mail_kein_login(s):
    await _konto(s, bestaetigt=False)
    with pytest.raises(HTTPException) as f:
        await A.login(A.LoginBody(email="lehrkraft@schule.de", password="Geheim!2345"), _Anfrage(), s)
    assert f.value.status_code == 403


@pytest.mark.asyncio
async def test_login_liefert_ein_gueltiges_token(s):
    u = await _konto(s)
    antwort = await A.login(A.LoginBody(email="LEHRKRAFT@Schule.de", password="Geheim!2345"), _Anfrage(), s)
    assert antwort["user"]["email"] == "lehrkraft@schule.de", "Adresse wird klein geschrieben verglichen"
    geprueft = A._verify_token(antwort["token"])
    assert geprueft and geprueft[0] == u.id


# ─────────────────────────── Token ───────────────────────────

def test_verfaelschtes_token_wird_erkannt():
    echt = A._make_token(1, 0)
    assert A._verify_token(echt)
    assert not A._verify_token(echt[:-1] + ("a" if echt[-1] != "a" else "b")), "Signatur muss stimmen"
    assert not A._verify_token("1:0:0:" + "0" * 32), "gefälschte Signatur"
    assert not A._verify_token("unsinn")


def test_passwortwechsel_meldet_alte_sitzungen_ab():
    """token_version im Token muss zur Version am Konto passen — dadurch werden
    beim Zurücksetzen des Passworts alle offenen Sitzungen ungültig."""
    altes = A._verify_token(A._make_token(1, 0))
    assert altes == (1, 0, altes[2]) or altes[1] == 0
    neues = A._verify_token(A._make_token(1, 1))
    assert neues[1] == 1, "die Version steckt im Token und wird beim Prüfen verglichen"


# ─────────────────────── Passwort zurücksetzen ───────────────────────

@pytest.mark.asyncio
async def test_reset_link_funktioniert_genau_einmal(s):
    u = await _konto(s)
    token = A._make_reset_token(u)

    await A.reset_password(A.ResetPasswordBody(token=token, new_password="NeuesGeheim!9"), _Anfrage(), s)
    assert A._verify_pw("NeuesGeheim!9", u.password_hash)

    # Der Link hängt am alten Hash — nach dem Wechsel passt seine Signatur nicht mehr.
    with pytest.raises(HTTPException) as f:
        await A.reset_password(A.ResetPasswordBody(token=token, new_password="NochEins!7"), _Anfrage(), s)
    assert f.value.status_code == 400
    assert A._verify_pw("NeuesGeheim!9", u.password_hash), "das Passwort darf sich nicht erneut geändert haben"


@pytest.mark.asyncio
async def test_abgelaufener_reset_link_wird_abgelehnt(s, monkeypatch):
    u = await _konto(s)
    token = A._make_reset_token(u)
    # Eine Sekunde nach Ablauf der Stunde. Die echte Uhr vorher festhalten —
    # sonst ruft die Attrappe sich selbst auf.
    jetzt = time.time()
    monkeypatch.setattr(A.time, "time", lambda: jetzt + A.RESET_TTL + 1)
    with pytest.raises(HTTPException) as f:
        await A.reset_password(A.ResetPasswordBody(token=token, new_password="NeuesGeheim!9"), _Anfrage(), s)
    assert f.value.status_code == 400


@pytest.mark.asyncio
async def test_reset_meldet_offene_sitzungen_ab(s):
    u = await _konto(s)
    vorher = u.token_version or 0
    await A.reset_password(A.ResetPasswordBody(token=A._make_reset_token(u), new_password="NeuesGeheim!9"),
                           _Anfrage(), s)
    assert (u.token_version or 0) == vorher + 1, "sonst bliebe ein gestohlenes Token gültig"
