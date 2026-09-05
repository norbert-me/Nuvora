"""Jeder Link, der AUS DEM HAUS geht, traegt die oeffentliche Adresse.

Abgeleitet wurden sie frueher aus dem Aufruf: wer im Schulnetz ueber die
LAN-Adresse arbeitete, verschickte Bestaetigungsmails und druckte QR-Zettel mit
`http://192.168.x.y:8090` — ausserhalb tot. `SITE_URL` schlaegt deshalb den
Aufruf, und zwar an einer Stelle (app/oeffentlich.py).
"""
import importlib

import pytest

from app import oeffentlich


def test_site_url_schlaegt_den_aufruf(monkeypatch):
    monkeypatch.setenv("SITE_URL", "https://nuvora.example.com/")
    assert oeffentlich.site_url() == "https://nuvora.example.com"
    assert oeffentlich.basis("http://192.168.10.75:8090") == "https://nuvora.example.com"


def test_ohne_site_url_bleibt_der_aufruf(monkeypatch):
    monkeypatch.delenv("SITE_URL", raising=False)
    assert oeffentlich.site_url() == ""
    assert oeffentlich.basis("http://192.168.10.75:8090/") == "http://192.168.10.75:8090"


def test_mailtexte_nehmen_die_oeffentliche_adresse(monkeypatch):
    """auth liest SITE_URL beim Import — hier bewusst neu geladen."""
    monkeypatch.setenv("SITE_URL", "https://nuvora.example.com")
    from app.routers import auth
    importlib.reload(auth)
    assert auth.SITE_URL == "https://nuvora.example.com"
    importlib.reload(auth)


@pytest.mark.asyncio
async def test_qr_link_traegt_die_domain(s, monkeypatch):
    """Der QR-Code haengt im Ordner des Kindes — mit LAN-Adresse waere er tot."""
    monkeypatch.setenv("SITE_URL", "https://nuvora.example.com")
    from app.models import SchoolClass, Student, User, UserModule
    from app.routers import karten as K

    u = User(email="qr@b.de", password_hash="x", name="L"); s.add(u); await s.flush()
    s.add(UserModule(user_id=u.id, module_key="karten"))
    c = SchoolClass(name="7a", owner_id=u.id); s.add(c); await s.flush()
    st = Student(class_id=c.id, name="Kind", card_id=1, karten_token="tok123"); s.add(st)
    await s.commit()

    # Der Browser schickt seine eigene Adresse mit — sie darf nicht gewinnen.
    import qrcode
    gesehen = {}
    monkeypatch.setattr(qrcode, "make", lambda url: (gesehen.setdefault("url", url), _Bild())[1])
    await K.qr_png("tok123", base="http://192.168.10.75:8090", db=s)
    assert gesehen["url"] == "https://nuvora.example.com/lernen/tok123"


class _Bild:
    def save(self, buf, format=""):
        buf.write(b"png")
