"""Aus einer Sicherung zurückholen — je Modul, nur die eigenen Daten, mit Vergleich.

Warum es das gibt: Ein Rollback der ganzen Installation (`backup.zurueckspielen`) setzt ALLES zurück,
auch die Arbeit der anderen Konten und alles, was seitdem passiert ist. Für „meine Noten aus Kurs 8 sind
weg" ist das ein größerer Schaden als der, den es behebt. Hier holt eine Lehrkraft selbst zurück, was
IHR gehört, für EIN Modul, und sieht vorher, was sich unterscheidet.

Regeln, die nicht aufweichen dürfen:

* **Nur Eigenes.** Eine Zeile gilt als eigen, wenn ihre `owner_id` das Konto ist — oder, bei Tabellen ohne
  Besitzer-Spalte (Noten, Karten, Abgaben …), wenn sie über einen Fremdschlüssel an einer eigenen Zeile hängt.
  Das wird in der SICHERUNG entschieden (der Besitz von damals), nie aus der Anfrage.
* **Nie löschen.** Es gibt drei Zustände je Zeile: *fehlt heute* (in der Sicherung, nicht mehr da), *anders*
  (gibt es beides, Werte weichen ab) und *neu* (heute da, damals nicht). Nur die ersten beiden lassen sich
  zurückholen, *neu* wird nur gezählt.
* **Fehlendes holt sich leicht, Überschreiben nur ausdrücklich.** Die Oberfläche hakt „fehlt heute" vor und
  lässt „anders" aus.
* **Zugangsdaten bleiben, wie sie sind** (`GESCHUETZT`): ein zurückgeholter Zettel-Token wäre ein alter, schon
  ungültiger Zugang.

Ein Blatt (importiert keinen Router).
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import re
import zipfile
from datetime import date, datetime, timezone

from sqlalchemy import select

from . import krypto
from .models import Base
from .sicherungsformat import dekodiere

# Modul-Schlüssel (REGISTRY) -> Tabellen. „kern" ist kein Modul, sondern das, worauf alle aufsetzen.
MODULE: dict[str, tuple[str, ...]] = {
    "kern": ("school_classes", "kurse", "kurs_tags", "kurs_students", "persons", "students", "topics"),
    "cardvote": ("folders", "questions", "question_sets", "question_set_items", "sessions", "scans"),
    "lernpfad": ("exercises", "learning_paths", "learning_ladders"),
    "auswertung": ("grade_sections", "grade_categories", "grade_entries", "grade_overrides", "quartal_dividers", "quartal_daten",
                   "work_analyses", "exam_dates", "observations", "parent_contacts"),
    "code-detektiv": ("code_puzzles", "code_sessions"),
    "karten": ("card_folders", "card_decks", "card_deck_kurse", "cards", "card_reviews"),
    "kalender": ("calendar_entries", "calendar_breaks", "timetable_slots", "slot_cancellations", "external_event_archive"),
    "orga": ("seating_plans", "orga_items", "material_items", "material_loans", "segel_status", "attendance"),
    "zufall": ("zufall_draws",),
    "unterrichtsplanung": ("method_folders", "methods", "plan_weeks", "plan_blocks", "materials"),
    "notizbrett": ("todos", "notepad_notes"),
    "pap": ("pap_aufgaben", "pap_abgaben"),
    "waage": ("waage_aufgaben", "waage_abgaben"),
    "tafel": ("tafel_boards",),
    "reihen": ("reihen", "reihen_stunden"),
}

# Gehören keiner Lehrkraft oder sind Zugangsdaten der Installation — nie Teil einer Wiederherstellung.
AUSGENOMMEN = {
    "app_settings", "users", "user_modules", "bug_reports", "bug_report_anhaenge", "caldav_tokens",
    "marketplace_quizzes", "marketplace_ratings",
}

# Spalten, die nie zurückgeholt werden: Zugänge, die inzwischen anders sind (ein alter Token ist tot),
# und Zähler, die der Server selbst führt.
GESCHUETZT = {"karten_token", "token", "password_hash", "calendar_token", "version", "geaendert_at", "updated_at"}

GROESSE_MAX_ZEILEN = 400     # je Tabelle in der Antwort; der Rest wird gezählt
BLOB_AB = 2000               # Werte darüber (Fotos) werden nur per Prüfsumme verglichen


class Blob:
    """Großer Binärwert (Foto): verglichen wird die Prüfsumme, gezeigt die Größe."""
    __slots__ = ("laenge", "summe")

    def __init__(self, daten: bytes):
        self.laenge = len(daten)
        self.summe = hashlib.sha1(daten).hexdigest()

    def __eq__(self, o):
        return isinstance(o, Blob) and o.summe == self.summe

    def __hash__(self):
        return hash(self.summe)


def tabellen_von(modul: str) -> tuple[str, ...]:
    if modul not in MODULE:
        raise KeyError(modul)
    return MODULE[modul]


def unzugeordnet() -> list[str]:
    """Tabellen, die weder einem Modul gehören noch ausgenommen sind — der Wächtertest meldet sie."""
    bekannt = {t for ts in MODULE.values() for t in ts} | AUSGENOMMEN
    return sorted(t.name for t in Base.metadata.sorted_tables if t.name not in bekannt)


def _plan() -> dict[str, dict]:
    """Je Tabelle: Besitzer-Spalte und die Fremdschlüssel zu Tabellen, die selbst Besitz tragen/erben."""
    plan: dict[str, dict] = {}
    for t in Base.metadata.sorted_tables:
        if t.name in AUSGENOMMEN:
            continue
        besitz = "owner_id" if "owner_id" in t.c else ("user_id" if "user_id" in t.c else None)
        fks = []
        for fk in t.foreign_keys:
            ziel = fk.column.table.name
            if ziel in AUSGENOMMEN or ziel == t.name:
                continue
            fks.append((fk.parent.name, ziel))
        plan[t.name] = {"besitz": besitz, "fks": fks}
    return plan


PLAN = _plan()


def noetige_tabellen(modul: str) -> set[str]:
    """Die Tabellen des Moduls und alle, über die ihr Besitz läuft (Eltern, rekursiv)."""
    rest, fertig = list(tabellen_von(modul)), set()
    while rest:
        t = rest.pop()
        if t in fertig or t not in PLAN:
            continue
        fertig.add(t)
        rest.extend(ziel for _, ziel in PLAN[t]["fks"])
    return fertig


def _eigen(tabelle: str, zeile: dict, uid: int, eigene: dict[str, set]) -> bool:
    p = PLAN[tabelle]
    if p["besitz"] and zeile.get(p["besitz"]) == uid:
        return True
    return any(zeile.get(c) is not None and zeile.get(c) in eigene.get(ziel, ()) for c, ziel in p["fks"])


def normiere(v):
    """Werte vergleichbar machen: Zeitpunkte in UTC ohne Zone, Zahlen gerundet, große Binärwerte als Blob."""
    if isinstance(v, datetime):
        if v.tzinfo is not None:
            v = v.astimezone(timezone.utc).replace(tzinfo=None)
        return v.replace(microsecond=0).isoformat()
    if isinstance(v, date):
        return v.isoformat()
    if isinstance(v, float):
        return round(v, 6)
    if isinstance(v, (bytes, bytearray)):
        b = bytes(v)
        return Blob(b) if len(b) >= BLOB_AB else b
    return v


def _lesbar(tabelle, spalte: str, wert):
    """Ein Wert aus der Sicherung, entschlüsselt und vergleichbar."""
    if wert is None:
        return None
    wert = dekodiere(wert)
    col = tabelle.c.get(spalte) if spalte in tabelle.c else None
    if col is not None and krypto.ist_enc(col):
        wert = krypto.roh_wert_lesbar(col, wert)
    return normiere(wert)


def lies_sicherung(pfad: str, uid: int, modul: str, *, roh_ids: dict[str, set] | None = None) -> dict:
    """Die eigenen Zeilen eines Moduls aus der Sicherung.

    Rückgabe: `{"zeilen": {tabelle: {id: {spalte: wert}}}, "eigene": {tabelle: {id}}, "roh": {tabelle: {id: zeile}}}`.
    `roh` (mit Chiffretext, wie in der Datei) gibt es nur für die Ids in `roh_ids` — fürs Einspielen.
    Eine Datei wird einmal von vorn gelesen; Eltern stehen vor Kindern (sorted_tables), also genügt ein Durchgang.
    """
    tabellen = set(tabellen_von(modul))
    noetig = noetige_tabellen(modul)
    meta = Base.metadata.tables
    eigene: dict[str, set] = {}
    zeilen: dict[str, dict] = {t: {} for t in tabellen}
    roh: dict[str, dict] = {}
    with zipfile.ZipFile(pfad) as zf:
        with zf.open("datenbank.ndjson") as f:
            for zeile in io.TextIOWrapper(f, encoding="utf-8"):
                zeile = zeile.strip()
                if not zeile:
                    continue
                # Zeilen der Form {"t": "<tabelle>", "r": …}: den Namen ohne Parsen lesen, damit
                # Tabellen, die hier keine Rolle spielen (Fotos!), gar nicht erst dekodiert werden.
                t = zeile[7:zeile.index('"', 7)]
                if t not in noetig or t not in meta:
                    continue
                satz = json.loads(zeile)
                r = satz["r"]
                # Besitz und Fremdschlüssel sind Zahlen; für die Entscheidung genügt die Rohsicht.
                if not _eigen(t, r, uid, eigene):
                    continue
                if "id" in r:
                    eigene.setdefault(t, set()).add(r["id"])
                if t in tabellen:
                    tab = meta[t]
                    zeilen[t][r.get("id")] = {k: _lesbar(tab, k, v) for k, v in r.items()}
                    if roh_ids and r.get("id") in roh_ids.get(t, ()):
                        roh.setdefault(t, {})[r["id"]] = r
    return {"zeilen": zeilen, "eigene": eigene, "roh": roh}


async def eigene_ids_heute(db, uid: int) -> dict[str, set]:
    """Besitz heute: welche Zeilen (je Tabelle) gehören diesem Konto — gleiche Regel wie in der Sicherung."""
    eigene: dict[str, set] = {}
    for t in Base.metadata.sorted_tables:
        if t.name not in PLAN or "id" not in t.c:
            continue
        p = PLAN[t.name]
        spalten = [t.c.id] + [t.c[c] for c, _ in p["fks"]] + ([t.c[p["besitz"]]] if p["besitz"] else [])
        for row in (await db.execute(select(*spalten))).mappings().all():
            if _eigen(t.name, dict(row), uid, eigene):
                eigene.setdefault(t.name, set()).add(row["id"])
    return eigene


async def lade_heute(db, tabelle: str, ids) -> dict:
    """Die heutigen Zeilen zu den Ids, lesbar (entschlüsselt) und vergleichbar."""
    t = Base.metadata.tables[tabelle]
    raus = {}
    ids = list(ids)
    for i in range(0, len(ids), 500):
        for row in (await db.execute(select(t).where(t.c.id.in_(ids[i:i + 500])))).mappings().all():
            raus[row["id"]] = {k: normiere(v) for k, v in row.items()}
    return raus


def bezeichnung(tabelle: str, zeile: dict) -> str:
    """Ein Satz, an dem man die Zeile erkennt (kein Schlüssel, kein Zeitstempel)."""
    for k in ("name", "title", "text", "titel", "content", "note", "label", "code", "message"):
        v = zeile.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip().replace("\n", " ")[:80]
    for k in ("value", "date", "period", "weekday"):
        v = zeile.get(k)
        if v not in (None, ""):
            return f"{k} {v}"
    return f"#{zeile.get('id')}"


def anzeige(v) -> str:
    """Wert für den Vergleich: kurz, ohne Binärdaten."""
    if v is None:
        return "—"
    if isinstance(v, Blob):
        return f"Bild ({v.laenge // 1024} KB)"
    if isinstance(v, (dict, list)):
        s = json.dumps(v, ensure_ascii=False)
    else:
        s = str(v)
    return s if len(s) <= 120 else s[:117] + "…"


def vergleiche(sicherung: dict, heute: dict, eigene_heute: dict) -> dict:
    """Je Tabelle: fehlt heute / anders / neu seit der Sicherung / gleich.

    `sicherung`: Rückgabe von `lies_sicherung`; `heute`: {tabelle: {id: zeile}} zu den Ids der Sicherung.
    """
    tabellen = []
    for name, rows in sicherung["zeilen"].items():
        fehlt, anders, gleich = [], [], 0
        jetzt = heute.get(name, {})
        for rid, alt in rows.items():
            neu = jetzt.get(rid)
            if neu is None:
                fehlt.append({"id": rid, "bezeichnung": bezeichnung(name, alt)})
                continue
            felder = []
            for k, v in alt.items():
                if k in GESCHUETZT or k == "id" or k not in neu:
                    continue
                if v != neu[k]:
                    felder.append({"spalte": k, "jetzt": anzeige(neu[k]), "sicherung": anzeige(v)})
            if felder:
                anders.append({"id": rid, "bezeichnung": bezeichnung(name, neu), "felder": felder})
            else:
                gleich += 1
        neu_seitdem = len(eigene_heute.get(name, set()) - set(rows))
        if not (fehlt or anders or neu_seitdem or gleich):
            continue
        tabellen.append({
            "tabelle": name,
            "fehlt": fehlt[:GROESSE_MAX_ZEILEN], "fehlt_gesamt": len(fehlt),
            "anders": anders[:GROESSE_MAX_ZEILEN], "anders_gesamt": len(anders),
            "gleich": gleich, "neu_seitdem": neu_seitdem,
        })
    return {"tabellen": tabellen}


async def anwenden(db, pfad: str, uid: int, modul: str, auswahl: list[dict]) -> dict:
    """Die gewählten Zeilen zurückholen. `auswahl`: [{"t": Tabelle, "id": int, "aktion": "einfuegen"|"ueberschreiben"}].

    Nichts davon wird der Anfrage geglaubt: ob eine Zeile eigen ist, entscheidet die Sicherung (Besitz von
    damals) UND — beim Überschreiben — der Besitz heute. Was nicht passt, wird übersprungen und genannt,
    nie still ersetzt. Jede Zeile läuft in ihrem eigenen Teil-Savepoint: eine Zeile, die an einem
    Fremdschlüssel scheitert, reißt die anderen nicht mit.
    """
    from sqlalchemy.exc import SQLAlchemyError

    from .sicherungsformat import passend_machen

    erlaubt = set(tabellen_von(modul))
    gewuenscht: dict[str, dict[int, str]] = {}
    for a in auswahl:
        t, rid, aktion = a.get("t"), a.get("id"), a.get("aktion")
        if t not in erlaubt or aktion not in ("einfuegen", "ueberschreiben") or not isinstance(rid, int):
            raise ValueError(f"Ungültige Auswahl: {a!r}")
        gewuenscht.setdefault(t, {})[rid] = aktion

    sich = lies_sicherung(pfad, uid, modul, roh_ids={t: set(v) for t, v in gewuenscht.items()})
    eigene_heute = await eigene_ids_heute(db, uid)
    ergebnis = {"eingefuegt": 0, "ueberschrieben": 0, "uebersprungen": []}
    neu_da: dict[str, set] = {}

    def skip(t, rid, grund):
        ergebnis["uebersprungen"].append({"t": t, "id": rid, "grund": grund})

    for tab in Base.metadata.sorted_tables:          # Eltern vor Kindern
        t = tab.name
        if t not in gewuenscht:
            continue
        roh_ids = list(gewuenscht[t])
        vorhanden = set((await db.execute(select(tab.c.id).where(tab.c.id.in_(roh_ids)))).scalars().all())
        for rid, aktion in gewuenscht[t].items():
            roh = sich["roh"].get(t, {}).get(rid)
            if roh is None:
                skip(t, rid, "nicht (mehr) als eigene Zeile in der Sicherung")
                continue
            werte = {k: dekodiere(v) for k, v in roh.items() if k not in GESCHUETZT}
            try:
                if aktion == "einfuegen":
                    if rid in vorhanden:
                        skip(t, rid, "gibt es inzwischen wieder")
                        continue
                    fehlende = [
                        f"{fk.column.table.name}#{werte[fk.parent.name]}"
                        for fk in tab.foreign_keys
                        if fk.column.table.name != t and fk.column.table.name not in AUSGENOMMEN
                        and werte.get(fk.parent.name) is not None
                        and werte[fk.parent.name] not in eigene_heute.get(fk.column.table.name, set())
                        and werte[fk.parent.name] not in neu_da.get(fk.column.table.name, set())
                    ]
                    if fehlende:
                        skip(t, rid, "braucht " + ", ".join(fehlende[:3]) + " (gibt es nicht mehr — dort zuerst zurückholen)")
                        continue
                    zeilen, _ = passend_machen(tab, [werte])
                    ziel_tab, zeilen = krypto.fuer_einspielen(tab, zeilen)
                    async with db.begin_nested():
                        await db.execute(ziel_tab.insert(), zeilen)
                    neu_da.setdefault(t, set()).add(rid)
                    eigene_heute.setdefault(t, set()).add(rid)
                    ergebnis["eingefuegt"] += 1
                else:
                    if rid not in vorhanden or rid not in eigene_heute.get(t, set()):
                        skip(t, rid, "gibt es heute nicht (mehr) als eigene Zeile")
                        continue
                    werte.pop("id", None)
                    zeilen, _ = passend_machen(tab, [werte])
                    ziel_tab, zeilen = krypto.fuer_einspielen(tab, zeilen)
                    async with db.begin_nested():
                        await db.execute(ziel_tab.update().where(ziel_tab.c.id == rid).values(**zeilen[0]))
                    ergebnis["ueberschrieben"] += 1
            except SQLAlchemyError as e:
                skip(t, rid, f"Datenbank lehnt ab: {str(e.__cause__ or e).splitlines()[0][:120]}")
    await db.commit()
    return ergebnis


# ── Wo liegen die Sicherungen? ───────────────────────────────────────────────
# Dasselbe Muster und derselbe Ordner wie `routers/backup.py` (dort ist die Quelle). Hier nicht importiert,
# weil ein Router den anderen nicht importieren darf; der Ordner wird bei jedem Aufruf aus der Umgebung gelesen.
DATEI_MUSTER = re.compile(r"nuvora-\d{8}-\d{6}(-\d+)?\.zip", re.ASCII)


def sicherungs_ordner() -> str:
    return os.environ.get("NUVORA_BACKUP_DIR", "/app/backups")


def sicherungen_liste() -> list[dict]:
    """Name und Zeit der vorhandenen Sicherungen, neueste zuerst. Mehr bekommt eine Lehrkraft nicht zu sehen."""
    ordner = sicherungs_ordner()
    if not os.path.isdir(ordner):
        return []
    raus = []
    for n in os.listdir(ordner):
        if DATEI_MUSTER.fullmatch(n):
            st = os.stat(os.path.join(ordner, n))
            raus.append({"name": n, "zeit": datetime.fromtimestamp(st.st_mtime, timezone.utc).isoformat()})
    return sorted(raus, key=lambda e: (e["zeit"], e["name"]), reverse=True)


def sicherungs_pfad(name: str) -> str | None:
    """Voller Pfad — aus dem Verzeichniseintrag, nicht aus der Anfrage (kein `..`, kein Symlink hinaus)."""
    if not DATEI_MUSTER.fullmatch(name or ""):
        return None
    ordner = os.path.realpath(sicherungs_ordner())
    if not os.path.isdir(ordner):
        return None
    for eintrag in os.listdir(ordner):
        if eintrag != name or not DATEI_MUSTER.fullmatch(eintrag):
            continue
        voll = os.path.realpath(os.path.join(ordner, eintrag))   # `eintrag` kommt aus der Liste, nicht aus der Anfrage
        if os.path.dirname(voll) == ordner and os.path.isfile(voll):
            return voll
    return None


async def anreichern(db, ergebnis: dict, sicherung: dict) -> None:
    """Zeilen erkennbar machen: eine Note heisst „Anna Muster · 7.1 · value 1.7", nicht nur „value 1.7".

    Der Name kommt aus den verknuepften Zeilen, wie sie HEUTE in der Datenbank stehen (entschluesselt, also
    nur fuer die angemeldete Lehrkraft, deren Zeilen es ohnehin sind). Ist das Elternteil selbst weg, bleibt
    nur die Zeile selbst — dafuer gibt es dann den Hinweis „braucht students#…" beim Einspielen.
    """
    meta = Base.metadata.tables
    gesucht: dict[str, set] = {}
    for tb in ergebnis["tabellen"]:
        for art in ("fehlt", "anders"):
            for z in tb[art]:
                row = sicherung["zeilen"].get(tb["tabelle"], {}).get(z["id"], {})
                for col, ziel in PLAN[tb["tabelle"]]["fks"]:
                    if row.get(col) is not None and ziel in meta and ("name" in meta[ziel].c or "title" in meta[ziel].c):
                        gesucht.setdefault(ziel, set()).add(row[col])
    namen: dict[str, dict] = {}
    for ziel, ids in gesucht.items():
        t = meta[ziel]
        feld = t.c.name if "name" in t.c else t.c.title
        namen[ziel] = {i: v for i, v in (await db.execute(select(t.c.id, feld).where(t.c.id.in_(list(ids))))).all() if v}
    for tb in ergebnis["tabellen"]:
        for art in ("fehlt", "anders"):
            for z in tb[art]:
                row = sicherung["zeilen"].get(tb["tabelle"], {}).get(z["id"], {})
                paare = [(ziel, namen.get(ziel, {}).get(row.get(col))) for col, ziel in PLAN[tb["tabelle"]]["fks"]]
                # Das Kind zuerst: „Anna · Spalte 2.1 · …" liest sich besser als umgekehrt.
                paare.sort(key=lambda p: 0 if p[0] in ("students", "persons") else 1)
                kontext = [n for _, n in paare if n][:2]
                if kontext:
                    z["bezeichnung"] = " · ".join(kontext + [z["bezeichnung"]])
