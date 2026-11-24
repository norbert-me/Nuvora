#!/usr/bin/env python3
"""Schutz gegen „Slopsquatting": erfundene oder untergeschobene Paketnamen.

Ein Sprachmodell erfindet gern plausible Paketnamen; wer sie auf PyPI oder npm
anmeldet, bekommt den Code jedes Entwicklers, der sie ungeprueft installiert.
Dagegen stehen hier drei Dinge:

  1. Jede DIREKTE Abhaengigkeit steht in `scripts/abhaengigkeiten.freigegeben.json`.
     Ein neuer Name faellt auf, bis ihn ein Mensch dort eintraegt — mit dem
     Commit, nicht nebenbei.
  2. Die Lock-Dateien sind lueckenlos: Python mit Hash je Datei, npm mit
     Integrity-Summe und Herkunft ausschliesslich registry.npmjs.org (keine
     git-/URL-/Datei-Abhaengigkeiten).
  3. `--netz`: jeder NEUE Name muss in der Registry existieren und dort seit
     mindestens 60 Tagen veroeffentlicht sein — ein frisch angemeldeter Name,
     den es gestern noch nicht gab, ist genau das Muster des Angriffs.

Aufruf:  python3 scripts/pruefe_abhaengigkeiten.py [--netz]
Exit 1 bei Befund.
"""
import json
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FREIGABE = ROOT / "scripts" / "abhaengigkeiten.freigegeben.json"
NPM_PROJEKTE = ["apps/web", "apps/desktop", "scripts"]
PY_MANIFESTE = ["apps/api/requirements.txt", "apps/api/requirements-dev.txt"]
MINDESTALTER_TAGE = 60


def py_name(zeile: str):
    z = zeile.split("#", 1)[0].strip()
    if not z or z.startswith("-"):
        return None
    m = re.match(r"([A-Za-z0-9][A-Za-z0-9._-]*)", z)
    return re.sub(r"[-_.]+", "-", m.group(1)).lower() if m else None


def py_direkt() -> set:
    out = set()
    for f in PY_MANIFESTE:
        for zeile in (ROOT / f).read_text(encoding="utf-8").splitlines():
            n = py_name(zeile)
            if n:
                out.add(n)
    return out


def npm_direkt() -> dict:
    out = {}
    for p in NPM_PROJEKTE:
        datei = ROOT / p / "package.json"
        if datei.exists():
            d = json.loads(datei.read_text(encoding="utf-8"))
            out[p] = sorted({*d.get("dependencies", {}), *d.get("devDependencies", {}),
                             *d.get("optionalDependencies", {})})
    return out


def pruefe_py_lock(befunde: list):
    lock = (ROOT / "apps/api/requirements.lock.txt").read_text(encoding="utf-8")
    eintraege = re.split(r"\n(?=\S)", lock)
    namen = set()
    for blk in eintraege:
        m = re.match(r"([A-Za-z0-9][A-Za-z0-9._-]*)==", blk)
        if not m:
            continue
        name = re.sub(r"[-_.]+", "-", m.group(1)).lower()
        namen.add(name)
        if "--hash=sha256:" not in blk:
            befunde.append(f"Lock: {name} ohne Hash")
    for n in sorted(py_direkt() - namen - {"pytest", "pytest-asyncio", "httpx"}):
        # Testwerkzeuge liegen bewusst nicht in der Lock-Datei (nie ausgeliefert).
        if n not in dev_namen():
            befunde.append(f"Manifest nennt {n}, die Lock-Datei nicht")


def dev_namen() -> set:
    out = set()
    for zeile in (ROOT / "apps/api/requirements-dev.txt").read_text(encoding="utf-8").splitlines():
        n = py_name(zeile)
        if n:
            out.add(n)
    return out


def pruefe_npm_lock(projekt: str, befunde: list):
    datei = ROOT / projekt / "package-lock.json"
    if not datei.exists():
        befunde.append(f"{projekt}: package-lock.json fehlt")
        return
    lock = json.loads(datei.read_text(encoding="utf-8"))
    for pfad, info in (lock.get("packages") or {}).items():
        if not pfad or info.get("link"):
            continue
        name = pfad.split("node_modules/")[-1]
        res = info.get("resolved", "")
        if not res.startswith("https://registry.npmjs.org/"):
            befunde.append(f"{projekt}: {name} kommt nicht aus registry.npmjs.org ({res or 'ohne Quelle'})")
        if not info.get("integrity"):
            befunde.append(f"{projekt}: {name} ohne Integrity-Summe")


def alter_tage(oekosystem: str, name: str):
    """Alter der aeltesten Veroeffentlichung in Tagen, None wenn es den Namen nicht gibt."""
    url = (f"https://pypi.org/pypi/{name}/json" if oekosystem == "python"
           else f"https://registry.npmjs.org/{name.replace('/', '%2F')}")
    try:
        with urllib.request.urlopen(url, timeout=15) as r:
            d = json.load(r)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise
    if oekosystem == "python":
        zeiten = [u["upload_time_iso_8601"] for fs in d.get("releases", {}).values() for u in fs]
    else:
        zeiten = [v for k, v in (d.get("time") or {}).items() if k == "created"]
    if not zeiten:
        return 0
    erste = min(datetime.fromisoformat(z.replace("Z", "+00:00")) for z in zeiten)
    return (datetime.now(timezone.utc) - erste).days


def main(netz: bool = False) -> int:
    frei = json.loads(FREIGABE.read_text(encoding="utf-8"))
    befunde, neu = [], []
    py = py_direkt()
    for n in sorted(py - set(frei.get("python", []))):
        neu.append(("python", n))
    for p, namen in npm_direkt().items():
        for n in namen:
            if n not in set(frei.get("npm", {}).get(p, [])):
                neu.append(("npm", n))
    for oeko, n in neu:
        befunde.append(f"NEUER Paketname {n} ({oeko}) — pruefen und in {FREIGABE.name} eintragen")
        if netz:
            try:
                a = alter_tage(oeko, n)
            except Exception as e:  # kein Netz ist kein Befund ueber das Paket
                print(f"  (Registry nicht erreichbar fuer {n}: {e})")
                continue
            if a is None:
                befunde.append(f"{n}: gibt es in der Registry NICHT — erfundener Name?")
            elif a < MINDESTALTER_TAGE:
                befunde.append(f"{n}: erst {a} Tage alt (Mindestalter {MINDESTALTER_TAGE}) — verdaechtig frisch")
    pruefe_py_lock(befunde)
    for p in NPM_PROJEKTE:
        pruefe_npm_lock(p, befunde)
    if befunde:
        print("Abhaengigkeiten: BEFUND")
        for b in befunde:
            print("  ✗", b)
        return 1
    print(f"Abhaengigkeiten in Ordnung: {len(py)} Python-Pakete, "
          f"{sum(len(v) for v in npm_direkt().values())} npm-Pakete direkt, Lock-Dateien lueckenlos.")
    return 0


if __name__ == "__main__":
    sys.exit(main("--netz" in sys.argv))
