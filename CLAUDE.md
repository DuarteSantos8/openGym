# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.
For people, the same map with diagrams is [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## What this is

openGym is a self-hosted gym and body-weight tracker. Two containers (`api` + `web`) plus a
`./data` folder the user owns: no third-party account, no telemetry. Passkey (WebAuthn) login,
installable as a PWA, and Capacitor apps for Android and iPhone (with an Apple Watch app and
widgets) that work on their own or synced to a server. License: AGPL-3.0-or-later; the exercise
media are licensed separately (NOTICE.md).

## Project layout

```
frontend/   React 19 + Vite app (src/views, src/components, src/store, src/lib, src/sheets.jsx).
            android/ + ios/ are the Capacitor shells (docs/MOBILE.md); ios/ also holds the watch
            app (Watch, WatchCore, WatchWidgets), the widgets and the animation-pack downloader.
api/        Backend: server.js (plain node:http) plus small testable modules beside it.
            coach/ is the optional AI coach; coach/core/ is shared with the phone apps.
            engine/ (the v2 training engine) and migration/ (the v1 → v2 profile conversion)
            are runtime-neutral: the server imports them under bare node, the web and phone
            builds import the same files under Vite, like coach/core.
            openapi.yaml documents every route.
web/        Multi-stage Dockerfile (builds frontend, adds catalogue/media, serves with nginx) and
            nginx.conf.template (serves the app, proxies /api).
catalogue/  The exercise database: exercises/<id>.json, i18n/, licensed 180 px media/.
mcp/        Optional stdio MCP server: reads DATA_DIR, and its one write tool (log_workout)
            saves through the api. Not in the Docker build.
scripts/    Build, CI and release helpers (scripts/README.md).
website/    opengym.ch, plain HTML/CSS/JS, deployed separately.
helm/, kubernetes/, contrib/nix/   Other ways to deploy.
docs/       Guides indexed in docs/README.md; docs/dev/ holds feature design notes.
```

## Commands

```bash
# Local stack (api + web, prebuilt or built from source)
cp .env.example .env
docker compose up -d --build

# Frontend dev server (hot reload), proxies /api to :3000
cd frontend && npm install && npm run dev

# Frontend tests (engine, prescriptions, 1RM, session read-back)
cd frontend && npm test            # vitest run
cd frontend && npm run test:watch
npx vitest run src/lib/prescription/advance.test.js   # single file
npx vitest run -t "some test name"           # single test by name

# API and MCP server tests
cd api && npm test
cd mcp && npm test

# API tests (node:test; the engine and migration suites live here and in frontend/src/lib/prescription)
cd api && npm test
node api/scripts/check-core-loadable.mjs   # api/coach/core, api/engine, api/migration must load under bare node

# Production build
cd frontend && npm run build
cd frontend && npm run build:mobile   # VITE_MOBILE build + 180 px media from catalogue/media + cap sync
```

There is no linter/formatter config and no TypeScript; match the existing style by hand.

GitHub (`github.com/DuarteSantos8/openGym`) is the home of the project; `.github/workflows/mirror.yml`
pushes `main` and `v*` tags to the GitLab mirror (fast-forward only, never push or merge there).
Pull requests are gated by `.github/workflows/test.yml`; `ios.yml` compiles the iPhone app on a Mac
runner. Release packages (APK, Play bundle, App Store IPA) are built and signed on the release
machine, never in CI (see "Exercise media" below and docs/APP_STORES.md).

## Architecture

### Frontend (`frontend/src`)

- **`store/useStore.js`**: a single Zustand store holding the client-side app state (`S`),
  persisted to `localStorage` (`gym_state_v1`) and debounce-pushed to the server when signed in
  (`pushState`, see `lib/api.js`, which sends `X-OpenGym-Engine-Schema: 2`). On the phones it is also mirrored to a file via `lib/mobile.js`
  (`nativeSave`), since WebView storage can be evicted. `store/useUI.js` holds ephemeral UI state
  (modals, active sheet, rest timer) separately from persisted data. The workout in progress is not part of `S`: it has its own key
  (`gym_active_v1`, mirrored by `nativeActiveSave`) and is never synced. The store also runs the one-off
  v1 → v2 conversion (`openMigration` / `confirmMigration`, behind `views/MigrationGate.jsx`).
- **`lib/`**: pure, framework-free helpers, each paired with a same-directory `*.test.js`. The
  domain logic lives here, most importantly:
  - `prescription/` — the client's import path for the training engine (`export * from
    ../../../../api/engine/index.js`); the engine itself lives in `api/engine` (see below). The
    engine's unit tests sit beside this re-export: `prescription/*.test.js`.
  - `session-start.js` — gathers a routine occurrence's inputs (rule, progression state, newest
    log, current 1RM) and stores the engine's frozen prescription; `session-ui-adapter.js` turns a
    prescription into the rows the workout screen edits and the rows back into persisted performance.
  - `finish-session.js` — reduces a completed session back into state (each exposure becomes a log
    with its audit, each track advances once, PRs and 1RMs are recorded).
  - `onerm.js`: estimated 1RM from logged sets (the formulas live in the engine).
  - `recovery.js` / `recovery-view.js`: the fatigue and muscle-recovery model.
  - `workout-model.js`, `supersetFlow.js`: the in-session workout state machine.
  - `sync-merge.js`: the field-by-field merge behind the 409 retry (see "Sync" below).
  - `exercises.js` / `exercises-data.js`: the exercise library (5,632 catalogue exercises plus
    user-defined ones). `exercises-data.js`, `instr/`, `exercise-names/` and `exercise-desc/` are
    generated from `catalogue/` by `scripts/catalogue/build.mjs`; never edit them by hand.
  - `api.js`: the only place that talks to the backend (`fetch` wrapper, session flows).
  - Native bridges: `mobile.js` (the `MOBILE` flag, file persistence, notifications),
    `channel.js` (APK or store build), `watch-sync.js`, `widgets.js`, `health-sync.js`,
    `anim-quality.js` / `anim-packs.js` (animation sizes in the store apps).
  - CONTRIBUTING.md is explicit: **anything that decides what you lift next, or reads a logged
    session back, is a pure helper with a unit test beside it** (`api/engine`, tested in `lib/prescription/`, or a helper here). There is no v1
    progression code left: `lib/no-legacy-progression.test.js` fails if `progression.js` / `finish-workout.js` come back.
- **Body measurements (`lib/measurements.js`, `views/Measurements.jsx`)**: one check-in per day.
  Built-in circumferences and legacy custom fields store cm and follow the profile's cm/in
  display. Custom definitions may specify `unit: 'cm' | 'in' | '%' | 'kg' | 'lb' | 'none'`; that
  display choice stays fixed when the profile switches kg/lb. Custom values store canonical cm, kg
  (to 0.001 kg so a tenth of a pound round-trips), percent (0 to 100) or a plain number. Each
  custom reading also carries its unit, preserving its meaning in backups without definitions.
  Once values exist, the unit selector permits cm/in or kg/lb conversions within the recorded
  type; a different type needs a new field. The body CSV names a custom column with its unit,
  "Muscle ratio (%)", and the importer reads those columns back (only from our own header).
- **`views/`**: one file per screen, routed by `react-router-dom` from `App.jsx`.
- **`sheets.jsx`**: the bottom sheets (exercise picker, exercise config, workout detail, plan
  import...). It is large; a new sheet can go into `components/` as its own file.
- **`components/`**: shared UI (charts, modals, timers, media).
- **`locales/`**: one i18n pack per language, keyed by the English string (`lib/i18n.js`,
  `i18n-core.js`). A new `t()` string goes into every pack; pt-BR inherits from pt and has a
  fingerprint test (`scripts/pt-br-inheritance-fingerprint.mjs`).

### Training engine and data model v2 (`api/engine`, `api/migration`)

A profile carries `engineSchemaVersion: 2`. Unlike v1, which re-derived the next load from history
on every read, v2 **stores what the engine decided**:

- a routine slot is an *occurrence* `{ occurrenceId, exerciseId, rule, … }` whose `PlanRule` carries a
  `program` — phases of set groups, operators that step load/reps/sets/seconds/rest/rung, a back-off,
  exits — built by one of 13 templates (`preset`: the 10 v1-era ones plus `top_set_backoff`,
  `accumulation_intensification`, `density`); the engine reads the program, never the name;
- starting a session generates one **frozen, content-hashed `Prescription`** per occurrence
  (`prescriptions{}`); a logged exercise is an *exposure* `{ exposureId, prescriptionId,
  performance.sets[], actual, audit }` in `workout.exposures[]`, so history never changes when a
  rule is edited;
- a `ProgressionState` per track (`progression{}`) is advanced by `advanceProgression` when a
  session finishes, and rebuilt by replaying history when the plan changes;
- 1RMs are an append-only dictionary (`oneRepMaxes{}`).

`api/engine` is pure and catalogue-free (no storage, no exercise library, no Coach imports): same
inputs, same prescription. `api/migration` (`migrateProfileV1ToV2(state, catalogue)`) is the one-way,
deterministic v1 → v2 conversion shared by the API, the browser and the Capacitor shells; it takes
the exercise catalogue (`LIB_BY_ID` from `api/coach/core/library.js`) as an argument, so every caller
must pass the same one. Both folders must load under bare node — no `?raw`, `import.meta.glob` or
frontend imports — which `api/scripts/check-core-loadable.mjs` checks outside vitest.
`docs/MIGRATION_TO_ENGINE_NOTE.md` is the reference for both data models and for what the migration
can and cannot carry over; when it and the code disagree, the code wins.

### API (`api/server.js`)

Single file, no framework, plain `node:http`. Requests are dispatched through a `routes` object
keyed by `'METHOD /path'` (e.g. `routes['GET /api/health']`) matched against `req.method + ' ' +
url.pathname` — add a new endpoint by adding a key here. State is two flat JSON files under
`DATA_DIR` (`db.json`: users/credentials/subscriptions/invites; `state-<uid>.json`: per-user
workout data), written with a write-temp-then-rename atomic pattern (`atomicWrite`).
`engineGate` guards `GET /api/data`, `GET /api/data/rev` and `PUT /api/data` on the client's
`X-OpenGym-Engine-Schema` header: a v1 file answers an engine-aware client `409 migration-required`,
a v2 file answers an old client `409 upgrade-required`. The conversion itself is
`POST /api/data/migrate-engine-v2`, which the app calls by itself at launch once its own v1 copies are backed up; it
keeps the untouched v1 file once as `state-<uid>.pre-engine-v1.json` and never replaces it. Auth is
WebAuthn passkeys (`@simplewebauthn/server`) plus a signed session cookie (HMAC'd with a
`DATA_DIR/secret` generated on first boot) — no JWT/session-store dependency. Optional pieces
gated by env vars: `ADMIN_UIDS` (admin dashboard), `INVITE_ONLY` (signup needs a code),
`ALLOW_GUEST` (client-only guest mode never hits the server at all), plus a rotating
`data/audit.log` (JSONL) for sign-in/admin events. Web Push (`web-push`, VAPID keys
auto-generated into `data/vapid.json`) drives rest-timer-over and day-reminder notifications.

### MCP server (`mcp/src`)

Stdio MCP bridge (`@modelcontextprotocol/sdk`) that reads one user's data straight from
`DATA_DIR` (the v2 shape; a profile still on v1 is refused with an "upgrade from the app first" message). `state.js` loads and derives the data, `tools.js` defines the read tools (zod schemas),
`labels.js` maps keys to readable labels, `index.js` wires it together. The one write tool,
`log_workout` (`write-tools.js`), never writes the file: it builds the workout with
`frontend/src/lib/log-workout.js` and saves it with `PUT /api/data` over a paired-session token
(`api-client.js`, `scripts/pair.mjs`), the way a device syncs. See `mcp/README.md`.

### Passkeys and self-hosting constraints

WebAuthn passkeys are bound to an exact hostname (`RP_ID`) and need HTTPS (localhost excepted).
Read `docs/SELF_HOSTING.md` before touching auth, session or notification code; it documents the
env-var contract (`RP_ID`, `ORIGIN`, `PORT`, `WEB_PORT`, `NGINX_PORT`, `BACKEND`, `SESSION_DAYS`,
`ADMIN_UIDS`, `INVITE_ONLY`, `ALLOW_GUEST`, `AUDIT_*`, `VAPID_SUBJECT`) that real deployments
depend on.

### Docker / deploy

The web image is built from the repository root because the frontend imports `api/coach/core`, `api/engine` and `api/migration`;
`web/Dockerfile` and `api/Dockerfile` copy each by hand, so a new shared folder under `api/` is added to both, to
`build:web-check` and to `check-core-loadable.mjs`.

`docker-compose.yml` has two services, `api` and `web`. The web image builds `frontend/`, copies
`catalogue/media` into it as `/exercise-media/`, and nginx proxies `/api` to the api (one origin,
which passkeys require). `web/nginx.conf.template` is rendered from env vars at start
(`NGINX_PORT`, `BACKEND`, `PORT`), so remapping works against prebuilt images.

### Exercise media (licence, read before touching media)

The stills and animations are licensed from Gym visual, not AGPL. Only 180 px files may be in the
repository, CI, the web image, the demo or a self-hosted server (`scripts/catalogue/check-media.mjs`
enforces it). Larger sizes exist only inside the APK and store packages, built on the release
machine, or as Apple-hosted / Play asset packs. Never commit, upload or serve anything larger, and
never feed the media to an AI tool.

## Guidelines from CONTRIBUTING.md worth knowing before changing code

- **Dependency-light is a hard constraint.** Frontend: React + Router + Zustand (plus Capacitor
  plugins). `api/`: three dependencies. New dependencies are a hard sell either side.
- Don't commit `data/`. Don't add or replace anything in `catalogue/media/`.
- Training-logic changes (progression, 1RM, session read-back) need a unit test in `src/lib`
  beside the code (for `api/engine` / `api/migration`: `frontend/src/lib/prescription/*.test.js` or `api/test/*.test.js`).
- User-facing text: plain and human, no em dashes. CHANGELOG.md is written at release time.
- Keep `api/engine` and `api/migration` runtime-neutral and dependency-free; anything that needs the
  exercise catalogue, the clock or a random source takes it as an argument.
