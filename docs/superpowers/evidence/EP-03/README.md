# EP-03 delivery evidence — conditionally verified

2026-11-14, Linux, Node **v22.23.5**. Branch
`room/ep-03-codex-implementation-7svw`; draft PR
[#9](https://github.com/sorensadrgit-art/openGym/pull/9), base `next/integration`.
No merge or deployment. Parent arranges independent Codex review.

## Exact revision and scope

Runtime and browser/full-suite revision:
`f28c91eafa1848a831493a96a82bc818738ad7bb`, based on integration `2efd92da`.
Subsequent test-only refinement:
`2a5baa8bab82708865e03f7c50b5f5399daddcb4` uses real dumbbell catalogue ids,
checks recorded each/total equivalence, and passed 23/23. No runtime changes
followed the verified runtime revision. The evidence commit containing this
report is identified by the PR head; it does not change application code.

Authored files: pure `exercise-volume.js` and tests; `Stats.jsx`; new
`Stats.ex-volume.test.jsx`; appended tests in `Stats.ex-range.test.jsx` and
`Stats.exercise-time.test.jsx`; 19 locale packs; the EP-03 tasks plan and this
evidence directory. Existing Stats assertions and series calculations remain
unchanged. Three legacy entry-iteration guards allow records without details.
No authored file is outside the brief's authorized paths.

PR ancestry also includes parent-owned docs commits `d545b237` and `7a7663cb`
(briefs, continuation authorization and progress ledger). This implementer did
not edit `docs/superpowers/progress.md`.

## Plan, RED, GREEN

| Commit | Result | Evidence |
|---|---|---|
| `d1b7d32e` | Inspected plan before source changes | `../../plans/EP-03-tasks.md` |
| `572e6c97` | Helper RED: 21 failed, 2 passed, exit 1 | `helper-red.log` |
| `877ae66b` | Helper GREEN: 63 passed; New York helper 23 passed | `helper-green.log`, `helper-new-york.log` |
| `1245fae7` | UI/range RED: 8 failed, 11 passed, exit 1 | `ui-red.log` |
| `f28c91ea` | UI GREEN: 19 focused; 87 Stats passed | `ui-green.log`, `stats-green.log` |
| `2a5baa8b` | Real dumbbell fixture refinement: 23 passed | `helper-fixtures-final.log` |

Helper coverage includes d-only sessions, duplicate exercise entries, separate
sessions on one day, local-midnight/DST boundaries, all five windows, units,
warm-up/bodyweight settings, sides, drops, dumbbells, timed/cardio, empty work,
legacy records, window-scoped exclusions and nonmutation. Hand reconciliation:
`50 × 5 + 40 × 3 drop + 30 × 4 = 490 kg`, two sets in one session.

## Commands and observed results

Use `export PATH="$HOME/tools/node-v22.23.5-linux-x64/bin:$PATH"` and
`export RAYON_NUM_THREADS=2`. Existing lockfiles installed with `npm ci` in
root, frontend, api and mcp, all exit 0; no dependency or lockfile changes.
Disk/load checked before heavy work; suites ran sequentially with capped workers.
Commands below use the named working directory.

| Directory | Command | Exit | Observed count / evidence |
|---|---|---|---|
| frontend | `npx vitest run src/lib/exercise-volume.test.js src/lib/bw-load.test.js src/lib/dumbbells.test.js --maxWorkers=2` | 0 | 63 tests / 3 files; `helper-green.log` |
| frontend | `TZ=America/New_York npx vitest run src/lib/exercise-volume.test.js --maxWorkers=2` | 0 | 23 / 1; `helper-new-york.log` |
| frontend | `npx vitest run src/views/Stats --maxWorkers=2` | 0 | 87 / 13; `stats-green.log` |
| frontend | `npx vitest run src/views/Stats.ex-volume.test.jsx src/views/Stats.ex-range.test.jsx src/views/Stats.exercise-time.test.jsx --maxWorkers=2` | 0 | 19 / 3; `ui-green.log` |
| frontend | `npm test -- --maxWorkers=2` | Child exit not captured; outer wrapper 143 | **7,952 passed, 1 timeout; 662 passed files, 1 failed (663 total)**; `frontend-full.log` |
| frontend | `npx vitest run src/lib/media-sync.test.js --maxWorkers=1` | 0 | **31 / 31**, 1 file; `media-sync-isolated.log` |
| frontend | `npx vitest run src/lib/exercise-volume.test.js --maxWorkers=2` | 0 | Final fixture revision: 23 / 23; `helper-fixtures-final.log` |
| frontend | `npm run build` | 0 | Built in 2.31 s; `build.log` |
| frontend | `node scripts/check-locales.mjs` | 0 | 19 packs × 3,618 keys; `locales.log` |
| frontend | `node scripts/check-source-strings.mjs --strict` | 0 | 2,964 strings; `source-strings.log` |
| api | `node --test --test-concurrency=2 test/*.test.js` | 0 | **854 passed, 9 suites**, no failed/cancelled/skipped/todo; `api-full.log` |
| mcp | `npm test -- --maxWorkers=2` | 0 | **140 passed / 6 files**; `mcp-full.log` |
| root | `node scripts/catalogue/build.mjs --check` | 0 | 5,632 exercises current; `catalogue.log` |
| root | `node scripts/build-coach-assets.mjs --check` | 0 | 5,632 exercises, 8 prompts current; `coach-assets.log` |
| root | `node scripts/build-api-docs.mjs --check` | 0 | 92 endpoints, 32 schemas, 356.9 KB current; `api-docs.log` |

The full frontend log preserves the actual timeout in
`src/lib/media-sync.test.js:325`, `localMediaGc > signed in, evicts synced main
files over the cap — never a pending one or a poster the state shows`, at the
normal 5,000 ms timeout. Full run duration: 442.49 s. That source/test file is
unchanged from integration. Its isolated run used the normal timeout and took
4.10 s. This diagnosis **does not turn the full run green**. The outer verify
session ended 143 after emitting the full test summary, before recording the
child exit or starting subsequent commands; those checks were resumed separately.

Parent explicitly directed **no second full frontend retry on this branch**.
The acceptance gate is the parent's one-worker full frontend run on the combined
reviewed candidate. Until that and independent review pass, delivery is
**conditionally verified**. `verify.sh` preserves the original sequential
commands; `checks.tsv` records observed results, including the missing child exit.
Surplus blank EOF lines and one trailing space on the build reporter heading
were removed from logs; substantive output is retained.

Build warnings remain: large chunks and ineffective dynamic imports for
Capacitor/scan-web. No new warning suppression or relaxed test timeout was added.

## Browser evidence

Real Chromium, synthetic guest, localhost API/Vite, isolated browser profile,
exercise-media requests blocked before navigation. Six reduced-motion cells:

| Width | Dark result / captures | Light result / captures |
|---|---|---|
| 320 | `browser-dark-320.json`, `top-set-dark-320.png`, `volume-dark-320.png` | `browser-light-320.json`, `top-set-light-320.png`, `volume-light-320.png` |
| 390 | `browser-dark-390.json`, `top-set-dark-390.png`, `volume-dark-390.png` | `browser-light-390.json`, `top-set-light-390.png`, `volume-light-390.png` |
| 1280 | `browser-dark-1280.json`, `top-set-dark-1280.png`, `volume-dark-1280.png` | `browser-light-1280.json`, `top-set-light-1280.png`, `volume-light-1280.png` |

All six: default Top set retained; keyboard-selected Volume and 1W; visible
focus; no document/card overflow or clipped range labels. Three table rows:
250/490/300 kg, sets 1/2/1; two same-day sessions and one d-only session.
Note: three included, three excluded, one per reason. At 320 px the five shared
range segments are about 47.4 px each, so shared 1W is retained.

Seventh run `browser-dark-390-motion.json` uses normal motion and also verifies
table/columnheader/rowheader accessibility roles, pinned lb values
551.2/1,080.3/661.4, empty 1W state and offline All with one old 440.9 lb point.
Its five captures are `top-set-dark-390-motion.png`,
`volume-dark-390-motion.png`, `volume-lb-dark-390-motion.png`,
`volume-empty-dark-390-motion.png`, `volume-offline-dark-390-motion.png`.
Total: **17 screenshots**, inspected. Offline means the already-loaded app;
cold-start service-worker offline behavior is not claimed.

Each final JSON preserves two expected `/api/me` 401 guest-bootstrap responses
and matching network console errors (14 across seven runs), with no JS exceptions
or other failed requests. Earlier interrupted 390-light and 1280-dark/light
captures retain 502 startup errors in `*-interrupted.json`; they are not passes.
`runtime-sessions.md` records spawn/exit observations and unexplained exit 143s.
Final reruns completed; no browser matrix cell remains blocked. Owned API,
Vite and Chromium were stopped at 09:40:28 UTC; their ports no longer listen.

The existing shared picker does not move/trap focus or expose a dialog role.
Keyboard navigation succeeds with Shift+Tab but has excess focus stops. This
shared accessibility limitation is outside EP-03; no full screen-reader
certification is claimed.

Reproduction: `browser-qa.py` seeds the complete fixture, freezes Date.now and
uses keyboard input for all UI interactions. Start the API on 33103 with a
throwaway `DATA_DIR`, `ALLOW_GUEST=true`, `RP_ID=localhost`,
`ORIGIN=http://localhost:5177`; start Vite on 5177 with `API_TARGET` pointing to
33103. Use a dedicated Chromium `--user-data-dir`, remote-debugging port 9323,
and the browser-harness skill. From the repository root:

```sh
BU_CDP_URL=http://127.0.0.1:9323 BH_TAB_MARKER=0 EP03_WIDTH=320 EP03_THEME=dark EP03_MOTION=reduce browser-harness < docs/superpowers/evidence/EP-03/browser-qa.py
# Repeat for the other width/theme pairs; extra cell:
BU_CDP_URL=http://127.0.0.1:9323 BH_TAB_MARKER=0 EP03_WIDTH=390 EP03_THEME=dark EP03_MOTION=no-preference EP03_EXTRA=1 browser-harness < docs/superpowers/evidence/EP-03/browser-qa.py
```

## Bundle, licence and privacy

`node docs/superpowers/evidence/EP-03/bundle.mjs` after the production build
reproduces `bundle.json` on Node 22, gzip level 9, against
`docs/product/BASELINE_REPORT.md`:

| Chunk | Raw bytes | gzip bytes | Delta raw / gzip |
|---|---:|---:|---:|
| Entry | 587,154 | 183,556 | +700 / +240 |
| Stats | 45,905 | 15,414 | +2,959 / +975 |

The published baseline predates earlier wave work; entry growth is not solely
attributable to EP-03. No separate integration build comparison was performed.
No new dependencies, media, licence obligations, telemetry, external services,
persisted state or migration. Only synthetic user data in captures; exercise
media never supplied to AI tools. Existing chart and arithmetic helpers reused.

## Integration and remaining gates

Three keys added adjacent to Stats strings in all 19 locale packs (including
explicit pt-BR overrides):

- `No exercise volume in this period.`
- `Volume per session ({0})`
- `Included {0} sessions; excluded {1}: {2} timed/cardio, {3} without completed reps or positive volume, and {4} without exercise set details.`

Coordinate those locale files with EP-04's separate Nutrition block. Shared
Stats ranges now include 1W; existing range calculations and default charts
remain unchanged. Missing-detail exclusions are unattributable legacy sessions
inside the selected window, never whole-session totals plotted as exercise work.

Pending: independent Codex review and the combined-candidate frontend acceptance
gate. GitHub Actions dispatch HTTP 422 is a parent-reported external blocker;
this task does not claim a new CI run. Native devices, sensors, passkeys, Docker,
staging, production and live external-service checks were not run. No merge or
deployment. Recommended next step: review this exact branch, combine reviewed
changes, then run the parent's agreed one-worker full frontend gate.
