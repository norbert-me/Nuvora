"""SPF, DKIM, DMARC — und warum eine fehlende SPF-Freigabe kein Fehler ist.

Der Selbsttest meldete eine sauber eingerichtete Domain dauerhaft rot:

  ✗ SPF von varneytech.com gibt brevo nicht frei — 'authenticate your domain'

Falsch. **SPF gilt der Envelope-Absenderdomain (Return-Path), nicht der
From-Adresse.** Versanddienste setzen dort ihre eigene Domain ein und bouncen
selbst; die eigene Domain muss deren Server also gar nicht freigeben. Die
DMARC-Ausrichtung entsteht ueber DKIM: der Dienst signiert mit einem
Schluessel, der unter der eigenen Domain im DNS steht.

Ein Fehlalarm dieser Art ist teurer als eine fehlende Pruefung — er verleitet
dazu, am DNS herumzuaendern, bis der Test schweigt. Darum haelt dieser Test
beide Richtungen fest.
"""
import pytest

from app.routers import selftest as S


def _dns(eintraege):
    """Ersetzt die DNS-Abfrage durch eine Tabelle {name: [txt, ...]}."""
    def fake(name):
        return eintraege.get(name, [])
    return fake


BREVO = ("brevo", "sendinblue")
SPF_OHNE_BREVO = "v=spf1 include:_spf.mx.cloudflare.net ~all"
DKIM_EINTRAG = "k=rsa;p=MIIBIjANBgkqhkiG9w0BAQEF"


def _pruefe(monkeypatch, eintraege, host="smtp-relay.brevo.com", absender="admin@varneytech.com"):
    monkeypatch.setattr(S, "_dns_txt", _dns(eintraege))
    out = []
    S._check_absender_dns(absender, host, out)
    return {c.name: c for c in out}


def test_dkim_reicht_auch_ohne_spf_freigabe(monkeypatch):
    """Der Fall aus der Praxis: DKIM eingerichtet, SPF nennt den Dienst nicht."""
    checks = _pruefe(monkeypatch, {
        "varneytech.com": [SPF_OHNE_BREVO],
        "brevo1._domainkey.varneytech.com": [DKIM_EINTRAG],
        "_dmarc.varneytech.com": ["v=DMARC1; p=none"],
    })
    assert checks["DKIM"].ok, "der Schluessel steht im DNS — das muss gefunden werden"
    assert checks["SPF"].ok, "kein Fehler: SPF gilt dem Return-Path des Dienstes"
    assert "Return-Path" in checks["SPF"].detail, "die Begruendung gehoert in die Meldung"
    assert checks["DMARC"].ok


def test_ohne_dkim_und_ohne_spf_freigabe_ist_es_ein_fehler(monkeypatch):
    """Die Gegenprobe: fehlt beides, ist die Domain wirklich nicht beglaubigt."""
    checks = _pruefe(monkeypatch, {
        "varneytech.com": [SPF_OHNE_BREVO],
        "_dmarc.varneytech.com": ["v=DMARC1; p=none"],
    })
    assert "DKIM" not in checks, "ohne Treffer wird DKIM nicht behauptet"
    assert not checks["SPF"].ok
    assert "DKIM" in checks["SPF"].detail, "die Meldung muss beide Wege nennen"


def test_spf_freigabe_allein_genuegt(monkeypatch):
    """Der klassische Weg bleibt gueltig, auch ohne DKIM-Eintrag."""
    checks = _pruefe(monkeypatch, {
        "varneytech.com": ["v=spf1 include:spf.brevo.com ~all"],
        "_dmarc.varneytech.com": ["v=DMARC1; p=none"],
    })
    assert checks["SPF"].ok


def test_gar_kein_spf_eintrag_aber_dkim_ist_nur_eine_warnung(monkeypatch):
    """Ohne SPF-Eintrag ist die Zustellung schlechter, aber nichts ist kaputt —
    manche Empfaenger werten nur SPF aus. Warnung, kein Fehler."""
    checks = _pruefe(monkeypatch, {
        "brevo1._domainkey.varneytech.com": [DKIM_EINTRAG],
    })
    assert checks["SPF"].ok
    assert checks["SPF"].schwere == "warnung"


def test_zweiter_selektor_wird_auch_gefunden(monkeypatch):
    """Brevo legt zwei Schluessel an; steht nur der zweite, zaehlt er genauso."""
    checks = _pruefe(monkeypatch, {
        "varneytech.com": [SPF_OHNE_BREVO],
        "brevo2._domainkey.varneytech.com": [DKIM_EINTRAG],
    })
    assert checks["DKIM"].ok
    assert "brevo2" in checks["DKIM"].detail


def test_freemailer_bleibt_eine_warnung(monkeypatch):
    """Bei t-online & Co. laesst sich der SPF-Eintrag nicht aendern — das darf
    den Selbsttest nicht dauerhaft rot faerben."""
    checks = _pruefe(monkeypatch, {
        "t-online.de": ["v=spf1 include:spf.t-online.de -all"],
    }, absender="norbert.varney@t-online.de")
    assert not checks["SPF"].ok
    assert checks["SPF"].schwere == "warnung"


def test_unbekannter_relay_verlangt_keine_freigabe(monkeypatch):
    """Ein selbst betriebener Mailserver taucht in keiner Anbieterliste auf —
    dann darf der Test keine Freigabe fuer irgendwen fordern."""
    checks = _pruefe(monkeypatch, {
        "varneytech.com": ["v=spf1 mx -all"],
    }, host="mail.eigener-server.de")
    assert checks["SPF"].ok
