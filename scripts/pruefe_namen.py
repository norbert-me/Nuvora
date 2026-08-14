#!/usr/bin/env python3
"""Freie Namen finden, die es im Modul gar nicht gibt.

Anlass: ein Endpunkt benutzte `get_current_user`, ohne dass die Datei es
importiert hatte. Syntaktisch tadellos, `py_compile` zufrieden — und die API
startete nicht mehr. Solche Fehler sollen hier auffallen, in zwei Sekunden,
nicht im Container nach dem Umschalten.

Bewusst simpel und ohne Abhaengigkeiten: gesammelt werden alle Namen, die eine
Datei definiert (Importe, Zuweisungen, Funktionen, Klassen, Parameter,
Schleifenvariablen, Kontextmanager, Comprehensions) — und danach jeder gelesene
Name dagegen gehalten. Was uebrig bleibt, ist entweder ein Builtin oder ein
Fehler.

    python3 scripts/pruefe_namen.py apps/api/app
"""
import ast
import builtins
import sys
from pathlib import Path

BEKANNT = set(dir(builtins)) | {"__name__", "__file__", "__doc__", "__package__", "__all__"}


def definierte(baum):
    """Alle Namen, die irgendwo in dieser Datei gebunden werden."""
    namen = set()
    for k in ast.walk(baum):
        if isinstance(k, (ast.Import, ast.ImportFrom)):
            for a in k.names:
                namen.add((a.asname or a.name).split(".")[0])
        elif isinstance(k, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            namen.add(k.name)
            args = getattr(k, "args", None)
            if args:
                for a in (args.posonlyargs + args.args + args.kwonlyargs):
                    namen.add(a.arg)
                for a in (args.vararg, args.kwarg):
                    if a:
                        namen.add(a.arg)
        elif isinstance(k, ast.Name) and isinstance(k.ctx, (ast.Store, ast.Del)):
            namen.add(k.id)
        elif isinstance(k, ast.ExceptHandler) and k.name:
            namen.add(k.name)
        elif isinstance(k, ast.Global) or isinstance(k, ast.Nonlocal):
            namen.update(k.names)
        elif isinstance(k, (ast.comprehension,)):
            for t in ast.walk(k.target):
                if isinstance(t, ast.Name):
                    namen.add(t.id)
        elif isinstance(k, ast.Lambda):
            for a in (k.args.posonlyargs + k.args.args + k.args.kwonlyargs):
                namen.add(a.arg)
    return namen


def pruefe(pfad):
    quelle = pfad.read_text(encoding="utf-8")
    baum = ast.parse(quelle, filename=str(pfad))
    da = definierte(baum) | BEKANNT
    fehlend = {}
    for k in ast.walk(baum):
        if isinstance(k, ast.Name) and isinstance(k.ctx, ast.Load) and k.id not in da:
            fehlend.setdefault(k.id, k.lineno)
    return fehlend


def main(argv):
    ziele = [Path(a) for a in (argv or ["apps/api/app"])]
    dateien = []
    for z in ziele:
        dateien.extend(sorted(z.rglob("*.py")) if z.is_dir() else [z])
    schlecht = 0
    for f in dateien:
        for name, zeile in sorted(pruefe(f).items(), key=lambda x: x[1]):
            print(f"{f}:{zeile}: Name '{name}' ist hier nirgends definiert oder importiert")
            schlecht += 1
    if schlecht:
        print(f"\n{schlecht} unbekannte Namen — das faellt sonst erst beim Start auf.")
        return 1
    print(f"{len(dateien)} Dateien geprueft, keine unbekannten Namen.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
