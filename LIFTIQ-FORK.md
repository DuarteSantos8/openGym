# LiftIQ fork of openGym

This repository is a **non-commercial fork** of [openGym](https://github.com/DuarteSantos8/openGym)
(Copyright (C) 2026 Duarte Santos, AGPL-3.0-or-later). It exists to host a phone-only web app of openGym
that will gain support for the LiftIQ barbell-speed sensor (Web Bluetooth). The integration is in development.

- Published build (standalone flavour): https://louraaaaaaaa.github.io/openGym/
- Source of that build (AGPL section 13 offer): https://github.com/louraaaaaaaa/openGym, branch `liftiq`
- The Source link in Settings > About & updates points here in the standalone build.

## Branch model

| Branch | Purpose |
|---|---|
| `main` | Local mirror of upstream `main`. **Never push `main` to this fork.** Only fast-forward it from `upstream/main` locally if you want a clean reference. |
| `liftiq` | The fork's real branch: upstream plus the patches listed below. This is what gets deployed. |

Why `main` must never be pushed: upstream's own `.github/workflows/pages.yml` (and `docker-publish.yml`,
`mirror.yml`, `ios.yml`, `test.yml`) trigger on pushes to `main`. Pushing `main` to the fork would start
upstream's Pages deploy (with the seeded "Demo") and compete with `pages-liftiq.yml` for the same Pages site.
All fork workflows trigger from `liftiq` only. Upstream changes are merged INTO `liftiq`.

## Standalone flavour

`VITE_STANDALONE=1` at build time. It reuses the existing demo mechanism (`VITE_DEMO`): no backend, guest mode
on `localStorage` (`gym_state_v1`), no login, no sync/admin/passkeys. Differences from the upstream demo:

- boots with an EMPTY history (no `demoSeed`, no `gym_demo_seeded_v1` flag),
- no "Demo" wording (Settings account card/section), no "Reset demo data",
- the canned demo Coach is hidden,
- Settings > About shows the fork's source link and the credit to upstream (plain English, not translated).

Upstream builds (without the flag) are unchanged: `STANDALONE` is a build-time constant.

## Patch list (every hunk carries a `LIFTIQ-FORK:` comment)

Find them all with: `git grep -n "LIFTIQ-FORK"`

Upstream files touched (keep this list in step with the grep):

- `frontend/src/lib/demo.js`: `STANDALONE` flag; `DEMO` is also true when standalone.
- `frontend/src/store/useStore.js`: boot does not seed demo data when standalone.
- `frontend/src/lib/coach.js`: `coachAvailable` is false for the demo stub when standalone.
- `frontend/src/views/Settings.jsx`: account card/section without "Demo", source/credit lines in About.
- `frontend/src/views/settings-pages.js`: no "Reset demo data" search row when standalone.
- `frontend/src/views/Workout.jsx` (P1, 2 hunks): import of `liftiq/menu.js` and one spread of `liftiqSetItems(...)`
  as the first item of the set menu (`openSetMenu`). Empty list unless the integration is on.
- `frontend/src/views/Settings.jsx` (P1, 2 more hunks): import and `<LiftiqSettingsSection />` at the end of the
  Settings root (renders nothing unless the integration is on).

New files (no merge conflicts possible):

- `frontend/src/liftiq/` (`fork.js`, `StandaloneRows.jsx`, and the P1 integration, see "LiftIQ sensor integration (P1 spike)")
- `frontend/public/liftiq-sim/` (the simulator recording, 114 kB CSV)
- `docs/liftiq/P1_SPIKE.md` (flow and owner test checklist)
- `.github/workflows/pages-liftiq.yml`
- `LIFTIQ-FORK.md`

Untouched on purpose: `NOTICE.md`, `CLA.md`, `LICENSE`, `catalogue/` (media), `.github/workflows/pages.yml`.

## Build and preview

```bash
cd frontend
npm ci
VITE_STANDALONE=1 npm run build                 # PowerShell: $env:VITE_STANDALONE='1'; npm run build
node ../scripts/catalogue/stage-media.mjs dist   # unmodified 180 px stills/clips + their NOTICE.md
npx vite preview --port 5180                     # http://localhost:5180/
```

Tests: `cd frontend && npm test` (Node 22 is what upstream CI uses; Node 24 works locally. On Windows with
`core.autocrlf=true` a few tests fail only because of CRLF checkouts and path separators; see the report of the
first run).

## Owner checklist for GitHub Pages (manual)

1. On the fork (github.com/louraaaaaaaa/openGym): Settings > Actions > General: allow Actions.
2. Settings > Pages > Build and deployment > Source: **GitHub Actions**.
3. Push the `liftiq` branch (never `main`): `git push -u origin liftiq`. The workflow "Deploy LiftIQ standalone
   to GitHub Pages" runs; it can also be started by hand (Actions > workflow_dispatch).
4. The site appears at https://louraaaaaaaa.github.io/openGym/ (the repository keeps the name `openGym`; Vite base is `./`).
5. The repository must be public for the AGPL source offer (and for free Pages).
6. Optional: disable the upstream workflows that cannot do anything useful on the fork (mirror, docker-publish, ios, cla).

## Syncing with upstream

The clone is shallow (depth 1). Before the first merge, give git enough history:

