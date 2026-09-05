"""Die Aenderungsliste lesen — CHANGELOG.md in Abschnitte zerlegt.

Nach einem Update soll die Lehrkraft beim naechsten Anmelden sehen, was sich
geaendert hat. Die Quelle ist dieselbe Datei, die auch die Release-Notiz auf
GitHub fuellt: eine zweite, gepflegte Fassung waere nach der dritten Fassung
veraltet.

Blatt: ohne FastAPI und ohne Datenbank, damit der Parser fuer sich testbar ist.
"""
import pathlib
import re

# Ueberschrift eines Abschnitts: "## 4.1.8 — 05.09.2026" (Datum optional).
_KOPF = re.compile(r"^##\s+v?(\d+(?:\.\d+)*)\s*(?:[—-]\s*(.*))?$")


def version_tupel(v: str) -> tuple:
    """"4.1.8" -> (4, 1, 8). Fuer den Vergleich „neuer als"."""
    teile = []
    for stueck in (v or "").strip().lstrip("vV").split("."):
        ziffern = "".join(c for c in stueck if c.isdigit())
        teile.append(int(ziffern) if ziffern else 0)
    return tuple(teile) or (0,)


def datei() -> pathlib.Path | None:
    """CHANGELOG.md — im Container gemountet, im Repo zwei Ebenen ueber app/."""
    hier = pathlib.Path(__file__).resolve()
    for p in (pathlib.Path("/app/CHANGELOG.md"),
              hier.parent.parent / "CHANGELOG.md",
              hier.parent.parent.parent.parent / "CHANGELOG.md"):
        if p.is_file():
            return p
    return None


def abschnitte(text: str) -> list[dict]:
    """Alle Fassungen als [{version, datum, inhalt}] — neueste zuerst."""
    out: list[dict] = []
    aktuell = None
    for zeile in text.splitlines():
        m = _KOPF.match(zeile.strip())
        if m:
            aktuell = {"version": m.group(1), "datum": (m.group(2) or "").strip(), "zeilen": []}
            out.append(aktuell)
        elif aktuell is not None:
            aktuell["zeilen"].append(zeile)
    return [{"version": a["version"], "datum": a["datum"],
             "inhalt": "\n".join(a["zeilen"]).strip()} for a in out]


def seit(text: str, gesehen: str, bis: str = "") -> list[dict]:
    """Die Fassungen, die neuer sind als `gesehen` (und hoechstens `bis`).

    `bis` ist die Fassung, die hier gerade laeuft: steht im CHANGELOG schon ein
    Abschnitt fuer die naechste (weil er vor dem Deploy geschrieben wurde), soll
    er nicht als „neu bei dir" erscheinen — er ist noch gar nicht da.
    """
    g = version_tupel(gesehen)
    o = version_tupel(bis) if bis else None
    return [a for a in abschnitte(text)
            if version_tupel(a["version"]) > g and (o is None or version_tupel(a["version"]) <= o)]
