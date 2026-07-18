# Nuvora

[Deutsch](README.md) · **English**

A toolkit **for teachers**. Self-hosted, no cloud, no student data with third parties.

Source: [github.com/norbert-me/Nuvora](https://github.com/norbert-me/Nuvora)

Open source and non-commercial ([CC BY-NC 4.0](LICENSE)) — the source is open, commercial use is excluded. This is deliberately *not* an OSI open-source license.

Learners need no devices and no accounts — they only appear as records the teacher manages.

Nuvora is the base: account, classes and students live here. Modules are switched on and work on this data — they do not own it.

> **Status: in progress.** The frame stands: sign-in, home page, module management, classes and topics are Nuvora. All three modules sit on the core — none has its own accounts or its own database.

## Modules

### CardVote — `apps/web` + `apps/api`

Classroom voting entirely without student devices. Learners hold up printed cards, the teacher scans them with the phone camera, results appear live.

- **Live voting** — questions on the beamer, real-time results via WebSocket, per-question timer
- **Game mode** — points, streaks, leaderboard, podium
- **Evaluation** — grade distribution with an adjustable scale, box plots, 95% confidence intervals, didactic hints (ceiling/floor effect, spread, guessing probability)
- **Export** — PDF, Excel, iDoceo CSV
- **Questions** — folders and question sets, LaTeX formulas, images, import/export as JSON or Excel
- **Scanner** — ArUco detection (OpenCV, `DICT_6X6_50`) via the phone camera, remote control of the session
- **Marketplace** — publish your own question sets, rate and adopt others'
- **Also** — full screen for projection, dark mode, PWA, no tracking

FastAPI · Postgres · React · OpenCV (ArUco)

### Lernpfad (learning paths) — `apps/lernpfad`

Management of maths exercises and learning paths. A learning path consists of several "Lernleitern" (ladders); the generator distributes exercises to learners in a differentiated way.

Runs embedded under Nuvora's navbar — the proven interface stayed, only the foundation was swapped out.

Express (static only) · Vanilla JS

### Noten (grades)

Gradebook: columns from your assessment scheme with weights, grades and observations per person. Works like an empty spreadsheet.

Computes the weighted average of your grades and shows how much of the scheme is covered — the report-card grade stays your decision. Observations never count toward the average.

React · Postgres

> CardVote was developed standalone up to v1.4.4 ([archive](https://github.com/norbert-me/CardVote)). Further development happens only here.

## Architecture

Nuvora is the base, modules are guests. Three rules every change keeps:

1. **No module owns classes or students** — they live in the core, all modules share them.
2. **No module has its own accounts** — the core authenticates, modules inherit.
3. **Modules don't depend on each other** — CardVote runs without Lernpfad and without Noten. What connects them (shared topics, result import) is an add-on, never a prerequisite.

```
Nuvora core (apps/api, apps/web)
├── accounts · classes · students · topics      belong to the core
├── module registry                             who has activated what
└── modules
    ├── CardVote   /cardvote/*   voting, evaluation, marketplace
    ├── Lernpfad   /lernpfad     exercises & learning paths (embedded)
    └── Noten      /noten        gradebook
```

| Part        | Stack                                        |
| ----------- | -------------------------------------------- |
| Core API    | FastAPI · SQLAlchemy 2 (async) · Postgres 16 |
| Frontend    | React 18 · Vite · react-router               |
| Lernpfad    | Express (static only) · Vanilla JS           |
| Proxy       | nginx — one domain, all parts                |

An account sees only its own data (`owner_id` everywhere); modules are switched on per teacher.

## Security & privacy

- **Self-hosted, no cloud.** Student data never leaves your own server.
- **Learners have no accounts** and never log in — they are records the teacher manages.
- **Especially sensitive data** (support needs, notes — GDPR Art. 9) appear in **no export** and in no marketplace publication.
- **Passwords** hashed and salted with PBKDF2 (SHA-256, 100,000 iterations); email confirmation required, reset via one-time link.
- **Security headers** set centrally at the proxy (CSP, `X-Frame-Options: SAMEORIGIN`, `nosniff`, Referrer-Policy); `server_tokens off`.
- **Rate limits** against brute force and mass creation on all writing endpoints.
- **Secrets** live only on the server (`.env`, `chmod 600`) and are never committed; `POSTGRES_PASSWORD` and `TOKEN_SECRET` are required or the stack won't start.

## Goal of bundling

1. Create classes and students once, use them in both modules.
2. Test results from CardVote steer Lernpfad: weak topics generate matching exercises.
3. One login, one domain.

## Running

Nuvora runs as a single deployment behind a proxy:

```bash
cp .env.example .env     # POSTGRES_PASSWORD and TOKEN_SECRET are required
docker compose up -d --build
```

Then on <http://localhost:8080>:

| Path         | What                                  |
| ------------ | ------------------------------------- |
| `/`          | Nuvora — home, modules, classes       |
| `/cardvote/` | CardVote module                       |
| `/lernpfad/` | Lernpfad module                       |
| `/noten`     | Noten module                          |

Without `POSTGRES_PASSWORD` and `TOKEN_SECRET` the stack deliberately won't start — default passwords must not accidentally end up in production. Generate a random value with `openssl rand -hex 32`.

## Deploy

```bash
cp .deploy.env.example .deploy.env   # enter server and target path
./deploy.sh                          # everything
./deploy.sh api                      # rebuild a single service
./deploy.sh --port 8090              # different port, remembered in .deploy.env
```

Uploads, builds on the server, checks core and modules, and aborts if something doesn't respond.

Services: `api` (core), `web` (shell + module pages), `lernpfad`, `db`, `proxy`.

On the first run the script creates the `.env` on the server and generates `TOKEN_SECRET` and `POSTGRES_PASSWORD` as random values (`chmod 600`) — nobody has to read or type them. Afterwards the server's `.env` is **never** overwritten; secrets stay there.

Add later for mail sending and an admin account (`SMTP_*`, `ADMIN_EMAIL`):

```bash
ssh <server>
cd <path> && nano .env
```

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

## License

[CC BY-NC 4.0](LICENSE) — attribution, non-commercial.
