"""SSRF-Grenzen in app/netz.py: nur globale Ziele, und ein Abruf hat eine Gesamtfrist.

Die Frist ist noetig, weil `timeout` nur je Socket-Vorgang gilt: ein Server, der
in kleinen Abstaenden je ein Byte schickt, hielte sonst einen Thread beliebig
lange fest.
"""
import socket
import socketserver
import threading
import time
from http.server import BaseHTTPRequestHandler

import pytest

from app import netz


@pytest.mark.parametrize("adresse", [
    "127.0.0.1", "10.1.2.3", "192.168.0.10", "172.16.5.5", "169.254.169.254",
    "100.64.0.1",            # CGNAT — fehlte in der alten Aufzaehlung
    "0.0.0.0", "224.0.0.1", "::1", "fc00::1", "fe80::1",
    "::ffff:127.0.0.1",      # IPv4 in IPv6 verpackt
    "64:ff9b::7f00:1",       # NAT64 auf Loopback
    "2002:7f00:1::1",        # 6to4 auf Loopback
    "kein-ip",
])
def test_nicht_globale_ziele_sind_verboten(adresse):
    assert netz.ip_erlaubt(adresse) is False


@pytest.mark.parametrize("adresse", ["8.8.8.8", "1.1.1.1", "2606:4700::1111"])
def test_globale_ziele_sind_erlaubt(adresse):
    assert netz.ip_erlaubt(adresse) is True


def test_pruefe_ziel_lehnt_cgnat_ab(monkeypatch):
    monkeypatch.setattr(netz, "_ECHTES_GAI", lambda *a, **k: [
        (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("100.64.3.4", 443))])
    with pytest.raises(netz.NetzFehler):
        netz._pruefe_ziel("https://intern.example/kal.ics")


class _Tropfen(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/calendar")
        self.end_headers()
        try:
            for _ in range(200):
                self.wfile.write(b"x")
                self.wfile.flush()
                time.sleep(0.1)
        except OSError:
            pass

    def log_message(self, *a):
        pass


class _Srv(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True


@pytest.fixture
def tropf_server(monkeypatch):
    # socketserver statt http.server: HTTPServer ruft beim Binden getfqdn(),
    # und die Rueckwaertsaufloesung kostet ohne Netz Sekunden.
    srv = _Srv(("127.0.0.1", 0), _Tropfen)
    srv.daemon_threads = True
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    port = srv.server_address[1]
    # Loopback ist sonst (zu Recht) verboten — fuer den Test die Pruefung umgehen.
    monkeypatch.setattr(netz, "_pruefe_ziel", lambda url: (
        "127.0.0.1", port,
        [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", port))]))
    yield port
    srv.shutdown()
    srv.server_close()


def test_tropfender_server_endet_an_der_gesamtfrist(tropf_server, monkeypatch):
    monkeypatch.setattr(netz, "GESAMTFRIST", 0.8)
    beginn = time.monotonic()
    with pytest.raises(netz.NetzFehler):
        netz.hole(f"http://127.0.0.1:{tropf_server}/kal.ics", timeout=5)
    assert time.monotonic() - beginn < 3


def test_nagel_gilt_nur_im_eigenen_thread():
    """Der Nagel ersetzt die Aufloesung nur waehrend eines Abrufs im selben Thread."""
    netz._NAEGEL.pins = {("nagel.example", 80): [
        (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 80))]}
    try:
        assert socket.getaddrinfo("nagel.example", 80)[0][4][0] == "93.184.216.34"
        ergebnis = {}

        def anderer():
            try:
                socket.getaddrinfo("nagel.example", 80)
                ergebnis["x"] = "aufgeloest"
            except OSError:
                ergebnis["x"] = "echt"

        t = threading.Thread(target=anderer)
        t.start()
        t.join()
        assert ergebnis["x"] == "echt"
    finally:
        netz._NAEGEL.pins = None
