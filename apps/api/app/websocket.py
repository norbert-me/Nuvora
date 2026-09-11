import json
from collections import defaultdict

from fastapi import WebSocket

connections = defaultdict(list)

# Wer sich als Besitzer der Sitzung ausgewiesen hat. Nur diese Verbindungen
# bekommen etwas zu hoeren.
#
# Vorher horchte JEDER mit: `connect` nahm die Verbindung an und trug sie sofort
# in die Verteilerliste ein, die Pruefung des Tokens entschied nur, wer etwas
# SENDEN darf. Die Sitzungsnummer ist eine fortlaufende Zahl — wer /ws/session/<n>
# durchzaehlt, sah ohne jede Anmeldung live mit, welche Karte in einer fremden
# Klasse gerade welche Antwort abgibt. Das ist die Mandantentrennung, und sie
# gilt auch fuer eine Leitung, die nur zuhoert.
#
# Die Verteilerliste bleibt die Liste ALLER angenommenen Verbindungen, damit die
# Begrenzung unten weiter jede Verbindung zaehlt — sonst waere das Fluten der
# Sitzung wieder offen.
authentifiziert: set = set()

# Schutz vor Verbindungs-Flooding: realistisch sind 1 Host + wenige Scanner pro Session
MAX_CONNECTIONS_PER_SESSION = 50


async def connect(session_id: int, ws: WebSocket) -> bool:
    await ws.accept()
    if len(connections[session_id]) >= MAX_CONNECTIONS_PER_SESSION:
        await ws.close(code=1013)  # try again later
        return False
    connections[session_id].append(ws)
    return True


def freigeben(ws: WebSocket):
    """Diese Verbindung hat sich als Besitzer ausgewiesen — ab jetzt mithoeren."""
    authentifiziert.add(ws)


def disconnect(session_id: int, ws: WebSocket):
    authentifiziert.discard(ws)
    if ws in connections.get(session_id, []):
        connections[session_id].remove(ws)
    if session_id in connections and not connections[session_id]:
        del connections[session_id]


async def broadcast(session_id: int, data: dict):
    message = json.dumps(data)
    dead = []
    for ws in connections[session_id]:
        if ws not in authentifiziert:
            continue  # nicht ausgewiesen: bekommt nichts zu sehen
        try:
            await ws.send_text(message)
        except Exception:
            dead.append(ws)
    for ws in dead:
        authentifiziert.discard(ws)
        connections[session_id].remove(ws)
