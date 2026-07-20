# Nuvora

[Deutsch](README.md) · **English**

A toolkit **for teachers**. Self-hosted, no cloud, no student data with third parties.

Source: [github.com/norbert-me/Nuvora](https://github.com/norbert-me/Nuvora)

Open source and non-commercial ([CC BY-NC 4.0](LICENSE)) — the source is open, commercial use is excluded. This is deliberately *not* an OSI open-source license.

Learners need no devices and no accounts — they only appear as records the teacher manages.

Nuvora is the base: account, classes, courses, students and topics live here. Modules are switched on and work on this data — they do not own it.

> **Status: 2.0 — stable, still growing.** The frame stands — sign-in, home page, module management, classes, courses and topics are Nuvora. Nine modules sit on the core; none has its own accounts or database. The shared **topic taxonomy** connects them: a topic students struggled with in CardVote or Code-Detektiv spawns a Karten practice deck or a Lernpfad revision task at the press of a button, test results become a grade column, and the topic view shows everything attached to a topic across the modules — including stored material.

## Core

- **Classes** = the group of students (the people). **Courses** = the subject; one class can belong to several courses (n:m). Module content hangs off the course, the students are shared.
- **Topics** in three levels (subject → topic → subtopic) — the shared taxonomy every module points to.
- **Material** per topic and per calendar period: store worksheets, PDFs etc. (in the account, private, not shared).
- **Module registry** in code: a module exists only if there is code for it; the database only remembers who activated what.

## Modules

### CardVote — `apps/web` + `apps/api`

Classroom voting entirely without student devices. Learners hold up printed cards, the teacher scans them with the phone camera, results appear live.

- **Live voting** — questions on the beamer, real-time results via WebSocket, per-question timer
- **Game mode** — points, streaks, leaderboard, podium
- **Evaluation** — grade distribution with an adjustable scale, box plots, 95% confidence intervals, didactic hints (ceiling/floor effect, spread, guessing probability)
- **Result → grade** — take the hit rate as a grade column (with a link back to the evaluation)
- **Export** — PDF, Excel, iDoceo CSV
- **Questions** — folders and question sets, LaTeX formulas, images, import/export as JSON or Excel
- **Scanner** — ArUco detection (OpenCV, `DICT_6X6_50`) via the phone camera, remote control of the session
- **Marketplace** — publish your own question sets, rate and adopt others'

FastAPI · Postgres · React · OpenCV (ArUco)

### Lernpfad (learning paths)

Management of exercises and learning paths. A learning path consists of several **Lernleitern** (ladders); the generator distributes exercises to learners in a differentiated way.

The proven interface stayed — it is **built into the web project** (`apps/web/public/lp/`) and **mounted natively into the shell** (no iframe, no rebuild, no separate container): its HTML is injected into a host, its CSS scoped, and the app runs in the same window on Nuvora's API. Ladders can be shared via the marketplace (the exercise pool, without any student reference).

Vanilla JS, mounted in-page

### Noten (grades)

Gradebook: columns from your assessment scheme with weights, grades and observations per person. Works like an empty spreadsheet.

Computes the weighted average and shows how much of the scheme is covered — the report-card grade stays your decision, observations never count. A **per-student trend** (▲/▼) shows whether performance rises or falls over the term. Importable as a grade column: **CardVote** hit rate, **Karten** mastery and **Code-Detektiv** sessions (each via your grade scale).

### Karten (cards)

Flashcards with spaced repetition (SM-2). A deck belongs to a course; learners practise **without an account** via a QR code (a secret token per person), and the teacher sees their maturity progress. Optionally bound to a topic — then the calendar releases the deck automatically on the planned day. Mastery can be taken over as a grade column.

### Kalender (calendar)

Lesson planning: day, week and month views plus a recurring **timetable** (class per period, colours, times). A CardVote quiz, a Karten deck or a learning ladder can be planned onto an entry; **days off** (holidays) hide lessons. **Calendar sync** both ways: your own ICS feed to subscribe to (Apple/Google) and an external calendar shown read-only (SSRF-hardened).

### Einstiege (lesson starters)

Ideas for opening a lesson — the idea, the procedure with materials, a materials list and an approximate duration. Reusable, assignable to calendar periods and topic-tagged: for a weak topic the home page suggests a matching starter.

### Code-Detektiv

Programming puzzles for computer-science lessons: drag & drop code blocks into the right order, alone or in a class session (public join by code, no login). Native in the shell (React). Topic-tagged puzzles feed into the weak topics.

### Orga

Class-management tools, in tabs:

- **Checklists** — collective ticks (e.g. "seen the signature on the test")
- **Attendance** — status per day, per-person overview, PDF report
- **Lending** — lend out items, keep returns and overdue in view
- **Seating plan** — place and rotate tables freely; optional **SEGEL levels** (Helios concept Harbour → Coast → Sea → World) per student on the seat, for a quick glance during the lesson

### Zufallsschüler (random student)

Draws a random person from a class at the press of a button — fairly weighted by the time since the last draw, never twice in a row.

> CardVote was developed standalone up to v1.4.4 ([archive](https://github.com/norbert-me/CardVote)). Further development happens only here. The marketplace now also shares Karten decks, lesson starters and learning ladders.

## Architecture

Nuvora is the base, modules are guests. Three rules every change keeps:

1. **No module owns classes or students** — they live in the core, all modules share them.
2. **No module has its own accounts** — the core authenticates, modules inherit.
3. **Modules don't depend on each other** — CardVote runs without Lernpfad and without Noten. What connects them (shared topics, result import) is an add-on, never a prerequisite.

```
Nuvora core (apps/api, apps/web)
├── accounts · classes · courses · students · topics · material   belong to the core
├── module registry                                               who has activated what
└── modules
    ├── CardVote      /cardvote/*     voting, evaluation, marketplace
    ├── Lernpfad      /lernpfad       exercises & ladders (native in-page)
    ├── Noten         /noten          gradebook, trend, result import
    ├── Karten        /karten         flashcards, spaced repetition
    ├── Kalender      /kalender        planning, timetable, ICS sync
    ├── Einstiege     /methoden       lesson starters (topic-tagged)
    ├── Code-Detektiv /code-detektiv  programming puzzles (native)
    ├── Orga          /orga           checklists · attendance · lending · seating plan
    └── Zufallsschüler /zufall        draw a random student
```

What connects them is an add-on, never a prerequisite: the shared **topic taxonomy** carries the bridges.

- weak CardVote/Code-Detektiv topic → Karten deck or Lernpfad task (also cross-subject, with class choice)
- CardVote, Karten and Code-Detektiv results → grade column
- weak topic → matching lesson starter suggested
- ladders shareable via the marketplace
- calendar plans quiz/deck/ladder and releases decks on the day
- topic view shows everything attached to a topic across active modules, including material

| Part        | Stack                                        |
| ----------- | -------------------------------------------- |
| Core API    | FastAPI · SQLAlchemy 2 (async) · Postgres 16 |
| Frontend    | React 18 · Vite · react-router · i18n (de/en/es) |
| Lernpfad    | Vanilla JS, mounted natively into the shell  |
| Proxy       | nginx — one domain, all parts                |

An account sees only its own data (`owner_id` everywhere); modules are switched on per teacher.

## Security & privacy

- **Self-hosted, no cloud.** Student data never leaves your own server.
- **Learners have no accounts** and never log in — they are records the teacher manages.
- **Especially sensitive data** (support needs, notes — GDPR Art. 9) appear in **no export** and in no marketplace publication.
- **Passwords** hashed and salted with PBKDF2 (SHA-256, 100,000 iterations); email confirmation required, reset via one-time link.
- **External calendar fetch is SSRF-hardened** (private/local IPs and redirects blocked).
- **Security headers** set centrally at the proxy (CSP, `X-Frame-Options: SAMEORIGIN`, `nosniff`, Referrer-Policy); `server_tokens off`.
- **Rate limits** against brute force and mass creation on all writing endpoints.
- **Secrets** live only on the server (`.env`, `chmod 600`) and are never committed; `POSTGRES_PASSWORD` and `TOKEN_SECRET` are required or the stack won't start.

## Goal of bundling

1. Create classes, courses and students once, use them in all modules.
2. Test results steer Lernpfad: weak topics generate matching exercises.
3. One login, one domain.

## Running

Nuvora runs as a single deployment behind a proxy:

```bash
cp .env.example .env     # POSTGRES_PASSWORD and TOKEN_SECRET are required
docker compose up -d --build
```

Then on <http://localhost:8080>:

| Path         | What                                              |
| ------------ | ------------------------------------------------- |
| `/`          | Nuvora — home, modules, classes, courses, topics  |
| `/cardvote/` | CardVote module                                   |
| `/lernpfad`  | Lernpfad module                                   |
| `/noten`     | Noten module                                      |
| others       | `/karten` · `/kalender` · `/methoden` · `/code-detektiv` · `/orga` · `/zufall` |

Without `POSTGRES_PASSWORD` and `TOKEN_SECRET` the stack deliberately won't start — default passwords must not accidentally end up in production. Generate a random value with `openssl rand -hex 32`.

## Deploy

```bash
cp .deploy.env.example .deploy.env   # enter server and target path
./deploy.sh                          # everything
./deploy.sh api                      # rebuild a single service
./deploy.sh --port 8090              # different port, remembered in .deploy.env
```

Uploads, builds on the server, checks core and modules, and aborts if something doesn't respond.

Services: `api` (core), `web` (shell + module pages incl. Lernpfad static), `db`, `proxy`. There is no separate Lernpfad container anymore.

On the first run the script creates the `.env` on the server and generates `TOKEN_SECRET` and `POSTGRES_PASSWORD` as random values (`chmod 600`) — nobody has to read or type them. Afterwards the server's `.env` is **never** overwritten; secrets stay there.

Add later for mail sending and an admin account (`SMTP_*`, `ADMIN_EMAIL`):

```bash
ssh <server>
cd <path> && nano .env
```

`ADMIN_EMAIL` should be a **real, receiving** mailbox — contact messages go there. A pure sender (`SMTP_FROM`) without an inbox receives nothing. The admin profile shows a setup checklist including deliverability.

## Configuration

Everything is configured in **one** place, at the repo root. The modules have no own `.env` files, no own compose and no own deploy anymore.

```bash
cp .env.example             .env          # secrets, ports, SMTP
cp .deploy.env.example      .deploy.env   # target server
cp config/site.example.json config/site.json  # legal notice / operator data
```

| File               | Contents                                      | In repo? |
| ------------------ | --------------------------------------------- | -------- |
| `.env`             | passwords, `TOKEN_SECRET`, SMTP               | no       |
| `.deploy.env`      | server address, target path                   | no       |
| `config/site.json` | operator, address, contact (legal notice)     | no       |

`config/site.json` is the single source of operator data: Lernpfad reads it server-side, the legal notice in the shell fetches it via `/site.json` from the proxy.

**Postgres creates the role and database only on the first start.** A `POSTGRES_PASSWORD` changed later does not reach an existing database — then it's an `ALTER ROLE`, not an `.env` edit. `deploy.sh` checks this up front and says what to do.

Databases, backups and uploads contain personal data and are excluded from Git by default.

## Schema & migrations

No Alembic. The schema is built at startup from `Base.metadata.create_all` plus additive columns/indexes in `_ensure_columns` (idempotent). New tables appear by themselves; new columns go into the `wanted` list.

## License

[CC BY-NC 4.0](LICENSE) — attribution, non-commercial.
