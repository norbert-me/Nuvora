"""Administration und Programmfassung — ein Blatt im Importbaum.

Beides stand frueher in `main.py`. Das war die Wurzel des einzigen
Importzyklus im Backend: `main.py` importiert jeden Router, und
`routers/backup.py` brauchte von dort `_require_admin` und `APP_VERSION`.
Der Ausweg war ein Import mitten in der Funktion — er funktionierte, hinterliess
aber einen Ring, den jede Codepruefung wieder meldet, und die Begruendung
dafuer musste an drei Stellen stehen.

Hier importiert nichts einen Router. Damit koennen `main.py` und die Router
oben ganz normal importieren, die Admin-Pruefung existiert weiter nur einmal,
und der Ring ist weg statt nur verschoben.
"""
import pathlib

from fastapi import Depends, HTTPException

from .routers.auth import get_current_user


async def _require_admin(user=Depends(get_current_user)):
    if user.id != 1:
        raise HTTPException(403, "Nur für die Administration")
    return user


def _read_version() -> str:
    # VERSION liegt im Repo-Root; im Container unter /app bzw. neben app/
    for p in ("/app/VERSION", str(pathlib.Path(__file__).resolve().parent.parent / "VERSION"),
              str(pathlib.Path(__file__).resolve().parent.parent.parent / "VERSION")):
        try:
            return pathlib.Path(p).read_text().strip()
        except Exception:
            continue
    return "0.0.0"


APP_VERSION = _read_version()
