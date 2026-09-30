# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

openGym is a self-hosted gym & body-weight tracker PWA. Two containers (`api` + `web`) plus a
`./data` folder the user owns — no third-party account, no telemetry. Passkey (WebAuthn) login,
installable as a home-screen app, optional Capacitor shells for standalone Android/iOS builds.
License: AGPL-3.0-or-later.

## Project layout

```
frontend/  React 19 + Vite app (src/views, src/components, src/store, src/lib). Builds to static files.
           android/ + ios/ are the Capacitor shells for the standalone mobile app (docs/MOBILE.md).
api/       backend — server.js (Node, no framework), deps: @simplewebauthn/server, web-push.
           api/engine (the v2 training engine) and api/migration (the v1 → v2 profile conversion)
           are runtime-neutral: the server imports them under bare node, the web and Capacitor
           builds import the same files under Vite. So does api/coach/core (the Coach).
web/       multi-stage Dockerfile (builds frontend → nginx) + nginx.conf.template (serves app, proxies /api).
mcp/       optional MCP server — read-only stdio bridge exposing a user's workouts/1RM/muscle
           balance to LLM clients (Claude Desktop, Cursor…). Not part of the Docker build; only
           runs when an LLM client spawns it.
media/     exercise img/gif, gitignored, fetched at runtime by the `media` compose service.
website/   static marketing site (plain HTML/CSS/JS), deployed separately by .gitlab-ci.yml.
docs/      SELF_HOSTING.md, MOBILE.md, MIGRATION_TO_ENGINE_NOTE.md (the v1 and v2 data models, field by field).
```

## Commands

```bash
# Local stack (api + web + media, prebuilt or built from source)
cp .env.example .env
docker compose up -d --build

# Frontend dev server (hot reload), proxies /api to :3000
cd frontend && npm install && npm run dev

# Frontend tests (engine, prescriptions, 1RM, session read-back)
cd frontend && npm test            # vitest run
cd frontend && npm run test:watch
npx vitest run src/lib/prescription/advance.test.js   # single file
npx vitest run -t "some test name"           # single test by name

# MCP server tests
cd mcp && npm test

# API tests (node:test; the engine and migration suites live here and in frontend/src/lib/prescription)
cd api && npm test
node api/scripts/check-core-loadable.mjs   # api/coach/core, api/engine, api/migration must load under bare node

# Production build
cd frontend && npm run build
cd frontend && npm run build:mobile   # + cap sync, points media at the CDN dataset
```

There is no linter/formatter configured (no ESLint/Prettier config in the repo) and no
TypeScript — match the existing style by hand.

The CI gate is `.gitlab-ci.yml` on GitLab, the canonical remote (see README): it runs the
`frontend/`, `mcp/` and `api/` tests on Node 22 — the same version as `web/Dockerfile` / `api/Dockerfile`
(`node:22-alpine`) — and additionally builds and publishes the Docker images, packages the
signed Android APK, and deploys the demo/docs site. The Gitea and GitHub workflow copies
(`.gitea/workflows/`, `.github/workflows/`) are dormant mirrors; neither host runs them.

## Architecture

### Frontend (`frontend/src`)

- **`store/useStore.js`** — single Zustand store holding the entire client-side app state (`S`),
  persisted to `localStorage` (`gym_state_v1`) and debounce-pushed to the server when signed in
  (`pushState`, see `lib/api.js`, which sends `X-OpenGym-Engine-Schema: 2`). On the Capacitor mobile
  build it's also mirrored to a file via `lib/mobile.js` (`nativeSave`), since WebView storage can
  be evicted. The workout in progress is **not** part of `S`: it has its own key (`gym_active_v1`,
  mirrored by `nativeActiveSave`) and is never synced. `store/useUI.js` holds ephemeral UI state
  (modals, active sheet, etc.) separately from persisted data.
  The store also runs the one-off v1 → v2 conversion (`openMigration` / `confirmMigration`, behind
  the blocking `views/MigrationGate.jsx` screen) and refuses to merge a v1 and a v2 profile.
