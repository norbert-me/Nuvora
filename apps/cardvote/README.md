# CardVote

**[🇩🇪 Deutsch](#deutsch)** · **[🇬🇧 English](#english)**

---

<a id="deutsch"></a>

<details open>
<summary><h2>🇩🇪 Deutsch</h2></summary>

Selbstgehostetes Abstimmungstool für den Unterricht — ganz ohne digitale Endgeräte. Lernende halten bedruckte Karten hoch, die Lehrkraft scannt sie mit der Kamera und sieht die Ergebnisse in Echtzeit.

Kein Abo, keine Cloud, keine Daten der Lernenden bei Dritten. Läuft auf dem eigenen Server.


### So funktioniert es

1. **Klasse anlegen** — Namen eingeben und Kartennummern zuweisen.
2. **Karten drucken** — Jede Person bekommt eine Karte mit vier Seiten (A, B, C, D), die durch einen einzigartigen ArUco-Marker erkannt wird.
3. **Fragen erstellen** — Fragen in Ordnern und Fragesets organisieren. Unterstützt Bilder und mathematische Formeln (LaTeX).
4. **Session starten** — Klasse und Frageset wählen, Fragen auf dem Beamer projizieren.
5. **Scannen** — Scanner auf dem Handy öffnen, Session-Code eingeben, Karten der Lernenden erfassen. Ergebnisse erscheinen live.
6. **Auswerten** — Ergebnisse nach der Session als Noten, Boxplots und Diagramme einsehen, als PDF oder Excel exportieren.

### Features

#### Live-Abstimmung
- Fragen werden auf dem Beamer angezeigt, Lernende halten ihre Karten hoch
- Die Lehrkraft scannt mit dem Handy — Ergebnisse erscheinen in Echtzeit per WebSocket
- Einzelne Antworten können auf Wunsch beim Aufdecken sichtbar gemacht werden
- Timer pro Frage einstellbar (15s – 2min)

#### Spiel-Modus
- Punkte, Streaks und Bestenliste — spielerisches Lernen ohne Benotung
- Geschwindigkeitsbonus für schnelle Antworten
- Podium-Ansicht am Ende mit Top 3

#### Auswertung & Notengebung
- Notenverteilung (1,0 – 6,0) mit anpassbarem Notenschlüssel und Gewichtung
- Umschaltbar zwischen ganzen Noten und Teilnoten (Tendenznoten mit .0/.3/.7)
- Boxplot-Diagramm mit korrekter Quartilberechnung
- Didaktische Hinweise: Decken-/Bodeneffekt, hohe Streuung, Ratewahrscheinlichkeit, Binnendifferenzierung
- Statistiken pro Frage: Lösungsquote, 95%-Konfidenzintervall, Standardabweichung, Antwortverteilung
- Export als PDF (pro Person oder Gesamtübersicht), Excel und iDoceo-CSV

#### Lernfortschritt
- Ergebnisse pro Person über mehrere Tests hinweg
- Trend-Visualisierung, Durchschnitt, Median, bester/schwächster Test
- PDF-Gesamtübersicht pro Person

#### Fragen & Fragesets
- Ordnerstruktur für Fragen und Fragesets
- LaTeX-Unterstützung für mathematische Formeln ($\frac{1}{2}$, $\sqrt{x}$, etc.)
- Bilder in Fragen und Antworten (hochladbar)
- 2, 3 oder 4 Antwortmöglichkeiten pro Frage, Mehrfachauswahl möglich
- Fragen per Drag & Drop sortieren
- Zufällige Fragen- und Antwortreihenfolge (pro Session mischbar)
- Import/Export als JSON oder Excel — Beispiel-JSON und Excel-Vorlage direkt im Fragen-Bereich herunterladbar (Info-Symbol neben den Import-Buttons zeigt den JSON-Aufbau)

#### Scanner
- ArUco-Markererkennung (OpenCV, DICT_6X6_50) über die Handykamera
- Debug-Overlay zeigt erkannte Marker mit Namen und Antwort
- Mehrfach-Bestätigung vor Speicherung (reduziert Scanfehler)
- Grüne Blitz-Animation für neu gescannte Personen
- Fernsteuerung: Aufdecken, nächste Frage und Testende direkt vom Scanner-Handy aus auslösen
- Kamera wird erst nach Beitritt zur Session aktiviert

#### Marktplatz
- Eigene Fragesets veröffentlichen (aktueller Stand als Kopie, keine Live-Verknüpfung)
- Fremde Quiz suchen, per 1–5 Sternen bewerten und mit einem Klick übernehmen
- Vorschau der Fragen inkl. Lösungen vor dem Übernehmen
- Sortierung nach Neu oder Top bewertet

#### Konten & Sicherheit
- Registrierung mit Pflicht zur E-Mail-Bestätigung; unbestätigte Konten werden nach 14 Tagen automatisch gelöscht
- Passwort-Reset per E-Mail-Link (einmalig verwendbar, 1 Stunde gültig)
- E-Mail-Adresse änderbar, wird aber erst nach Bestätigung an der neuen Adresse aktiv
- Passwörter mit PBKDF2 (SHA-256, 100.000 Iterationen) gehasht und gesalzen
- Rate-Limits gegen Brute-Force, Spam und Überlastung (Login, Registrierung, Marktplatz, Importe, WebSockets)
- Jede Lehrkraft sieht ausschließlich eigene Klassen, Fragen und Sessions

#### Weitere Features
- **Vollbild-Modus** — für die Projektion im Klassenzimmer
- **Dark Mode** — helles und dunkles Design
- **Responsives Design** — Desktop und Mobil (Burger-Menü, angepasste Darstellung)
- **PWA** — als App auf dem Handy installierbar, Offline-Cache für Fragen
- **Mehrbenutzerfähig** — Lehrkräfte sehen nur eigene Klassen, Fragen und Sessions
- **Kein Tracking** — keine Cookies, keine externen Analysedienste
- **Admin-Bereich** — Versionsprüfung gegen GitHub, Kontenverwaltung

### Installation

#### Voraussetzungen

- [Docker](https://docs.docker.com/get-docker/) und [Docker Compose](https://docs.docker.com/compose/install/)
- Mindestens 1 GB RAM

#### 1. Repository klonen

```bash
git clone https://github.com/norbert-me/CardVote.git
cd CardVote
```

#### 2. Umgebungsvariablen setzen

```bash
cp .env.example .env
```

`.env` bearbeiten und ein sicheres `TOKEN_SECRET` setzen:

```bash
# Sicheren Schlüssel generieren:
openssl rand -hex 32
```

#### 3. Impressum konfigurieren

In Deutschland ist ein Impressum auf öffentlich erreichbaren Webseiten Pflicht.

```bash
cp frontend/public/legal-config.example.json frontend/public/legal-config.json
```

`legal-config.json` mit den eigenen Kontaktdaten befüllen. Diese Datei wird nicht ins Repository eingecheckt.

#### 4. Starten

```bash
docker compose up -d
```

Beim ersten Start wird die Datenbank automatisch erstellt.

#### 5. Registrieren

Die App läuft unter **http://localhost:3001**. Beim ersten Besuch ein Konto registrieren — die erste registrierte Person ist automatisch Admin.

#### 6. Klasse anlegen und Karten drucken

Unter **Klassen → Neue Klasse** Namen eintragen und Kartennummern zuweisen. Anschließend über das PDF-Icon die Karten herunterladen und ausdrucken. Jede Karte wird gefaltet und hat vier Seiten (A, B, C, D).

### Konfiguration

| Variable | Beschreibung | Standard |
|----------|-------------|----------|
| `TOKEN_SECRET` | JWT-Signaturschlüssel (unbedingt ändern!) | `change-me-before-production` |
| `CORS_ORIGINS` | Erlaubte Origins, kommagetrennt | `http://localhost:3001` |
| `ADMIN_EMAIL` | E-Mail für den automatischen Admin-Account | – |
| `ADMIN_PASSWORD` | Passwort für den Admin-Account | – |
| `SITE_URL` | Öffentliche Basis-URL (für Links in E-Mails) | – |
| `SMTP_HOST` | SMTP-Server für E-Mail-Versand (Bestätigung, Passwort-Reset) | – |
| `SMTP_PORT` | SMTP-Port (465 = implizites TLS, 587 = STARTTLS) | `465` |
| `SMTP_USER` | SMTP-Benutzername | – |
| `SMTP_PASSWORD` | SMTP-Passwort bzw. API-Token | – |
| `SMTP_FROM` | Absenderadresse für System-E-Mails | – |
| `POSTGRES_USER` | Datenbank-Konto | `cardvote` |
| `POSTGRES_PASSWORD` | Datenbank-Passwort | `cardvote` |

Ohne `SMTP_HOST`/`SMTP_FROM` läuft die App normal weiter, es werden dann aber keine E-Mails versendet (Registrierungsbestätigung und Passwort-Reset funktionieren dann nicht).

<details>
<summary>Entwicklung (ohne Docker)</summary>

**Backend:**
```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
DATABASE_URL="postgresql+asyncpg://cardvote:cardvote@localhost:5432/cardvote" \
TOKEN_SECRET="dev-secret" \
uvicorn app.main:app --reload --port 8000
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev
```

Der Vite-Dev-Server läuft auf Port 5173 und leitet `/api`-Anfragen an das Backend weiter.

</details>

### Technik

| Schicht | Technologie |
|---------|-------------|
| Frontend | React + Vite, statisch via Nginx |
| Backend | Python, FastAPI, async SQLAlchemy, WebSockets |
| Datenbank | PostgreSQL 16 |
| Scanner | OpenCV (ArUco DICT_6X6_50) |
| Deploy | Docker Compose (3 Container: Frontend, Backend, DB) |

### Kontakt

Fragen, Fehler oder Vorschläge? Am liebsten über [GitHub Issues](https://github.com/norbert-me/CardVote/issues).

Für Datenschutz- und Impressumsanfragen einer konkreten CardVote-Instanz sind die Kontaktdaten
in der App unter **Impressum & Datenschutz** hinterlegt (betreiberspezifisch, siehe `legal-config.json`).

### Lizenz

[CC BY-NC 4.0](LICENSE) — Nutzung, Bearbeitung und Weitergabe erlaubt, jedoch nicht für kommerzielle Zwecke.

</details>

---

<a id="english"></a>

<details>
<summary><h2>🇬🇧 English</h2></summary>

A self-hosted classroom voting tool — no student devices needed. Students hold up printed cards, the teacher scans them with a phone camera, and results appear in real time.

No subscription, no cloud, no student data with third parties. Runs on your own server.


### How it works

1. **Create a class** — Enter student names and assign card numbers.
2. **Print cards** — Each student gets a card with four sides (A, B, C, D), identified by a unique ArUco marker.
3. **Create questions** — Organize questions in folders and question sets. Supports images and math formulas (LaTeX).
4. **Start a session** — Choose a class and question set, project questions on the screen.
5. **Scan** — Open the scanner on your phone, enter the session code, capture student cards. Results appear live.
6. **Evaluate** — Review results as grades, box plots, and charts. Export as PDF or Excel.

### Features

#### Live voting
- Questions displayed on the projector, students hold up their cards
- Teacher scans with phone — results appear in real time via WebSocket
- Individual answers can optionally be shown when revealing results
- Configurable timer per question (15s – 2min)

#### Game mode
- Points, streaks, and leaderboard — gamified learning without grading
- Speed bonus for fast answers
- Podium view at the end with top 3

#### Evaluation & grading
- Grade distribution (German 1.0–6.0 scale) with adjustable grading scheme and weighting
- Toggle between whole grades and partial/tendency grades (.0/.3/.7 steps)
- Box plot with correct quartile calculation
- Didactic suggestions: ceiling/floor effects, high variance, guessing probability, differentiation
- Per-question statistics: success rate, 95% confidence interval, standard deviation, answer distribution
- Export as PDF (per student or overview), Excel, and iDoceo CSV

#### Student progress
- Results per student across multiple tests
- Trend visualization, average, median, best/worst test
- PDF overview per student

#### Questions & question sets
- Folder structure for questions and sets
- LaTeX support for math formulas
- Images in questions and answers
- 2, 3, or 4 answer choices per question, multiple correct answers possible
- Drag & drop reordering with live preview
- Randomize question and answer order per session
- Import/export as JSON or Excel — example JSON and Excel template downloadable right in the Questions area (info icon next to the import buttons shows the JSON structure)

#### Scanner
- ArUco marker detection (OpenCV, DICT_6X6_50) via phone camera
- Debug overlay shows detected markers with names and answers
- Multi-frame confirmation before saving (reduces scan errors)
- Green flash animation for newly scanned students
- Remote control: trigger reveal, next question, and finishing the test from the scanner phone
- Camera only activates after joining a session

#### Marketplace
- Publish your own question sets (current state as a copy, no live link)
- Search others' quizzes, rate them 1–5 stars, and adopt them with one click
- Preview questions incl. correct answers before adopting
- Sort by newest or top-rated

#### Accounts & security
- Registration requires email confirmation; unconfirmed accounts are auto-deleted after 14 days
- Password reset via email link (single-use, valid for 1 hour)
- Email address can be changed but only takes effect after confirming the new address
- Passwords hashed and salted with PBKDF2 (SHA-256, 100,000 iterations)
- Rate limits against brute-force, spam, and overload (login, registration, marketplace, imports, WebSockets)
- Each teacher only sees their own classes, questions, and sessions

#### More
- **Fullscreen mode** — for classroom projection
- **Dark mode** — light and dark theme
- **Responsive design** — desktop and mobile (burger menu)
- **PWA** — installable on phones, offline cache for questions
- **Multi-user** — teachers only see their own classes, questions, and sessions
- **No tracking** — no cookies, no external analytics
- **Admin panel** — version check against GitHub, account management

### Installation

#### Requirements

- [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/install/)
- At least 1 GB RAM

#### 1. Clone the repository

```bash
git clone https://github.com/norbert-me/CardVote.git
cd CardVote
```

#### 2. Set environment variables

```bash
cp .env.example .env
```

Edit `.env` and set a secure `TOKEN_SECRET`:

```bash
# Generate a secure key:
openssl rand -hex 32
```

#### 3. Configure legal notice (optional)

Required by law in Germany for publicly accessible websites.

```bash
cp frontend/public/legal-config.example.json frontend/public/legal-config.json
```

Fill in your contact details. This file is not checked into the repository.

#### 4. Start

```bash
docker compose up -d
```

The database is created automatically on first start.

#### 5. Register

The app runs at **http://localhost:3001**. Register an account on first visit — the first registered user becomes admin automatically.

#### 6. Create a class and print cards

Go to **Classes → New Class**, enter names and assign card numbers. Then download the cards as PDF and print them. Each card is folded into four sides (A, B, C, D).

### Configuration

| Variable | Description | Default |
|----------|------------|---------|
| `TOKEN_SECRET` | JWT signing key (must change!) | `change-me-before-production` |
| `CORS_ORIGINS` | Allowed origins, comma-separated | `http://localhost:3001` |
| `ADMIN_EMAIL` | Email for auto-created admin account | – |
| `ADMIN_PASSWORD` | Password for admin account | – |
| `SITE_URL` | Public base URL (used in email links) | – |
| `SMTP_HOST` | SMTP server for sending email (verification, password reset) | – |
| `SMTP_PORT` | SMTP port (465 = implicit TLS, 587 = STARTTLS) | `465` |
| `SMTP_USER` | SMTP username | – |
| `SMTP_PASSWORD` | SMTP password / API token | – |
| `SMTP_FROM` | Sender address for system emails | – |
| `POSTGRES_USER` | Database user | `cardvote` |
| `POSTGRES_PASSWORD` | Database password | `cardvote` |

Without `SMTP_HOST`/`SMTP_FROM` the app runs normally but won't send emails (registration confirmation and password reset won't work).

### Tech stack

| Layer | Technology |
|-------|-----------|
| Frontend | React + Vite, served as static build via Nginx |
| Backend | Python, FastAPI, async SQLAlchemy, WebSockets |
| Database | PostgreSQL 16 |
| Scanner | OpenCV (ArUco DICT_6X6_50) |
| Deploy | Docker Compose (3 containers: frontend, backend, DB) |

### Contact

Questions, bugs, or suggestions? Preferably via [GitHub Issues](https://github.com/norbert-me/CardVote/issues).

For privacy or legal-notice inquiries about a specific CardVote instance, see the contact details
under **Impressum & Datenschutz** in the app (operator-specific, see `legal-config.json`).

### License

[CC BY-NC 4.0](LICENSE) — Free to use, modify, and share for non-commercial purposes.

</details>
