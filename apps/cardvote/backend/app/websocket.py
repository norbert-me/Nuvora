import json
from collections import defaultdict

from fastapi import WebSocket

connections = defaultdict(list)

# Schutz vor Verbindungs-Flooding: realistisch sind 1 Host + wenige Scanner pro Session
MAX_CONNECTIONS_PER_SESSION = 50


async def connect(session_id: int, ws: WebSocket) -> bool:
    await ws.accept()
    if len(connections[session_id]) >= MAX_CONNECTIONS_PER_SESSION:
        await ws.close(code=1013)  # try again later
        return False
    connections[session_id].append(ws)
    return True


def disconnect(session_id: int, ws: WebSocket):
    if ws in connections.get(session_id, []):
        connections[session_id].remove(ws)
    if session_id in connections and not connections[session_id]:
        del connections[session_id]


async def broadcast(session_id: int, data: dict):
    message = json.dumps(data)
    dead = []
    for ws in connections[session_id]:
        try:
            await ws.send_text(message)
        except Exception:
            dead.append(ws)
    for ws in dead:
        connections[session_id].remove(ws)
