# SeatFlow

An internal office seating management platform. Administrators can see every floor,
assign and move people between desks, release seats, and drive the same operations
with natural-language commands — with every AI-proposed change previewed and
explicitly confirmed before it touches the database.

---

## Contents

- [Feature overview](#feature-overview)
- [Screenshots](#screenshots)
- [Architecture](#architecture)
- [Tech stack](#tech-stack)
- [Database schema](#database-schema)
- [Running it on another machine](#running-it-on-another-machine)
- [Troubleshooting](#troubleshooting)
- [Environment variable reference](#environment-variables)
- [Command reference](#command-reference)
- [Testing](#testing)
- [AI configuration](#ai-configuration)
- [Example AI prompts](#example-ai-prompts)
- [Railway deployment](#railway-deployment)
- [Publishing to GitHub](#publishing-to-github)
- [Security notes](#security-notes)
- [Design decisions](#design-decisions)
- [Known limitations](#known-limitations)

---

## Feature overview

**Dashboard** — headcount, assigned employees, available desks and occupancy rate,
plus a 14-day occupancy trend, seat-status breakdown, department distribution,
per-floor utilisation, and live feeds of recent seating changes and AI actions.

**Seating plan** — an interactive floor map rendered from stored geometry (not
hardcoded): rooms and open-workspace areas sit behind desks positioned on a grid.
Desks show status through colour *and* icon, hovering reveals seat ID, occupant,
department, location and status, and clicking opens a detail panel to assign, move
or release. Building/floor selectors, department and status filters, employee
search, and zoom controls are all wired up. Below `lg`, the map is replaced by a
touch-friendly card grid rather than a squeezed floor plan.

**Employees** — searchable, sortable, paginated directory with department, seat-state
and status filters, plus a detail drawer showing the full profile, current desk and
complete seating history, with assign / move / release actions.

**Seats** — every desk across the estate with floor, zone, status, occupant,
department and last-updated columns; filters for all of those; and row actions to
assign, release, reserve, disable or enable.

**AI assistant** — an enterprise command centre: type a request, the backend
interprets it into a *structured, validated* command, and a confirmation card shows
exactly what will change. Nothing is written until you press **Confirm change**.
Ambiguity ("I found 2 people matching Arjun Mehta") is resolved by picking from a
list. Read-only questions are answered inline without a confirmation step.

**Activity** — a complete audit log of every seating mutation (timestamp, user,
action, employee, previous and new seat, manual vs AI, result) with filters and a
detail dialog, alongside a separate AI action history.

**Throughout** — light/dark themes that respect the OS preference and persist,
responsive layouts from phone to large desktop, skeleton loaders, empty states,
error states with retry, toast notifications, confirmation dialogs for destructive
actions, and keyboard-accessible tables, dialogs and search.

---

## Screenshots

Screenshots are not committed to this repository. To capture the set used in the
submission, run the app locally — see
[Running it on another machine](#running-it-on-another-machine) — and save the images
into `docs/screenshots/` with these names:

| File | What to capture |
| --- | --- |
| `01-dashboard-light.png` | Dashboard, light theme, full width |
| `02-dashboard-dark.png` | Dashboard, dark theme |
| `03-seating-plan.png` | Seating plan with a seat tooltip open |
| `04-seat-detail.png` | Seat detail dialog on an occupied desk |
| `05-employees.png` | Employees table with the detail drawer open |
| `06-ai-confirmation.png` | AI assistant showing a confirmation card |
| `07-audit-log.png` | Activity page, audit log tab |
| `08-mobile.png` | Seating plan at a mobile width |

---

## Architecture

```
Browser (React SPA)
    │  fetch, same-origin, HttpOnly session cookie
    ▼
Express API  ── auth ─▶ JWT verify ─▶ user reloaded from DB per request
    │
    ├── routes/      thin HTTP layer: validation (zod) + response envelope
    ├── services/    all business rules and transactions
    │     ├── seating.service.ts   assign / move / release / status
    │     └── ai/                  provider → resolver → executor
    └── db/          Prisma client
    ▼
PostgreSQL — partial unique indexes enforce the seating invariants
```

In production a single Node process serves both the API (`/api/*`) and the built
SPA, so there is one Railway service, one origin, and no CORS in the request path.

### The AI pipeline

This is the part worth reading closely. The language model never touches the
database, and never sees the employee directory.

```
1. prompt ─────────────▶ POST /api/ai/interpret
2. context             the model is given the office *shape* only:
                       buildings, floors, zones, department names
3. model output        a strict JSON intent, validated by a zod schema.
                       It contains names and seat codes — never IDs, never SQL
4. resolution          resolver.ts looks every reference up in the database.
                       Zero matches → rejection. Two matches → clarification
5. rule check          disabled seat? occupied? already seated? inactive employee?
6. persistence         an AIAction row is stored with status PENDING
7. preview             the browser renders a confirmation card. NOTHING is written
8. confirm ────────────▶ POST /api/ai/execute { aiActionId }
9. re-validation       the stored command runs through the *same* seating service
                       the manual UI uses, inside a transaction. If the world
                       changed since the preview, it fails loudly
10. audit              an AuditLog row is written with source = AI
```

An intent whose action is not in the allow-list fails schema validation. A
hallucinated employee fails resolution. A stale preview fails re-validation. Each
failure mode ends in a friendly message, never a stack trace.

### Repository layout

```
.
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma          data model + the uniqueness invariants
│   │   ├── migrations/            checked-in SQL migrations
│   │   └── seed.ts                realistic demo data
│   └── src/
│       ├── config/env.ts          zod-validated environment
│       ├── lib/                   errors, HTTP envelope, auth, redacting logger
│       ├── middleware/            auth, validation, rate limits, error handler
│       ├── routes/                REST endpoints
│       ├── services/              business logic (incl. services/ai)
│       └── test/                  fixtures and suite setup
├── frontend/
│   └── src/
│       ├── components/            ui primitives, layout, seating, employees, ai
│       ├── pages/                 one file per route
│       ├── providers/             auth, theme, workspace selection
│       └── lib/                   api client, types, formatting, mutations
├── railway.json
└── .env.example
```

---

## Tech stack

| Layer | Choice |
| --- | --- |
| Frontend | React 18, TypeScript, Vite 6, Tailwind CSS 3, shadcn/ui-style components on Radix primitives, Lucide icons, React Router 6, TanStack Query 5, Recharts |
| Backend | Node 20+, TypeScript, Express 4, zod validation |
| Database | PostgreSQL 14+, Prisma 6 |
| Auth | JWT in an HttpOnly, SameSite=Lax cookie; bcrypt password hashing |
| AI | Google Gemini or Groq, plus a built-in deterministic interpreter |
| Tests | Vitest, Supertest |
| Deploy | Railway (Nixpacks), single service |

---

## Database schema

| Model | Purpose |
| --- | --- |
| `User` | Administrator accounts (`ADMIN`, `MANAGER`, `VIEWER`) |
| `Employee` | The people directory |
| `Building` → `Floor` → `Seat` | Physical hierarchy; seats carry grid coordinates |
| `FloorArea` | Meeting rooms, break rooms and similar, drawn behind the desks |
| `SeatAssignment` | The assignment ledger — current *and* historical |
| `AuditLog` | One row per mutation, manual or AI |
| `AIAction` | Prompt, parsed action, preview, status and result |

### The seating invariants

Two rules must never break: **one employee cannot hold two desks**, and **one desk
cannot hold two employees**. Both are enforced by PostgreSQL, not just by
application code:

```prisma
model SeatAssignment {
  releasedAt DateTime?
  /// `true` while live, NULL once released
  active     Boolean?

  @@unique([employeeId, active])
  @@unique([seatId, active])
}
```

Because PostgreSQL treats NULLs in a unique index as distinct, an employee may have
unlimited *released* rows (`active = NULL`) but only one live row (`active = true`).
The same holds for seats. A race that slipped past the service-layer check still
hits a database constraint, which the error handler maps to a friendly 409. There is
a test that writes a conflicting row directly through Prisma to prove the constraint
is doing the work.

`Seat.status` is a denormalised projection of that ledger, always written in the same
transaction, so lists and filters do not need a join.

---

## Running it on another machine

A complete walkthrough from a bare machine to a running app. Commands are given for
macOS/Linux and for Windows PowerShell where they differ. Total time is about ten
minutes, most of it `npm install`.

### Step 0 — Install the prerequisites

| Tool | Version | Check it with | Where to get it |
| --- | --- | --- | --- |
| Node.js | 20 or newer | `node -v` | <https://nodejs.org> (LTS build) |
| npm | 10 or newer | `npm -v` | ships with Node.js |
| Git | any | `git --version` | <https://git-scm.com/downloads> |
| PostgreSQL | 14 or newer | see Step 3 | Docker, a native install, or a hosted database |

If `node -v` prints anything below `v20`, upgrade before continuing — the build relies on
modern Node APIs and will fail on older versions.

### Step 1 — Get the code

```bash
git clone <your-repository-url> seatflow
cd seatflow
```

If you were handed a folder rather than a repository, just `cd` into it.

### Step 2 — Install dependencies

Run this **once, from the project root**. It installs the `backend` and `frontend`
workspaces together — do not run `npm install` inside those folders.

```bash
npm install
```

A first run takes a few minutes: roughly 600 packages plus the Prisma query engine.

> **On npm 12 or newer:** npm blocks dependency install scripts by default. The approvals
> this project needs (`prisma`, `@prisma/client`, `@prisma/engines`, `esbuild`) are
> already committed in the root `package.json` under `allowScripts`, so a plain
> `npm install` works. Older npm versions ignore that field. If you ever see
> `packages had install scripts blocked`, run
> `npm install-scripts approve prisma @prisma/client @prisma/engines esbuild` and install
> again.

### Step 3 — Provide a PostgreSQL database

Pick **one** of these three options.

#### Option A — Docker (simplest; nothing installed on the host)

```bash
docker run -d --name seatflow-pg -e POSTGRES_USER=seatflow -e POSTGRES_PASSWORD=seatflow -e POSTGRES_DB=seatflow -p 55432:5432 postgres:16-alpine
```

Port `55432` is deliberate: it cannot collide with a PostgreSQL you may already have on
the default `5432`. Confirm the container is up:

```bash
docker ps --filter name=seatflow-pg
```

Then create the second database the test suite uses:

```bash
docker exec seatflow-pg psql -U seatflow -d seatflow -c "CREATE DATABASE seatflow_test;"
```

#### Option B — PostgreSQL installed on the machine

Create the user and the two databases:

```bash
psql -U postgres -c "CREATE USER seatflow WITH PASSWORD 'seatflow' CREATEDB;"
psql -U postgres -c "CREATE DATABASE seatflow OWNER seatflow;"
psql -U postgres -c "CREATE DATABASE seatflow_test OWNER seatflow;"
```

A native install normally listens on `5432`, so use that port in Step 4 rather than
`55432`.

#### Option C — A hosted database (Neon, Supabase, Railway, RDS)

Create a database and copy the connection string it gives you. It will look like
`postgresql://user:password@host:5432/dbname?sslmode=require`. Create a second database
for tests too, or leave `TEST_DATABASE_URL` empty and accept that the integration tests
will be skipped.

### Step 4 — Create the environment file

The backend reads `backend/.env` (a `.env` in the project root also works). Copy the
example:

```bash
cp .env.example backend/.env
```

```powershell
# Windows PowerShell
Copy-Item .env.example backend\.env
```

Then open `backend/.env` and set two things.

**1. `DATABASE_URL` and `TEST_DATABASE_URL`.** The defaults already match the Docker
command in Option A, so if you used Docker there is nothing to change. Otherwise point
them at your database. The format is:

```
postgresql://USER:PASSWORD@HOST:PORT/DATABASE?schema=public
```

**2. `JWT_SECRET`.** Generate a real one — this works on every platform:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

Paste the output into `JWT_SECRET`. A finished file looks like this:

```env
DATABASE_URL="postgresql://seatflow:seatflow@localhost:55432/seatflow?schema=public"
TEST_DATABASE_URL="postgresql://seatflow:seatflow@localhost:55432/seatflow_test?schema=public"

PORT=4000
NODE_ENV=development
CORS_ORIGIN="http://localhost:5173"

JWT_SECRET="paste-your-generated-secret-here"
JWT_EXPIRES_IN="12h"

SEED_ADMIN_EMAIL="admin@seatflow.io"
SEED_ADMIN_PASSWORD="SeatFlow!2024"
SEED_ADMIN_NAME="Avery Collins"

AI_PROVIDER="local"
AI_API_KEY=""
AI_MODEL=""
AI_RATE_LIMIT_PER_MINUTE=20
```

`AI_PROVIDER="local"` means the assistant works immediately with no API key. See
[Step 9](#step-9--optional-use-a-hosted-ai-model) to switch to Gemini or Groq.

> `.env` is git-ignored. Never commit it.

### Step 5 — Create the database schema

```bash
npm run db:deploy
```

This applies the committed SQL migration. Expect output similar to:

```
Datasource "db": PostgreSQL database "seatflow", schema "public" at "localhost:55432"
1 migration found in prisma/migrations
Applying migration `20240101000000_init`
All migrations have been successfully applied.
```

If it fails with `P1001: Can't reach database server`, the database is not running or
`DATABASE_URL` is wrong — return to Step 3.

### Step 6 — Load the demo data

```bash
npm run db:seed
```

You should see:

```
Resetting existing data...
Created 2 buildings, 5 floors and 68 seats.
Created 38 employees.

Seed complete
  Employees          38
  Seats              68
    occupied         35
    available        26
    reserved         4
    disabled         3
  Occupancy          54%

  Admin sign-in      admin@seatflow.io / SeatFlow!2024
  Manager sign-in    workplace@seatflow.io / Workplace!2024
```

> The seed **deletes everything** in the seeded tables first. That makes it safe to
> re-run locally, and unsafe to point at real data. Those credentials are development
> defaults documented for evaluation; change `SEED_ADMIN_EMAIL` and
> `SEED_ADMIN_PASSWORD` in `.env` before seeding anything public.

### Step 7 — Start the app

```bash
npm run dev
```

This runs the API and the frontend together, with `api` and `web` prefixes on the log
lines:

```
[api] SeatFlow API listening { port: 4000, env: 'development', aiProvider: 'local' }
[web] VITE ready
[web]   ->  Local:   http://localhost:5173/
```

Open **<http://localhost:5173>**.

To run the halves in separate terminals instead, use `npm run dev:api` and
`npm run dev:web`.

### Step 8 — Sign in and confirm it works

Sign in with:

```
admin@seatflow.io
SeatFlow!2024
```

A quick pass that exercises every major feature:

1. **Dashboard** — the four stat cards populate, the occupancy trend and department
   charts render, and the recent-activity feed lists seeded assignments.
2. **Seating plan** — the floor map draws rooms and desks. Hover a desk for its tooltip;
   try the building and floor selectors and the zoom controls.
3. **Assign a seat** — click a free desk such as `B-07`, choose **Assign employee**, pick
   someone and confirm. A toast appears and the desk turns occupied.
4. **Move and release** — click an occupied desk and use **Move** or **Release**,
   confirming the dialog.
5. **AI assistant** — type `Move Rahul Sharma to seat B-04`. A confirmation card appears
   describing the change; press **Confirm change** to apply it. Then try
   `Which seats are available on Floor 2?` for a read-only answer, and
   `Move Arjun Mehta to A-01` to see the ambiguity prompt.
6. **Activity** — every change you just made is listed, tagged Manual or AI.
7. **Theme** — the header toggle switches light and dark, and the choice survives a
   refresh.
8. **Mobile** — narrow the window below about 1024px: the sidebar collapses into a drawer
   and the floor map becomes a card grid.

### Step 9 — (optional) Use a hosted AI model

The assistant works out of the box with the built-in interpreter. To use a real model,
edit `backend/.env` and restart:

```env
AI_PROVIDER="gemini"
AI_API_KEY="your-key"
```

Keys come from [Google AI Studio](https://aistudio.google.com/apikey) for Gemini or the
[Groq Console](https://console.groq.com/keys) for Groq (`AI_PROVIDER="groq"`). The key is
read on the server only and is never sent to the browser. The active provider is shown on
the AI Assistant page and in Settings.

### Step 10 — (optional) Run the tests

```bash
npm test
```

With `TEST_DATABASE_URL` set and reachable you should see **81 passing**. Without it, the
33 unit tests run and the 48 database-backed tests are skipped with a warning — see
[Testing](#testing).

### Step 11 — (optional) Try the production build locally

```bash
npm run build
npm start
```

`npm start` applies migrations, then serves the API *and* the built frontend from a single
process. Open <http://localhost:4000> — one origin, exactly as it behaves on Railway.

---

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `P1001: Can't reach database server` | PostgreSQL is not running, or the host/port in `DATABASE_URL` is wrong | Check `docker ps`; confirm the port (`55432` for the Docker recipe, usually `5432` for a native install) |
| `Invalid environment configuration: DATABASE_URL is required` | `backend/.env` is missing or in the wrong folder | Redo Step 4 — the file must be at `backend/.env` or the project root |
| `password authentication failed for user "seatflow"` | Credentials in `DATABASE_URL` do not match the database | Recreate the user (Step 3, Option B) or correct the URL |
| `packages had install scripts blocked` | npm 12+ blocking lifecycle scripts | `npm install-scripts approve prisma @prisma/client @prisma/engines esbuild`, then `npm install` |
| `@prisma/client did not initialize yet` | The Prisma client was never generated | `npm run db:generate` |
| `EADDRINUSE: address already in use :::4000` | Something else holds the API port | Change `PORT` in `.env`, or stop the other process |
| Port 5173 already in use | Another Vite dev server is running | Vite offers the next free port — accept it |
| Login always fails | The database was never seeded | `npm run db:seed` |
| Dashboard empty, charts blank | Same cause — no data | `npm run db:seed` |
| Tests report `48 skipped` | `TEST_DATABASE_URL` unset or unreachable | Create `seatflow_test` (Step 3) and set the variable |
| Data looks wrong after editing the schema | The local database has drifted | `npm run db:reset` — drops, re-migrates and re-seeds |

---

## Environment variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `DATABASE_URL` | yes | — | PostgreSQL connection string |
| `TEST_DATABASE_URL` | for tests | — | Scratch database for the suite. **It is truncated** |
| `JWT_SECRET` | yes | — | Session signing key. ≥32 chars in production |
| `JWT_EXPIRES_IN` | no | `12h` | Session lifetime |
| `PORT` | no | `4000` | API port |
| `NODE_ENV` | no | `development` | `development` \| `test` \| `production` |
| `CORS_ORIGIN` | no | empty | Comma-separated allowed origins. Leave empty when the API also serves the SPA |
| `SERVE_STATIC` | no | on in production | Set `false` to run the API headless |
| `AI_PROVIDER` | no | `local` | `gemini` \| `groq` \| `local` |
| `AI_API_KEY` | if not `local` | empty | Provider key. **Server-side only** |
| `AI_MODEL` | no | per provider | Model override |
| `AI_RATE_LIMIT_PER_MINUTE` | no | `20` | Per-admin budget for `/api/ai/*` |
| `SEED_ADMIN_EMAIL` | no | `admin@seatflow.io` | Seed-only |
| `SEED_ADMIN_PASSWORD` | no | `SeatFlow!2024` | Seed-only |
| `SEED_ADMIN_NAME` | no | `Avery Collins` | Seed-only |

Configuration is validated by zod at boot. A missing or weak value stops the process
with a readable message instead of failing on the first request.

---

## Command reference

Every command is run from the **project root**.

| Command | What it does |
| --- | --- |
| `npm install` | Installs both workspaces |
| `npm run dev` | API on :4000 and the app on :5173, together |
| `npm run dev:api` / `npm run dev:web` | Run one half on its own |
| `npm run build` | Prisma client, backend `tsc`, then the Vite production bundle |
| `npm start` | Applies migrations, then serves the API and SPA from one process |
| `npm test` | Backend test suite |
| `npm run typecheck` | TypeScript across both workspaces |
| `npm run lint` | ESLint across both workspaces |
| `npm run db:deploy` | Apply committed migrations (use this in CI and production) |
| `npm run db:migrate` | Create a new migration while developing |
| `npm run db:seed` | Load demo data (destructive) |
| `npm run db:reset` | Drop, re-migrate and re-seed |
| `npm run db:generate` | Regenerate the Prisma client |

In development Vite proxies `/api` to the backend, so the browser stays on a single
origin and the session cookie behaves exactly as it does in production.

---

## Testing

```bash
npm test
```

The suite has two halves:

**Pure unit tests** (no database, always run) — the deterministic AI interpreter
against every prompt shape in the spec, seat-code normalisation, model-response JSON
extraction, intent-schema rejection of unknown actions, query-parameter validation,
and proof that the logger redacts passwords, tokens and API keys.

**Integration tests** (require `TEST_DATABASE_URL`) — the seating service and the AI
pipeline against a real PostgreSQL database, plus HTTP-level tests through Supertest.

If `TEST_DATABASE_URL` is unset or unreachable, the integration specs are **skipped**
with a warning so the unit suite still runs. In CI, set `REQUIRE_DB_TESTS=1` to turn
that skip into a hard failure.

Coverage of the scenarios the brief asks for:

| # | Scenario | Where |
| --- | --- | --- |
| 1 | Assign an employee to an available seat | `seating.service.test.ts` |
| 2 | Prevent assigning an occupied seat | `seating.service.test.ts` |
| 3 | Move an employee between seats | `seating.service.test.ts` |
| 4 | Prevent two active seats per employee (service *and* DB constraint) | `seating.service.test.ts` |
| 5 | Release a seat, and reject releasing an empty one | `seating.service.test.ts` |
| 6 | Prevent assigning a disabled seat | `seating.service.test.ts` |
| 7 | An AI move requires confirmation and changes nothing before it | `ai/pipeline.test.ts` |
| 8 | An executed AI action writes an audit log with `source = AI` | `ai/pipeline.test.ts` |

Beyond those: stale-preview re-validation, double execution, cancellation, ambiguity
resolution, cross-user confirmation attempts, bulk moves, authentication,
authorisation, request validation and error envelopes.

---

## AI configuration

Three providers implement the same `AiProvider` interface, so switching one for
another changes nothing downstream.

### Google Gemini

```env
AI_PROVIDER="gemini"
AI_API_KEY="<key from https://aistudio.google.com/apikey>"
AI_MODEL="gemini-2.0-flash"   # optional
```

### Groq

```env
AI_PROVIDER="groq"
AI_API_KEY="<key from https://console.groq.com/keys>"
AI_MODEL="llama-3.3-70b-versatile"   # optional
```

### Built-in interpreter (default)

```env
AI_PROVIDER="local"
```

`local` runs a deterministic rule-based parser in `services/ai/providers/local.ts`.
It is not a stub: it handles every prompt shape in
[Example AI prompts](#example-ai-prompts) and feeds the identical resolve → preview →
confirm → execute → audit pipeline. It exists so the assistant is fully demonstrable
without an API key and so CI can exercise the pipeline without network calls. The UI
labels which provider is active on the AI Assistant page and in Settings.

If a hosted provider is configured but unreachable, the API returns
*"The AI service is temporarily unavailable. You can still manage seating manually."*
and records the failed attempt in the AI history. It does not silently fall back.

**The API key only ever exists on the server.** It is read from the environment in
`config/env.ts`, used in `services/ai/providers/*`, and never included in any
response — `/api/ai/status` reports the provider name and model only.

---

## Example AI prompts

These all work against the seeded data.

**Changes (previewed, then confirmed)**

- `Move Rahul Sharma to seat B-07`
- `Move Priya from A-12 to B-04`
- `Assign Tomas Novak to the next available seat on Floor 2`
- `Move all available Marketing employees to Floor 3`
- `Release seat A-05`
- `Release Priya Nair's seat`

**Questions (answered immediately, nothing to confirm)**

- `Which seats are available on Floor 2?`
- `How many seats are occupied on Floor 1?`
- `Find an available seat near the Engineering team`

**Error and clarification paths worth demonstrating**

| Prompt | Response |
| --- | --- |
| `Move Arjun Mehta to B-03` | Two people share that name — pick one from the list |
| `Move Priya to B-03` | Two Priyas — pick one (naming the current seat disambiguates automatically) |
| `Move Rahul Sharma to Z-99` | *There is no seat with the code "Z-99".* |
| `Move Rahul Sharma to A-01` | *Seat A-01 is currently occupied by Arjun Mehta.* |
| `Move Rahul Sharma to B-08` | *Seat B-08 is disabled and cannot be assigned.* |
| `Move Rahul Sharma` | *Where should Rahul Sharma go? Give me a seat code or a floor.* |
| `Delete all employees` | *That is not something the seating assistant can do.* |

---

## Railway deployment

`railway.json` and `nixpacks.toml` are committed, so Railway needs no manual build
configuration.

### 1. Create the project

```bash
npm i -g @railway/cli
railway login
railway init
```

Or use the dashboard: **New Project → Deploy from GitHub repo**.

### 2. Add PostgreSQL

In the project, **New → Database → Add PostgreSQL**. Railway provisions it and
exposes `DATABASE_URL` as a shared variable.

### 3. Set the service variables

On the app service, under **Variables**:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (reference the plugin) |
| `JWT_SECRET` | a fresh 48-byte random string |
| `NODE_ENV` | `production` |
| `AI_PROVIDER` | `gemini`, `groq`, or `local` |
| `AI_API_KEY` | your key (omit when `AI_PROVIDER=local`) |

Leave `PORT` unset — Railway injects it and the server reads it. Leave `CORS_ORIGIN`
unset: the same service serves the SPA, so requests are same-origin.

### 4. Deploy

```bash
railway up
```

Railway then runs:

- **Build** — `npm run build` (Prisma client, backend `tsc`, Vite bundle)
- **Start** — `npm start`, which runs `prisma migrate deploy` before booting the
  server, so schema changes are applied on every release

Generate a public domain under **Settings → Networking → Generate Domain**. The
health check at `/api/health` gates the deploy.

### 5. Seed (once, and only if you want demo data)

Seeding is deliberately *not* part of the start command, so a redeploy can never wipe
production data. Run it explicitly:

```bash
railway run npm run seed:prod
```

The seed **deletes all existing rows** in the seeded tables before inserting. Never
run it against a database that holds real data.

### Deployment notes

- The `prisma` CLI and `tsx` are runtime dependencies, not dev dependencies, so
  `migrate deploy` and the seed script work even if a platform prunes dev
  dependencies after the build.
- Nothing is written to the local filesystem; all state lives in PostgreSQL.
- `app.set('trust proxy', 1)` is set so client IPs and the `Secure` cookie flag are
  correct behind Railway's proxy.

---

## Publishing to GitHub

```bash
git init                       # if not already a repository
git add .
git commit -m "SeatFlow"
gh repo create seatflow --public --source=. --push
```

Or, without the `gh` CLI, create an empty repository on GitHub and:

```bash
git remote add origin https://github.com/<you>/seatflow.git
git branch -M main
git push -u origin main
```

`.gitignore` already excludes `node_modules/`, `dist/`, and every `.env` file except
`.env.example`. Verify before pushing:

```bash
git status --porcelain --ignored | grep "\.env$"   # should list .env as ignored
```

---

## Security notes

- **Passwords** — bcrypt, cost factor 12. Password hashes never leave the service
  layer.
- **Sessions** — JWT in an `HttpOnly`, `SameSite=Lax` cookie, `Secure` in production,
  so page scripts cannot read the token and cross-site posts are blocked. A `Bearer`
  header is also accepted for non-browser clients.
- **Every request re-reads the user** from the database, so a deleted or demoted
  account loses access immediately rather than when its token expires.
- **Authorisation** — mutating routes require `ADMIN` or `MANAGER`; `VIEWER` is
  read-only, and the UI hides actions it cannot perform.
- **Input validation** — every body, query and path parameter is parsed by zod, which
  also coerces and applies defaults. Unknown fields are stripped.
- **Rate limiting** — 300 req/min per user across the API, 10 sign-in attempts per
  15 minutes, and a configurable per-admin budget on the AI endpoints.
- **No raw SQL from the model, ever.** The model returns an intent from a closed
  allow-list; the resolver turns names into IDs; execution goes through the same
  typed Prisma service the manual UI uses.
- **Login responses are identical** for an unknown email and a wrong password, and a
  bcrypt comparison runs in both cases so timing does not leak account existence.
- **Logging redacts** `password`, `token`, `authorization`, `cookie`, `apiKey`,
  `secret` and friends at any depth. There is a test for it.
- **Errors** — 5xx responses carry a generic message; stack traces and driver output
  are logged server-side only.
- **Headers** — Helmet, with a tailored CSP in production, and `x-powered-by`
  disabled.
- **No secrets in the client bundle.** `AI_API_KEY` is read only in server modules.

---

## Design decisions

**Database-enforced invariants over application checks.** Service-layer guards give
good error messages; partial unique indexes make the bad state unrepresentable. Using
`active Boolean?` (true or NULL) rather than a plain boolean lets one index cover both
"one live seat per employee" and unlimited assignment history.

**The model never sees the directory, and never emits IDs.** It receives the office
*shape* — buildings, floors, zone letters, department names — and returns names and
seat codes. The server resolves those against the database. This keeps personal data
out of third-party prompts and makes a hallucinated employee fail resolution rather
than mutate the wrong row.

**Re-validate at execution, not just at preview.** The confirmation step re-runs the
stored command through the same transactional service the manual UI uses. If someone
took the seat between preview and confirm, execution fails with a clear conflict
instead of forcing the change through.

**Assign-to-an-already-seated-employee becomes a move.** Rather than erroring, the
preview says so explicitly and the confirmed operation releases the old desk and takes
the new one in one transaction — so the "one seat per employee" rule holds without
making the admin do it in two steps.

**Globally unique zone letters.** Floor 1 uses zones A–C, Floor 2 uses D–E, and so on,
so a seat code like `B-07` identifies exactly one desk company-wide. That is what
makes short codes usable in natural language without a floor prefix.

**Floor plans are data, not markup.** Seat coordinates and room rectangles live in the
database, so a new floor is a seed change rather than a frontend change.

**One service in production.** The API serves the built SPA, which means one Railway
service, one origin, no CORS in the request path, and cookies that behave the same
locally and in production.

**Tailwind v3 with hand-written shadcn-style components** rather than the CLI: the
generator needs an interactive prompt, and the components are small enough that
owning them outright is simpler than depending on a scaffold.

**Two hand-tuned themes, not an inversion.** Dark mode uses cool, layered surfaces
that step up in lightness as elements come forward. Seat status is conveyed by icon
*and* colour so it survives colour-blindness and high-contrast modes.

**Skipping, not failing, when no test database is present.** `npm test` should be
useful on a fresh clone. `REQUIRE_DB_TESTS=1` restores strictness for CI.

---

## Known limitations

- **No live multi-user updates.** Data is refetched after mutations and the
  notification feed polls once a minute, but there is no WebSocket push. Two admins
  editing simultaneously will see a 409 conflict rather than a live cursor — correct,
  but not collaborative.
- **The 14-day occupancy trend is computed in application code** from the assignment
  ledger. That is fine at this scale; at hundreds of thousands of assignments it
  should become a SQL aggregate or a materialised daily snapshot.
- **Employee create and edit exist in the API** (`POST`/`PATCH /api/employees`) and are
  covered by validation and audit logging, but the UI surfaces the directory as
  read-only — seating operations are the focus, and HR systems are usually the source
  of truth for the directory itself.
- **The floor plan is not editable in the UI.** Desks and rooms are positioned via
  seed data; there is no drag-and-drop plan editor.
- **The built-in interpreter is rule-based**, so it handles the documented phrasings
  and close variants well, but it will not match a hosted model on unusual wording.
  Configure Gemini or Groq for open-ended language.
- **Rate limiting is in-process**, so limits are per-instance. Horizontal scaling would
  need a shared store such as Redis.
- **No password reset or user management UI.** Accounts are created by the seed; this
  is an internal tool that would sit behind SSO in reality.