- **`lib/`** — pure, framework-free helpers, each paired with a same-directory `*.test.js`. This
  is where the domain logic lives, most importantly:
  - `prescription/` — the client's import path for the training engine (`export * from
    ../../../../api/engine/index.js`); the engine itself lives in `api/engine` (see below). The
    engine's unit tests sit beside this re-export: `prescription/*.test.js`.
  - `session-start.js` — gathers a routine occurrence's inputs (rule, progression state, newest
    log, current 1RM) and stores the engine's frozen prescription; `session-ui-adapter.js` turns a
    prescription into the rows the workout screen edits and the rows back into persisted performance.
  - `finish-session.js` — reduces a completed session back into state (each exposure becomes a log
    with its audit, each track advances once, PRs and 1RMs are recorded).
  - `onerm.js` — estimated 1RM from logged sets (the formulas themselves live in the engine).
  - `recovery.js` / `recovery-view.js` — fatigue/muscle-recovery model.
  - `workout-model.js`, `supersetFlow.js` — in-session workout state machine, incl. supersets.
  - `exercises.js` / `exercises-data.js` — the exercise library (1,324 built-ins + user-defined).
  - `api.js` — the only place that talks to the backend (`fetch` wrapper, session cookie flows).
  - CONTRIBUTING.md is explicit: **anything that decides what you lift next, or reads a logged
    session back, is a pure helper with a unit test beside it** — not verifiable by clicking, and
    the progression engine has already had two bugs that only a test caught. That now means
    `api/engine` (tests in `lib/prescription/`) or a helper here. There is no v1 progression
    code left: `lib/no-legacy-progression.test.js` fails if `progression.js` / `finish-workout.js`
    come back, if the v1 `POLICIES` list is used outside `lib/prescription/vocabulary.js` (the
    boundary with the Coach, which still speaks v1 policies), or if a second v1 → v2 migration
    appears next to the shared one in `api/migration`.
- **`views/`** — one file per screen (Home, Workout, Plan, Library, Stats, History, Settings,
  Admin, Login, RoutineEdit), routed by `react-router-dom` from `App.jsx`.
- **`components/`** — shared UI (charts, modals, timers); `instr/` holds per-language exercise
  instruction text; `locales/` is the i18n string catalogue (`lib/i18n.js` / `i18n-core.js`).
- Mobile: `@capacitor/*` wraps the same web build into native shells under `frontend/android` and
  `frontend/ios` (see `docs/MOBILE.md`); `mobile.js` in `lib/` gates native-only behavior (file
  persistence, local notifications, wake lock) behind a `MOBILE` flag.

### Training engine and data model v2 (`api/engine`, `api/migration`)

A profile carries `engineSchemaVersion: 2`. Unlike v1, which re-derived the next load from history
on every read, v2 **stores what the engine decided**:

- a routine slot is an *occurrence* `{ occurrenceId, exerciseId, rule, … }` whose `PlanRule` is one
  of 12 presets (`manual`, `autoregulated`, `linear`, `greyskull`, `double`, `triple`, `duration`,
  `hold_seconds`, `bodyweight_ladder`, `pyramid`, `reverse_pyramid`, `five_three_one`), optionally
  with `deload { after, factor }`;
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
`POST /api/data/migrate-engine-v2`, run only after the owner confirms on the migration screen; it
keeps the untouched v1 file once as `state-<uid>.pre-engine-v1.json` and never replaces it. Auth is
WebAuthn passkeys (`@simplewebauthn/server`) plus a signed session cookie (HMAC'd with a
`DATA_DIR/secret` generated on first boot) — no JWT/session-store dependency. Optional pieces
gated by env vars: `ADMIN_UIDS` (admin dashboard), `INVITE_ONLY` (signup needs a code),
`ALLOW_GUEST` (client-only guest mode never hits the server at all), plus a rotating
`data/audit.log` (JSONL) for sign-in/admin events. Web Push (`web-push`, VAPID keys
auto-generated into `data/vapid.json`) drives rest-timer-over and day-reminder notifications.

### MCP server (`mcp/src`)

Read-only stdio MCP bridge (`@modelcontextprotocol/sdk`) that lets an LLM client read a single
user's routines/workouts/body-weight/1RM/muscle-balance directly from the same `DATA_DIR` the API
writes to — no network call, no extra container. `state.js` loads/derives the data, `tools.js`
defines the exposed MCP tools (zod-validated schemas), `labels.js` maps internal keys to
human-readable labels, `index.js` wires it together. It reads the v2 shape (exposures and their
frozen prescriptions); it reads straight off disk, outside `engineGate`, so a profile still on v1
is refused with an "upgrade from the app first" message instead of being reported empty. See `mcp/README.md` for the client-config
side (Claude Desktop / Cursor).

### Passkeys and self-hosting constraints

WebAuthn passkeys are bound to an exact hostname (`RP_ID`) and require HTTPS (localhost excepted)
— this shapes a lot of the API and Settings code (`RP_ID`/`ORIGIN` env vars, guest-mode fallback
when neither is available). Read `docs/SELF_HOSTING.md` before touching auth, session, or
notification code; it documents the exact env-var contract (`RP_ID`, `ORIGIN`, `PORT`,
`WEB_PORT`, `NGINX_PORT`, `BACKEND`, `SESSION_DAYS`, `ADMIN_UIDS`, `INVITE_ONLY`, `ALLOW_GUEST`,
`AUDIT_*`, `VAPID_SUBJECT`) that real deployments depend on.

### Docker / deploy

The web image is built from the repository root because the frontend imports `api/coach/core`,
`api/engine` and `api/migration`; `web/Dockerfile` copies each by hand (and `api/Dockerfile` copies
`engine/` and `migration/` into the API image), so a new shared folder under `api/` has to be added
to both, to `build:web-check` and to `check-core-loadable.mjs`.

`docker-compose.yml` has three services: `media` (one-shot exercise-asset downloader, gitignored
output), `api`, `web` (multi-stage build of `frontend/` served by nginx, which also proxies
`/api` → `api` and serves the shared media volume — single origin, required for passkeys).
`web/nginx.conf.template` is rendered from env vars at container start (`NGINX_PORT`, `BACKEND`,
`PORT`), so host/port remapping works against prebuilt images without a rebuild.

## Guidelines from CONTRIBUTING.md worth knowing before changing code

- **Dependency-light is a hard constraint, not a preference.** Frontend: React + Router + Zustand
  and nothing else. `api/`: two dependencies total. New dependencies are a hard sell either side.
- Don't commit `media/` or `data/` (gitignored).
- Training-logic changes (progression, 1RM, session read-back) need a unit test beside the code —
  for `api/engine` / `api/migration` that is `frontend/src/lib/prescription/*.test.js` or
  `api/test/*.test.js` — not just manual clicking-through.
- Keep `api/engine` and `api/migration` runtime-neutral and dependency-free; anything that needs the
  exercise catalogue, the clock or a random source takes it as an argument.
