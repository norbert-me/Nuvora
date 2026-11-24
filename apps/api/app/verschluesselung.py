"""Beim Start: Spalten auf Text umstellen, Bestand verschlüsseln, Schlüssel prüfen.

Läuft nach `create_all`/`_ensure_columns` und ist **idempotent**: was schon
`enc1:` trägt, wird nicht angefasst. Ein halber Lauf (Abbruch mitten drin) setzt
beim nächsten Start einfach fort — gelesen wird ohnehin beides (siehe krypto.py).

Reihenfolge, und warum:
  1. Schlüssel-Prüfwert (`app_settings.krypto_pruefwert`): passt der Schlüssel
     nicht zu dem, mit dem die Datenbank beschrieben wurde, bricht der Start
     LAUT ab. Sonst würde ein vertippter oder ersetzter Schlüssel stumm neue
     Daten unter einem zweiten Schlüssel anlegen — danach ist beides kaputt.
  2. Spaltentypen (nur Postgres): JSON/Float/Integer/varchar → TEXT. SQLite ist
     typlos genug und braucht das nicht.
  3. Suchwert der E-Mail nachtragen (aus dem noch lesbaren Bestand).
  4. Bestand verschlüsseln, Spalte für Spalte in kleinen Paketen.
"""
from __future__ import annotations

import json

from sqlalchemy import bindparam, func, select, text, update

from . import krypto
from .models import AppSetting, Base, User

PRUEFWERT = "krypto_pruefwert"
PRUEFTEXT = "nuvora-datenschluessel-ok"
PAKET = 200


def enc_spalten() -> list[tuple]:
    """(Tabelle, Spalte) aller verschlüsselten Spalten — aus den Modellen, nicht von Hand."""
    return [(t, c) for t in Base.metadata.sorted_tables for c in t.c if krypto.ist_enc(c)]


async def pruefwert_pruefen(db) -> str:
    """'neu' beim ersten Start, 'ok' wenn der Schlüssel passt. Sonst Ausnahme."""
    krypto._lade()  # fehlender Schlüssel → klare Meldung
    zeile = await db.get(AppSetting, PRUEFWERT)
    if zeile is None:
        db.add(AppSetting(key=PRUEFWERT, value=krypto.text_verschluesseln(PRUEFTEXT, PRUEFWERT)))
        await db.commit()
        return "neu"
    try:
        klar = krypto.text_entschluesseln(zeile.value, PRUEFWERT)
    except krypto.DatenschluesselFehler as e:
        raise krypto.DatenschluesselFehler(
            f"{krypto.ENV} passt nicht zu dieser Datenbank. Start abgebrochen, damit nichts "
            f"unter einem zweiten Schlüssel überschrieben wird. Den richtigen Schlüssel "
            f"eintragen (Kopie: .deploy.env bzw. Passwortmanager).") from e
    if klar != PRUEFTEXT:
        raise krypto.DatenschluesselFehler("Prüfwert des Datenschlüssels stimmt nicht.")
    return "ok"


def spaltentypen_umstellen(sync_conn) -> list[str]:
    """Postgres: Spalten, die verschlüsselt werden, auf TEXT bringen (idempotent)."""
    if sync_conn.dialect.name != "postgresql":
        return []
    getan = []
    # Eindeutigkeit und Index auf der verschlüsselten E-Mail sind sinnlos (jede Zelle
    # hat eine eigene Nonce) und würden an der Länge scheitern — der Suchwert übernimmt.
    sync_conn.execute(text("DROP INDEX IF EXISTS ix_users_email"))
    sync_conn.execute(text("ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key"))
    for t, c in enc_spalten():
        if isinstance(c.type, krypto.EncBytes):
            continue
        typ = sync_conn.execute(text(
            "SELECT data_type FROM information_schema.columns "
            "WHERE table_name = :t AND column_name = :c"), {"t": t.name, "c": c.name}).scalar()
        if typ is None or typ == "text":
            continue
        sync_conn.execute(text(f'ALTER TABLE "{t.name}" ALTER COLUMN "{c.name}" TYPE TEXT USING "{c.name}"::text'))
        getan.append(f"{t.name}.{c.name}: {typ} → text")
    sync_conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_users_email_idx ON users (email_idx)"))
    return getan


def _als_text(v) -> str:
    """Klartext aus einer Rohspalte als der Text, den der Typ später erwartet."""
    if isinstance(v, str):
        return v
    if isinstance(v, bool):
        return json.dumps(v)
    if isinstance(v, (int, float)):
        return repr(float(v)) if isinstance(v, float) else str(v)
    return json.dumps(v, ensure_ascii=False)


async def email_suchwerte(db) -> int:
    """Suchwert für Konten ohne — vor dem Verschlüsseln, solange die Adresse lesbar ist."""
    n = 0
    for u in (await db.execute(select(User).where(User.email_idx.is_(None)))).scalars().all():
        if u.email:
            u.email_idx = krypto.suchwert(u.email)
            n += 1
    if n:
        await db.commit()
    return n


async def bestand_verschluesseln(engine) -> dict:
    """Alles Unverschlüsselte in den Enc-Spalten umschreiben. Gibt Zahlen je Spalte zurück."""
    zaehlung: dict[str, int] = {}
    for t, c in enc_spalten():
        roh = krypto.roh_tabelle(t)
        rc = roh.c[c.name]
        bytes_spalte = isinstance(c.type, krypto.EncBytes)
        label = c.type.label
        fertig = 0
        while True:
            async with engine.begin() as conn:
                if bytes_spalte:
                    bedingung = func.substr(rc, 1, 4) != krypto.PRAEFIX_B
                else:
                    bedingung = ~rc.like(krypto.PRAEFIX + "%")
                zeilen = (await conn.execute(
                    select(roh.c.id, rc).where(rc.is_not(None), bedingung).order_by(roh.c.id).limit(PAKET))).all()
                if not zeilen:
                    break
                werte = []
                for pk, v in zeilen:
                    if bytes_spalte:
                        neu = krypto.PRAEFIX_B + krypto.verschluessle(bytes(v), label)
                    else:
                        neu = krypto.text_verschluesseln(_als_text(v), label)
                    werte.append({"b_id": pk, "b_wert": neu})
                await conn.execute(
                    update(roh).where(roh.c.id == bindparam("b_id")).values({c.name: bindparam("b_wert")}), werte)
                fertig += len(zeilen)
        if fertig:
            zaehlung[f"{t.name}.{c.name}"] = fertig
    return zaehlung
