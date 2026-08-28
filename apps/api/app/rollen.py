"""Wer ist die Administration?

Ein Blatt: keine Router, kein FastAPI, keine Datenbank — damit es jeder
importieren kann, auch `routers/auth.py`. In `admin.py` konnte die Antwort
nicht stehen: das Modul importiert `get_current_user` aus dem Auth-Router,
und der braucht die Antwort selbst — ein Importring.
"""


def ist_admin(user) -> bool:
    """Konto 1 immer, alle weiteren ueber `users.is_admin`.

    Konto 1 laesst sich nicht herabstufen und nicht loeschen: IDs werden nicht
    wiederverwendet, und ohne dieses Konto koennte sich eine Installation
    vollstaendig aussperren. Weitere Konten lassen sich ernennen — vorher gab
    es genau eine Administration, und bei Krankheit oder Wechsel kam niemand
    mehr an sie.
    """
    return bool(user) and (getattr(user, "id", None) == 1 or bool(getattr(user, "is_admin", False)))
