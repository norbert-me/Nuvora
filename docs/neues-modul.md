# Ein neues Modul bauen

Ein Modul ist kein eigenes Projekt: es ist ein Router in `apps/api`, eine Seite
in `apps/web` und **fünf Einträge**, ohne die es zwar läuft, aber ungeprüft
bleibt. Die fünf Einträge sind Absicht — ein Modul ohne Probe ist ein Modul,
von dem nach dem Deploy niemand weiß, ob es noch geht.

Vorher lesen: die [Architektur](architektur.md), vor allem die drei Regeln.
Besonders **Regel 3** — dein Modul darf kein anderes voraussetzen.

## Die fünf Einträge

| # | Datei                                   | Eintrag        | Was passiert, wenn er fehlt |
| - | --------------------------------------- | -------------- | --------------------------- |
| 1 | `apps/api/app/routers/modules.py`       | `REGISTRY`     | Das Modul existiert nicht — es ist nirgends zuschaltbar. |
| 2 | `apps/web/src/core/modules.js`          | `MODUL_KEYS`   | `test_modul_keys_frontend.py` wird rot. |
| 3 | `apps/web/src/main.jsx`                 | Route hinter `ModuleGate` | Die Seite ist nicht erreichbar oder — schlimmer — ohne Aktivierung erreichbar. |
| 4 | `apps/api/app/routers/selftest.py`      | `MODUL_PREFIX` | Der Selbsttest meldet „steht im REGISTRY, aber nicht in MODUL_PREFIX". |
| 5 | `scripts/selftest.py`                   | `PROBEN`       | Der Selbsttest meldet „hat keine Probe". |

Reine Frontend-Module (ohne Backend, z. B. `tafel`, `mathespiele`) stehen bei 4
und 5 mit `None` — sie werden im Browser-Test geprüft statt über die API.

## Schritt für Schritt

### 1. Register-Eintrag

`apps/api/app/routers/modules.py`, in `REGISTRY`:

```python
ModuleDef(
    key="meinmodul",              # klein, ASCII, mit Bindestrich statt Leerzeichen
    group="unterricht",           # "unterricht" | "organisation" | "werkzeug"
    name="Mein Modul",
    description="Ein Satz, der einer Lehrkraft sagt, was sie davon hat.",
    path="/meinmodul",
    stage="alpha",                # "alpha" | "beta" | "stable" — die Shell zeigt es als Badge
),
```

Der `key` ist ab hier gesetzt. Er taucht in vier weiteren Dateien auf; ein
späterer Umbenennen ist ein Suchen-und-Ersetzen über Backend, Frontend und
Tests, und die Datenbank (`user_modules`) merkt sich den alten Wert.

### 2. Backend-Router

Neue Datei `apps/api/app/routers/meinmodul.py`. Das Muster ist bei allen
Modulen dasselbe — hier verkürzt nach `notizen.py`:

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import SchoolClass, Student, User
from .auth import get_current_user
from .modules import is_active

router = APIRouter(prefix="/api/meinmodul", tags=["meinmodul"])
MODULE_KEY = "meinmodul"


