# Optional openGym extensions (Soren fork)

This document tracks **implemented functionality**, **verified boundaries**, and **work still required**.
It is not a claim that every referenced service is installed, licensed, or connected.

## Current implementation

The **Extension Lab** is reached through Settings → Integrations → Extension lab, or `/#/addons`.

| Feature | Actual behavior | Privacy / readiness |
| --- | --- | --- |
| Training-volume charts | Existing workout data, grouped by workout date and displayed using ECharts | Local read-only analytics; no fabricated workouts, charts load only when opened |
| Food diary | Log foods per day and meal, by hand or from a barcode lookup; day totals of energy, protein, carbs and fat; previous days; remove with Undo | Stored in the profile (`S.foodLog`) and synced like workouts; nothing is sent to a third party. Values the label does not give stay empty and the totals say so |
| Food product lookup | User enters a GTIN barcode; the authenticated server retrieves fields from the official Open Food Facts API (v3.6 `nutrition.aggregated_set`, legacy `nutriments` as fallback) | **Off by default**; sends the barcode only when explicitly submitted; no workout/user history transmitted. Label values only: values Open Food Facts estimated itself are left out |
| GPX, TCX, FIT activity preview | Browser reads a selected local file with sports-lib and shows distance and duration | File remains on the device and **is not yet imported or synced** to openGym's history |
| Transition animations | Motion is loaded with the optional lab; reduced-motion preference respected | No app-wide navigation changes |

The other products mentioned in the research catalog are **not integrated** by displaying them in the roadmap. Do not imply otherwise.

### Enable the nutrition lookup

Edit the openGym server's `.env`, add:

```dotenv
ADDON_NUTRITION=1
OPEN_FOOD_FACTS_USER_AGENT=openGym-SorenFork/0.1 (https://github.com/sorensadrgit-art/openGym)
```

Recreate the server container with the **fork's source code**: `docker compose up -d --build`. Do not use the upstream prebuilt `ghcr.io/duartesantos8/opengym-api:latest` image for this feature; it does not include the fork changes. Verify `GET /api/config` reports `addons: { nutrition: true }` only to a signed-in session.

All other instances remain unchanged. Requests are strictly 8 to 14 decimal barcode digits, limited to 12 lookups per minute per signed-in profile, time out after eight seconds, and use a bounded fifteen-minute cache. The lookup is read-only and returns a restricted set of nutritional fields without third-party image URLs.