```bash
git remote -v                       # origin = the fork, upstream = DuarteSantos8/openGym
git fetch --unshallow upstream      # or: git fetch --deepen=500 upstream, until a merge base appears
git fetch --unshallow origin        # only if origin is shallow too
git checkout main && git merge --ff-only upstream/main      # local mirror only, do not push
git checkout liftiq && git merge upstream/main              # resolve conflicts; grep LIFTIQ-FORK shows what is ours
cd frontend && npm ci && npm test
git push origin liftiq
```

After each merge re-run `git grep -n LIFTIQ-FORK` and check that the patch list above is still accurate.

## Licence and non-commercial notes

- Code: AGPL-3.0-or-later (see `LICENSE`). This fork's changes are under the same licence. Network use: the
  in-app Source link offers the fork's source.
- Exercise media: licensed to openGym by Gym visual. `NOTICE.md` allows a non-commercial fork to keep the
  unmodified 180 px media together with that notice. Keep `catalogue/media`, `NOTICE.md` and the
  attribution line in Settings > About intact. Do not resize, re-encode, hotlink, or feed them to AI tools.
- Non-commercial means: no ads, no paid app, no paid hardware bundle that requires the app. Add nothing that changes that.
- The CLA applies only to contributions to upstream; nothing here has been submitted upstream.

## LiftIQ sensor integration (P1 spike)

Flow and owner checklist: `docs/liftiq/P1_SPIKE.md`. This fork's openGym (1.4.3) has no Modules framework, so the feature
is gated by `liftiq/feature.js` `liftiqEnabled()`: on in the standalone build (`VITE_STANDALONE=1`), with `?liftiqSim=1`,
or with `localStorage['liftiq.enabled']='1'`. Everything else (upstream builds) sees no change.

New files, all in `frontend/src/liftiq/`: `feature.js` (gating, Web Bluetooth detection), `sanitize.js` (`sanitizeVbt`,
`buildVbt`, `vbtLabel`), `mini-store.js` (non-persisted connection/live store), `controller.js` (BleClient + ready check +
live counter + analysis; raw samples live only in memory), `review.js` (`pickAnalysis`, `vbtFromReview`, `writeBack`),
`menu.js` (the set-menu item), `RecordSheet.jsx` (the sheet with inline stages), `SensorPanel.jsx`, `SensorSheet.jsx`,
`SettingsRow.jsx`, `format.js`, `sim-transport.js` (simulator), `vendor/liftiq-sensor/` (vendored package), tests beside them
(`*.test.js[x]`, plus `views/Workout.liftiq.test.jsx`). The RecordSheet, controller and vendored package load on demand
(dynamic import), the simulator only with `?liftiqSim=1`.

### Vendoring (never edit `vendor/`)

Source of truth: `packages/liftiq-sensor` in the LiftIQ repo. From a LiftIQ checkout:

```bash
node tools/vendor-sensor.mjs --target <fork>/frontend/src/liftiq/vendor           # refresh the copy
node tools/vendor-sensor.mjs --target <fork>/frontend/src/liftiq/vendor --check   # exit 1 if the copy differs
```

It writes `liftiq-sensor/` with a `// VENDORED FROM packages/liftiq-sensor@<version>` first line per file (SPDX lines kept) and
`VERSION.json`. Commit the result together. Vendored now: 0.1.0.

### Simulator

`?liftiqSim=1` (kept for the tab session; `?liftiqSim=0` clears it) replaces Web Bluetooth with `SimulatedTransport`, which plays
the real 5-rep seated-row recording `86c1eceb` (LiftIQ `tests/fixtures/seated-row-2026-11-22`) as 50 Hz v1 18-byte packets
through the real decoder. `&liftiqSpeed=4` plays it 4x faster (1..8). Settings > LiftIQ sensor > Connect then connects "LiftIQ-SIM0".

### Stored data

`set.vbt` (about 300 bytes, derived numbers only, sanitised by `sanitizeVbt`): `v, alg, src:'liftiq', repsWithSetup, repsNoSetup,
setupIncluded, mpv, vlPct, pv[], upCm, fw, pkg, at`. No raw samples anywhere in `S`/localStorage/sync. It survives finishing, the
sync merge and a JSON backup (`vbt-survival.test.jsx`). No whitelist needed a patch.

### Deliberate deviations (fix before any upstream contribution)

- All new user-visible strings are plain English, not `t()` keys (upstream needs 25 locale packs and `check-source-strings`).
- No Modules framework entry (does not exist in this version); gating is `liftiqEnabled()`.
- Settings entry is a row opening a sheet, not a `PAGES` page (avoids `settings-pages` tests/i18n).
- `vbt` has no row label yet (`vbtLabel` exists, unused in the UI), no Stats/PDF sections.

### Known limitations

- CSV export/import of openGym is column-fixed: `vbt` is not carried (JSON backup and sync keep it).
- The api server (`api/sync-stamps.js`) was not exercised; the standalone build has no server.
- Real Bluetooth, background throttling, reconnect and offline behaviour are unverified. Simulator CSV (114 kB) ships in `public/`.
- Only plain reps sets, not per-side/timed/cardio, and not while editing a saved workout.
- The package has no wake lock helper; the controller requests a screen wake lock itself (feature-detected).

### Testing with a real sensor (Android Chrome)

Needs https (the Pages site) or localhost, Chrome on Android, Bluetooth and location-free pairing via the browser chooser:
open the app, Settings > LiftIQ sensor > Connect sensor, pick `LiftIQ-XXXX`. Push the `liftiq` branch and re-run the Pages
workflow first. iPhone Safari has no Web Bluetooth; the app says so.
