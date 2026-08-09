# Nuvora

[Deutsch](README.md) · **English**

A toolkit **for teachers**. Self-hosted, no cloud, no student data with third parties.

Source: [github.com/norbert-me/Nuvora](https://github.com/norbert-me/Nuvora)

Open source and non-commercial ([CC BY-NC 4.0](LICENSE)) — the source is open, commercial use is excluded. This is deliberately *not* an OSI open-source license.

> **Built 100 % with AI.** Code, design and copy were developed entirely with an AI assistant (Claude) — a demonstration of how far AI-assisted software development reaches today.

Learners need no devices and no accounts — they only appear as records the teacher manages.

Nuvora is the base: account, classes, courses, students and topics live here. Modules are switched on and work on this data — they do not own it.

> **Status: stable, still growing.** The frame stands — sign-in, home page, module management, classes, courses and topics are Nuvora. Fourteen modules sit on the core; none has its own accounts or database. Related tools are bundled under one module with **tabs** (e.g. Auswertung = gradebook + class tests, Notizbrett = notes + to-do, Orga = checklists + attendance + lending + seating plan). The shared **topic taxonomy** connects them: a topic students struggled with in CardVote or Code-Detektiv spawns a Karten practice deck or a Lernpfad revision task at the press of a button, test results become a grade column, and the topic view shows everything attached to a topic across the modules — including stored material.

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

### Auswertung — gradebook + class tests

Assessment in one place, in two tabs.

**Gradebook** — columns from your assessment scheme with weights; works like an empty spreadsheet. Computes the weighted average and shows how much of the scheme is covered — the report-card grade stays your decision, observations never count. A **per-student trend** (▲/▼) shows whether performance rises or falls over the term. Importable as a grade column: **CardVote** hit rate, **Karten** mastery and **Code-Detektiv** sessions (each via your grade scale).

**Class tests** — create tasks with a topic and tick right/wrong (or partial points) per student. The evaluation shows points, a grade distribution with an adjustable key, boxplots and per-task discrimination — and **who needs to catch up on which topic**. From there you can trigger targeted revision (Karten deck / Lernpfad). Absent students are excluded from the stats without losing their grades.

### Karten (cards)

Flashcards with spaced repetition (SM-2). A deck belongs to a course; learners practise **without an account** via a QR code (a secret token per person), and the teacher sees their maturity progress. Optionally bound to a topic — then the calendar releases the deck automatically on the planned day. Mastery can be taken over as a grade column.

### Kalender (calendar)

Lesson planning: day, week and month views plus a recurring **timetable** (class per period, colours, times). A CardVote quiz, a Karten deck or a learning ladder can be planned onto an entry; **days off** (holidays) hide lessons. **Calendar sync** both ways: your own ICS feed to subscribe to (Apple/Google) and an external calendar shown read-only (SSRF-hardened).

### Unterrichtsplanung — lesson starters

**Lesson starters** — ideas for opening a lesson: the idea, the procedure with materials, a materials list and an approximate duration. Reusable, assignable to calendar periods and topic-tagged: for a weak topic the home page suggests a matching starter.

### Code-Detektiv

Programming puzzles for computer-science lessons: drag & drop code blocks into the right order, alone or in a class session (public join by code, no login). Native in the shell (React). Topic-tagged puzzles feed into the weak topics.

### Orga

Class-management tools, in tabs:

- **Checklists** — collective ticks (e.g. "seen the signature on the test")
- **Attendance** — status per day, per-person overview, PDF report
- **Lending** — lend out items, keep returns and overdue in view
- **Seating plan** — place and rotate tables freely; optional **SEGEL levels** (Helios concept Harbour → Coast → Sea → World) per student on the seat, for a quick glance during the lesson

### Zufallsschüler (random student)

Draws a random person from a class at the press of a button — fairly weighted by the time since the last draw, never twice in a row. Optionally restricted to E/G level; also a random-groups generator.

### Notizbrett (notice board)

Two tabs: **Notes** (free jottings, sortable) and **Tasks** (a to-do list). Dated tasks also appear in the calendar. Not tied to students.

### Klassenleitung (class leadership)

Class-leadership duties — currently the **parent contacts** per student: date, channel (phone/mail/meeting) and note. Meets the documentation duty without paper.

### Beobachtungen (observations)

Formative notes per student with a date (effort, social behaviour, progress) — **deliberately separate from the grade**. What the gradebook does not measure has its place here.

### Tafel (board)

Freely placeable text fields and a countdown timer for the projector. Move, resize and colour fields; fullscreen. A pure tool, no data.

### Mathespiele (math games)

A collection of math games. Currently **math football**: a mental-arithmetic duel for two teams on the projector — a correct answer pushes the ball towards the opponent's goal. Number range and operations configurable.

> CardVote was developed standalone up to v1.4.4 ([archive](https://github.com/norbert-me/CardVote)). Further development happens only here. The marketplace now also shares Karten decks, lesson starters and learning ladders.

### Desktop app (macOS, optional)

`apps/desktop` — a thin Electron shell around the same web interface: its own window, dock icon, no browser chrome. **No own server, no own database**; the app points at your Nuvora server. Reading offline works via Nuvora's service worker, writing offline does not yet. Details in `apps/desktop/README.md`.

## Architecture

Nuvora is the base, modules are guests. Three rules every change keeps:

1. **No module owns classes or students** — they live in the core, all modules share them.
2. **No module has its own accounts** — the core authenticates, modules inherit.
3. **Modules don't depend on each other** — CardVote runs without Lernpfad and without Auswertung. What connects them (shared topics, result import) is an add-on, never a prerequisite.

```
Nuvora core (apps/api, apps/web)
├── accounts · classes · courses · students · topics · material   belong to the core
├── module registry                                               who has activated what
└── modules
    ├── CardVote           /cardvote/*         voting, evaluation, marketplace
    ├── Lernpfad           /lernpfad           exercises & ladders (native in-page)
    ├── Karten             /karten             flashcards, spaced repetition
    ├── Kalender           /kalender           planning, timetable, ICS sync
    ├── Auswertung         /auswertung         gradebook + class tests
    ├── Unterrichtsplanung /unterrichtsplanung lesson starters
    ├── Code-Detektiv      /code-detektiv      programming puzzles (native)
    ├── Orga               /orga               checklists · attendance · lending · seating plan
    ├── Zufallsschüler     /zufall             draw a random student / groups
    ├── Notizbrett         /notizbrett         notes + to-do
    ├── Klassenleitung     /klassenleitung     parent contacts
    ├── Beobachtungen      /notizen            formative notes per student
    ├── Tafel              /tafel              projector text fields + timer
    └── Mathespiele        /mathespiele        math games (projector)
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

## Whoever runs it is responsible

Nuvora runs on **your** server. Under the GDPR that makes you the controller for the data in it — not this project. In practice: clear it with your school and its authority, keep a record of processing activities, check your state's rules, and keep backups you can actually restore.

What Nuvora brings along: a full privacy policy and legal notice fed from `config/site.json`, reachable at `/legal` — including from the pages students see without an account. Plus a GDPR Art. 15 export (Profile → export data), self-service account deletion, and automatic retention (trash 30 days, unconfirmed accounts 14 days, game sessions 1 resp. 7 days).

Please do not report vulnerabilities as public issues: [SECURITY.md](SECURITY.md) describes the way, `/.well-known/security.txt` states it machine-readably (RFC 9116).

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

## Releases, channels and support

Two update channels, switchable in the profile: **Stable** only moves on major versions (4.0.0, 5.0.0), **Beta** takes everything in between. That is why many entries on the releases page are marked "Pre-release" — that is the beta line, not a sign of instability. The running version is shown in the profile under "About Nuvora".

The schema builds itself on start (see below); upgrading needs no migration steps, just `./deploy.sh`.

Tags are signed; `git verify-tag v4.0.0` checks that (see [SECURITY.md](SECURITY.md)). Every release carries a dependency SBOM as an asset.

**Support:** Nuvora is a one-person project with no revenue. Bug reports and ideas are welcome and get read, but there is no promised response time, no support contract, and no guarantee a module stays. Factor that in before relying on it — the source is public, the data is yours.

## Running

Nuvora runs as a single deployment behind a proxy:

**Requirements:** Docker with Compose v2, about 2 GB RAM and 5 GB disk, one free port (8080 by default). Everything else ships in the containers — Postgres 16, Python, Node.

```bash
cp .env.example .env
# Without these two the stack deliberately refuses to start:
sed -i '' "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -hex 24)|" .env
sed -i '' "s|^TOKEN_SECRET=.*|TOKEN_SECRET=$(openssl rand -hex 32)|" .env
cp config/site.example.json config/site.json   # legal notice, otherwise empty
docker compose up -d --build
```

Then on <http://localhost:8080>:

| Path         | What                                              |
| ------------ | ------------------------------------------------- |
| `/`          | Nuvora — home, modules, classes, courses, topics  |
| `/cardvote/` | CardVote module                                   |
| `/lernpfad`  | Lernpfad module                                   |
| `/auswertung`| Auswertung module (gradebook + class tests)       |
| others       | `/karten` · `/kalender` · `/unterrichtsplanung` · `/code-detektiv` · `/orga` · `/zufall` · `/notizbrett` · `/klassenleitung` · `/notizen` · `/tafel` · `/mathespiele` |

Without `POSTGRES_PASSWORD` and `TOKEN_SECRET` the stack deliberately won't start — default passwords must not accidentally end up in production. Generate a random value with `openssl rand -hex 32`.

## Deploy

```bash
cp .deploy.env.example .deploy.env   # enter server and target path
./deploy.sh                          # everything
./deploy.sh api                      # rebuild a single service
./deploy.sh --port 8090              # different port, remembered in .deploy.env
./deploy.sh --browser                # self-test also in a real browser
./deploy.sh --kein-selftest          # deploy without the self-test
```

Uploads, builds on the server, checks core and modules, and aborts if something doesn't respond. Then the **self-test** runs (see below) — the exit code turns red if it finds anything.

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
| `.deploy.env`      | server address, target path, self-test access | no       |
| `config/site.json` | operator, address, contact (legal notice)     | no       |

`config/site.json` is the single source of operator data: Lernpfad reads it server-side, the legal notice in the shell fetches it via `/site.json` from the proxy.

**Postgres creates the role and database only on the first start.** A `POSTGRES_PASSWORD` changed later does not reach an existing database — then it's an `ALTER ROLE`, not an `.env` edit. `deploy.sh` checks this up front and says what to do.

Databases, backups and uploads contain personal data and are excluded from Git by default.

## Self-test

After every deploy Nuvora checks itself — `./deploy.sh` calls `./selftest.sh` automatically, and it also runs on its own:

```bash
./selftest.sh              # API, setup, every module
./selftest.sh --browser    # plus the tour in a real browser
./selftest.sh --nur-system # no login, no writing
./selftest.sh --debug      # every request with status and duration
```

A health check only says a container is running. The self-test says whether the installation *works*:

| Area              | What is checked |
| ----------------- | --------------- |
| Reachability      | name resolution, response time, WebSocket handshake (live results), TLS certificate incl. remaining validity, http → https redirect |
| Security          | protection headers on several paths, server banner without version, API docs not public, data routes closed without a token, sensitive files (`.env`, `.git/config` …) serve nothing |
| Web files         | `robots.txt`, favicon, manifest, icons, unknown addresses get the shell, app served compressed and cacheable |
| Setup             | database, **schema against the models** (there is no Alembic — this is where a missing entry in `_ensure_columns` shows up), configuration, operator data, module registry against the mounted routers |
| E-mail            | host, connection, login, sender acceptance (`MAIL FROM`/`RCPT TO`, **without** sending a mail), SPF and DMARC of the sender domain |
| Modules           | one real write round-trip per module on a core class and its students: create, read, update, delete |
| Student paths     | `/lernen/<token>` and `/cd/<code>` without an account — and refusal on a wrong token |
| Tenant separation | reading and writing foreign IDs must fail |
| Data volume       | classes, students, courses, topics compared to the previous run — early warning if a cascade takes too much with it |
| Browser           | every page renders, no console errors, no dead links — on desktop, on a **phone (390 px)** and in **dark mode**; plus real interactions with a reload as proof that it saved |

Test data carries the prefix `ZZ-Selbsttest` and is removed again including the trash; activated modules are reset. You need a dedicated test account (`SELFTEST_EMAIL`/`SELFTEST_PASSWORD` in `.deploy.env`, registered once by hand) — `SELFTEST_TOKEN` is generated by `deploy.sh` on its first run.

The browser part needs Playwright; `selftest.sh --browser` installs it on first use into `scripts/node_modules` (deliberately separate from `apps/web` so it never ends up in the web image).

## Tests

```bash
cd apps/api && pip install -r requirements-dev.txt && pytest
```

Regression tests for the places where a bug silently costs data: E/G scoring, class updates without data loss, trash cascades, tenant separation, course logic. They run together with the web build in CI on every push.

## Changing Python dependencies

Two files, one direction: `apps/api/requirements.txt` is the source with ranges, `apps/api/requirements.lock.txt` is **generated** from it — exact versions plus hashes. The container and CI install from the lock file only (`pip install --require-hashes`), so two builds of the same commit produce the same thing and a tampered upstream package fails on its hash. Editing the lock file by hand works against the next `pip-compile`.

```bash
cd apps/api
pip install pip-tools            # once
# 1. edit requirements.txt (add a package, change a range)
# 2. regenerate the lock — with Python 3.12, same as the container:
pip-compile --allow-unsafe --generate-hashes --strip-extras \
  --output-file=requirements.lock.txt requirements.txt
```

`pip-compile` resolves for the interpreter it runs under, hence Python 3.12. Gotcha: pip-tools 7.6 crashes with pip 26 (`make_requirement_preparer() missing … allow_editables`); if that happens, `pip install "pip<26"` in the same venv. The test tooling (`requirements-dev.txt`) deliberately stays unlocked: it is never shipped, and an unexpected version shows up immediately as a red test run.

## Schema & migrations

No Alembic. The schema is built at startup from `Base.metadata.create_all` plus additive columns/indexes in `_ensure_columns` (idempotent). New tables appear by themselves; new columns go into the `wanted` list.

## License, in practical terms

[CC BY-NC 4.0](LICENSE) — attribution, non-commercial.

- **Allowed:** running it at schools, by teachers, school authorities and public education bodies; sharing and modifying it as long as Nuvora is credited.
- **Not allowed:** selling it, offering paid hosting, using it in commercial training or as part of a paid offering.
- When in doubt, ask — you will get an answer.

Two things said plainly: Creative Commons licences are not designed for software (no patent or warranty clauses), and "non-commercial" is legally fuzzy. That is why the boundary is spelled out above. Nuvora is therefore **not** OSI-approved open source, even though the source is public.

**No warranty.** The software is provided as is — no promise of fitness, availability or correctness, and no liability for data loss. If you run it with student data, keep backups you have actually tested.