async def require_module(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    if not await is_active(db, user.id, MODULE_KEY):
        raise HTTPException(403, "Modul Mein Modul ist nicht aktiviert")
    return user
```

Jeder Endpunkt des Moduls hängt an `Depends(require_module)`, **nicht** an
`get_current_user`. Das ist die eigentliche Schranke; `ModuleGate` im Frontend
ist nur Kosmetik.

Dann in `apps/api/app/main.py` importieren und `app.include_router(meinmodul.router)`
ergänzen.

Drei Dinge, die dabei schiefgehen:

- **Eigene Klassen oder Schüler anlegen.** Verboten (Regel 1). Dein Modul
  referenziert `class_id` / `student_id` aus dem Kern.
- **Mandantentrennung vergessen.** Jeder Zugriff prüft `owner_id` gegen den
  angemeldeten Nutzer — sonst liest Konto B die Daten von Konto A. Vorbild:
  `_owned_student` in `notizen.py`. `apps/api/tests/test_tenant_isolation.py`
  ist der passende Regressionstest.
- **Ein anderes Modul voraussetzen.** Wenn du Daten aus einem anderen Modul
  brauchst, ist das eine **Brücke**: sie funktioniert, wenn beide Module aktiv
  sind, und verschwindet sauber, wenn nicht. Kein 500, kein leerer Bildschirm.

### 3. Tabellen

Neue Tabellen in `apps/api/app/models.py` anlegen — sie entstehen beim Start
von selbst (`Base.metadata.create_all`). Es gibt **kein Alembic**.

- Neue **Spalte auf einer bestehenden Tabelle**? In die `wanted`-Liste in
  `_ensure_columns` (`apps/api/app/main.py`), sonst fehlt sie auf jeder
  bestehenden Installation.
- Soll Gelöschtes in den Papierkorb? Spalte `deleted_at`, Eintrag in
  `list_trash` und `_AKTIONEN` (`routers/trash.py`) und in
  `PAPIERKORB_TABELLEN` in `main.py` (30-Tage-Job).
- Personenbezogene Felder: erst [Datenschutz](datenschutz.md) lesen. Alles,
  was Förderbedarf oder Beobachtungen berührt, ist DSGVO Art. 9 und gehört in
  **keinen** Export.

### 4. Frontend

- Seite unter `apps/web/src/pages/MeinModul.jsx`.
- Stile **nur** aus `apps/web/src/components/Icons.jsx` — keine seiteneigenen
  Buttons, Inputs oder Tabs.
- Route in `apps/web/src/main.jsx`:

```jsx
<Route
  path="/meinmodul"
  element={user ? <ModuleGate moduleKey="meinmodul"><MeinModul /></ModuleGate> : <Landing />}
/>
```

- Schlüssel in `MODUL_KEYS` in `apps/web/src/core/modules.js`.
- Abfragen auf andere Module immer über `useAktiv()`:

```jsx
const aktiv = useAktiv();
{aktiv("karten") && <Knopf … />}
```

Ein Tippfehler dort wirft keinen Fehler, die Abfrage ist einfach für immer
`false` und das Feature verschwindet lautlos. Genau so waren vier
Verknüpfungen monatelang tot — deshalb gibt es
`apps/api/tests/test_modul_keys_frontend.py`.

### 5. In den Selbsttest eintragen

`apps/api/app/routers/selftest.py`, in `MODUL_PREFIX`:

```python
"meinmodul": "/api/meinmodul",   # oder None, wenn es kein Backend gibt
```

`scripts/selftest.py`: eine Probe schreiben und in `PROBEN` eintragen. Die
Probe ist ein echter Schreib-Roundtrip auf Kern-Daten — anlegen, lesen, ändern,
löschen — und gibt am Ende einen kurzen Satz zurück, was sie getan hat:

```python
def probe_meinmodul(api, u):
    api.call("POST", "/api/meinmodul/dinge", {"name": f"{PRAEFIX} Ding"}, erwartet=(200, 201))
    api.call("GET", "/api/meinmodul/dinge", erwartet=(200,))
    api.call("DELETE", f"/api/meinmodul/dinge/{id}", erwartet=(200, 204))
    return "Ding anlegen und löschen"


PROBEN = {
    …,
    "meinmodul": probe_meinmodul,
}
```

Testdaten tragen das Präfix `ZZ-Selbsttest` (Konstante `PRAEFIX`) und werden
inklusive Papierkorb wieder abgeräumt. Der Test schaltet Module für den Lauf zu
und stellt den Zustand danach wieder her — er darf die Einstellungen des Kontos
nicht dauerhaft verändern.

## Prüfen

```bash
cd apps/api && pip install -r requirements-dev.txt && pytest
cd apps/web && npm run test && npm run build
```

Danach gegen eine laufende Installation:

```bash
./selftest.sh                 # alles
./selftest.sh --schnell       # nur der kurze API-Selbsttest
```

Details in [Selbsttest](selbsttest.md). Der Systemtest schaltet dein Modul
einzeln aktiv und verlangt von **allen** fremden Endpunkten genau `403` — das
ist Regel 3, maschinell geprüft.

## Checkliste

- [ ] `REGISTRY` (`apps/api/app/routers/modules.py`)
- [ ] Router mit `require_module` an **jedem** Endpunkt, in `main.py` eingehängt
- [ ] Tabellen in `models.py`; neue Spalten in `_ensure_columns`
- [ ] Papierkorb-Einträge, falls gelöscht wird
- [ ] Seite in `apps/web/src/pages`, Stile nur aus `Icons.jsx`
- [ ] Route hinter `ModuleGate` in `main.jsx`
- [ ] `MODUL_KEYS` (`apps/web/src/core/modules.js`)
- [ ] `MODUL_PREFIX` (`apps/api/app/routers/selftest.py`)
- [ ] `PROBEN` (`scripts/selftest.py`)
- [ ] `owner_id` bei jedem Zugriff geprüft
- [ ] Läuft ohne jedes andere Modul