**Open Food Facts rights:** its database uses ODbL, individual contents DbCL, product images CC-BY-SA. Attributions and database terms matter if exporting or reusing its data. Nutrition entries can be incomplete or inaccurate; verify labels. [Official data terms](https://world.openfoodfacts.org/data).

### Run the checks

```bash
cd api && npm ci --omit=optional && node --test test/addons-food.test.js test/server-addon-food.test.js && npm test
cd ../frontend && npm ci && npx vitest run src/lib/addon-trends.test.js src/lib/addon-activity.test.js src/views/Addons.test.jsx
npm test && npm run build
```

The activity preview currently supports files <=15 MiB and displays a summary only. **It does not write to openGym's existing workout collection.** Integrating imported activities requires an explicit conversion model, deduplication, permissions, and device-to-server synchronization tests.

### Food diary: how it is stored and synced

`S.foodLog` is a map of entries keyed by id: `{ d, meal, name, brand?, amount, basis, per100, src, _ts }`.
`amount` is in `basis` (`g` or `ml`); `per100` holds `kcal`, `proteinG`, `carbohydrateG`, `fatG` per
100 of that basis, each a number or `null`. `src` is `{ kind: 'off', code }` or `{ kind: 'manual' }`.

It is one of the stamped maps of `frontend/src/lib/sync-merge.js` and `api/sync-stamps.js`
(`STAMPED_MAPS`, kept equal by a parity test), the mechanism `dayPhotos` already uses: two devices
logging different foods keep both, of an entry both edited the later edit wins, and a removal is a
stamped empty entry (`{ _ts }`) so the other device's copy cannot bring it back. "Reset everything"
clears it. The rules live in `frontend/src/lib/nutrition-diary.js` with its tests beside it.

Known limit: removed entries stay as small tombstones, like removed day photos. Years of daily logging
will grow the profile document (roughly 250 bytes an entry); pruning old tombstones needs its own
sync-safe design before it is added.

### Status checklist (updated 2026-11-13)

Labels: **Done** (built, tested, checked in a browser), **Pending** (not started), **Blocked** (needs
something named), **Out of scope** (excluded by a decision).

CI: `.github/workflows/test.yml` runs the frontend, api and Node-RED jobs on pull requests. GitHub
Actions has never run on this fork: it has to be enabled in the fork's **Actions** tab first.
Upstream-only jobs (image publishing, Pages, the iOS build, the CLA bot) skip on forks.

| # | Phase | Status | What is true now |
|---|---|---|---|
| 0 | Extension Lab foundation | **Done** | Fixed: Open Food Facts v3.6 moved nutrients, every live lookup came back empty. Back button, label basis. |
| 1 | Nutrition diary | **Done** | Built into openGym (above), not a separate service. |
| 1b | NutriTrace food library (read) | **Done** | Server opt-in (`INTEGRATIONS=…,nutritrace`); per-profile token sealed on the server; search and log from the Lab. Hardened: transient errors do not flag the connection, implausible values and malformed answers are refused, SSRF and profile-isolation tests against a real `server.js`. Checked against NutriTrace's source and a stand-in built from it; **not yet against a running instance**. |
| 1c | NutriTrace workout push | Pending | Waits on measured calories (see below). |
| 2 | Mealie recipes and meal plans | Spec only | [docs/dev/mealie-integration.md](dev/mealie-integration.md), from Mealie's source. Building needs a test instance, and a `serving` basis in the diary (Mealie has no serving weight). |
| 3 | Liftosaur programming | Pending | Liftosaur's licence and Liftoscript evaluator to be reviewed; openGym's own progression engine stays. |
| 4 | MediaPipe pose estimation | Pending | Apache-2.0; on-device only, camera permission, rep counting needs real video to validate. |
| 5 | Capacitor Bluetooth LE | Out of scope | openGym in this fork is a web app (decision 2026-11-13: no native or mobile app work). The browser's Web Bluetooth API is the web route; it works in Chromium browsers only and still needs real sensor hardware to test. |
| 6 | FitTrackee | Pending | Needs a FitTrackee instance; the activity preview is the import path's first half. |
| 7 | 3D anatomy (Three.js, R3F, Drei) | Blocked | The libraries are MIT; a licensed anatomy model is the blocker (BodyParts3D is CC-BY-SA 2.1 JP). |
| 8 | Node-RED | **Done** | [contrib/node-red](../contrib/node-red/README.md): importable flow that checks openGym's webhook signature over the raw bytes, the time window, replays and size. Tested on a real Node-RED 5.0.9 in CI. |
| 9 | LangGraph.js | Pending | Only where the existing Coach pipeline shows a gap. |
| 10 | Ollama | Pending | The Coach already speaks to OpenAI-compatible endpoints; verify against a local Ollama and document. |

### NutriTrace

[NutriTrace](https://github.com/TraceApps/nutritrace) (AGPL-3.0, Svelte + Express + SQLite) offers a
Federation API at `/api/v1` with bearer tokens (`nt_pat_` plus 43 base64url characters, made in its
Settings → API Tokens) and scopes.

**Read from the source, not only the docs site.** Checked 2026-11-13 against the repository at
`888c966` (`server/routes/api/v1/*.js`, `server/middleware/bearer-auth.js`, `docs/federation.md`):

- `GET /api/v1/me` (no scope) answers `{ user, instance, scopes }`.
- `GET /api/v1/foods` (`read:foods`) answers `{ items, total, limit, offset }`. An item's
  `nutrition` is the stored blob of nutrient ids, **per `portion` of `unit`** (`portion` defaults to
  100, `unit` to `g`). The ids are `calories` (kcal), `proteins`, `carbohydrates`, `fat` (g) and
  more. **The published docs page names them `kcal`, `protein_g`, `carbs_g`, `fat_g`, which the
  server never uses**; the adapter reads the real ids and falls back to those.
- 401 `auth_missing` / `auth_invalid`, 403 `auth_scope`.
- `POST /api/v1/workouts` (`write:workouts`) and `POST /api/v1/activity` (`write:activity`) both
  require calories and are idempotent by `external_id`.
- **Correction:** there *is* a diary API, `/api/v1/diary`, described as a general public API for a
  user's own scripts. It is off unless the NutriTrace server sets `PUBLIC_API_ENABLED` (and
  `PUBLIC_API_WRITE_ENABLED` to write), and it uses the `mcp:read` / `mcp:write` scopes. It is not
  on the published Federation API page. Mirroring openGym's diary into it is possible later; not built.

#### Connecting (implemented)

1. The openGym admin adds `nutritrace` to `INTEGRATIONS` (for example `INTEGRATIONS=webhook,nutritrace`).
   A NutriTrace on the home network over plain http also needs `INTEGRATIONS_ALLOW_LAN=1`.
2. In NutriTrace: Settings → API Tokens, a token with the `read:foods` scope.
3. In openGym: Settings → Integrations → Extension lab → **NutriTrace foods**: the address and the
   token, **Connect**, then **Check connection** (calls `/api/v1/me` and checks the scope).
4. Search, pick a meal, **Add** a food to the diary's day. Foods NutriTrace keeps in cups, pieces or
   custom units are listed but cannot be added: the diary does not guess a density.

How it is built: a provider in `api/integrations/providers/nutritrace.js` on the webhook's framework.
The address and token are sealed per profile (`DATA_DIR/integrations/`), the app never gets them
back, requests go through `net-guard.js` (https, no private addresses unless the admin allows the
home network, no redirects, 8 s timeout, 512 KB answer cap), one connection a profile, 30 searches a
minute a profile. Only the search text is sent; the food's image and notes are not passed on. A
refused token marks the connection *Needs attention*. Route: `GET /api/integrations/nutritrace/foods`.

#### Workouts into NutriTrace (not built)

openGym records no calories for a workout. The plan agreed on 2026-11-13: first check whether
NutriTrace already gets workout calories from Health Connect or a similar sync (its calories-out
picks a source at read time, which could double count). Only if it does not: send a workout when it
has measured calories, with the openGym workout id as `external_id`. No estimates.

### Optional services and planned integration boundaries

| Component | Chosen integration | Current status and acceptance gate |
| --- | --- | --- |
| NutriTrace | Standalone nutrition service; scoped federation API, per-user consent, isolated credentials | Not connected; prove backups, migrations, authentication, idempotent food writes |
| Mealie | Recipe/meal-plan REST adapter, server-side keys | Not connected; need configured instance, permissions, and recipe data ownership |
| FitTrackee | Optional endurance service, independent database | Not connected; prove activity identifiers and round-trip import mapping |
| Liftosaur | Preserve existing openGym rule engine; evaluate Liftoscript in isolated module | Not connected; deterministic rule evaluation and migration needed |
| MediaPipe | On-device permission-based pose estimation | Not connected; requires camera permission, calibrated placement, confidence and rep-count tests; no medical claims |
| Capacitor BLE | Pair only supported named devices with explicit authorization | Not connected; requires physical hardware, Android/iOS build and permissions |
| R3F / Drei / Three.js | Optional route with separately licensed anatomy assets | Not connected; clear model rights, performance and accessibility gates |
| BodyParts3D | Selected anatomy meshes with explicit attribution | Assets deliberately not imported pending license review (CC-BY-SA-2.1 JP) |
| Node-RED | Separate opt-in automation service fed by openGym's existing signed webhooks | Not connected; verify event signatures, loop protection, secret handling |
| LangGraph.js | Optional durable multi-step AI coach workflows | Not connected; existing coach is kept until evaluation proves a gap |
| Ollama | Existing openGym supported OpenAI-compatible provider | No new runtime deployed; operator supplies a suitable local model and verifies results |
| Sports2D / OpenSim | Specialist video analysis or simulation services | Not connected; separately validated use cases and licensing |

For each integration: install only when it solves a defined problem; keep secrets server-side, use per-user authorization, store provenance, avoid accidental export of personal records, retain backups, and test failure/retry/rollback paths.

**Code license:** openGym is AGPL. Its bundled exercise graphics and animations are **not** covered by AGPL: the third-party Gym visual media has special terms, and a commercial fork needs appropriate licenses or original replacements. See [NOTICE.md](../NOTICE.md) before using the fork commercially or changing exercise media.

### Deployment and update policy

Keep upstream at `DuarteSantos8/openGym` and your modifications on a separate feature branch until reviewed. Never deploy a feature branch to the public endpoint or overwrite an existing `./data` directory automatically. Backup the live `./data` directory before any tested release, verify migrations, use a staging hostname with appropriate passkey `RP_ID` and `ORIGIN`, and deploy only after explicit production approval.
