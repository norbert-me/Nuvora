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
# Die Verteilerliste haelt ALLE angenommenen Verbindungen; `broadcast` filtert
# auf die ausgewiesenen.
authentifiziert: set = set()

# Obergrenze je Sitzung — gezaehlt werden nur AUSGEWIESENE Verbindungen.
# Realistisch sind 1 Host + wenige Scanner. Vorher zaehlte jede angenommene
# Leitung mit: wer 50 unangemeldete Sockets auf eine fremde (durchzaehlbare)
# Sitzungsnummer oeffnete und offen hielt, sperrte die Lehrkraft aus ihrer
# eigenen Abstimmung aus.
MAX_CONNECTIONS_PER_SESSION = 50

# Wer sich noch nicht ausgewiesen hat, wartet — knapp begrenzt je Sitzung und
# insgesamt, und nur fuer AUSWEIS_FRIST Sekunden (main.py schliesst danach).
# Ein echter Client schickt seinen Ausweis im selben Augenblick, in dem die
# Leitung steht; mehr als eine Handvoll gleichzeitig Wartender ist eine Flut.
AUSWEIS_FRIST = 5.0
MAX_WARTEND_JE_SITZUNG = 10
MAX_WARTEND_GESAMT = 200
_wartend: dict = {}  # ws -> session_id


def _wartend_in(session_id: int) -> int:
    return sum(1 for sid in _wartend.values() if sid == session_id)


async def connect(session_id: int, ws: WebSocket) -> bool:
    await ws.accept()
    if len(_wartend) >= MAX_WARTEND_GESAMT or _wartend_in(session_id) >= MAX_WARTEND_JE_SITZUNG:
        await ws.close(code=1013)  # try again later
        return False
    _wartend[ws] = session_id
    connections[session_id].append(ws)
    return True


def freigeben(ws: WebSocket, session_id: int | None = None) -> bool:
    """Diese Verbindung hat sich als Besitzer ausgewiesen — ab jetzt mithoeren.

    False, wenn die Sitzung schon MAX_CONNECTIONS_PER_SESSION ausgewiesene
    Verbindungen hat; der Aufrufer schliesst dann."""
    if session_id is not None:
        belegt = sum(1 for w in connections.get(session_id, []) if w in authentifiziert)
        if belegt >= MAX_CONNECTIONS_PER_SESSION:
            return False
    _wartend.pop(ws, None)
    authentifiziert.add(ws)
    return True


def disconnect(session_id: int, ws: WebSocket):
    _wartend.pop(ws, None)
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
