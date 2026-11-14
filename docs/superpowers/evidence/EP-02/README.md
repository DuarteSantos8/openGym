# EP-02 evidence

Synthetic profile only (`fixture.py` generates `state.json`: one routine, four workouts `ep02-w0..3`, three weigh-ins, rest 90 s). Vite dev servers on throwaway local ports plus a disposable API (`DATA_DIR` in /tmp, `ALLOW_GUEST=1`). Chromium through browser-harness. Licensed media is blocked before any app navigation (`about:blank`, then `Network.setBlockedURLs`, then navigate), so no media appears.

## Re-run
```
python3 fixture.py > state.json
BASE=http://127.0.0.1:5199 SHA=<sha> OUT=after EXTRAS=1 ./run.sh capture      # screenshots + manifest.json
BASE=http://127.0.0.1:5199 RM=no-preference|reduce OUT_JSON=out.json ./run.sh probe
```
`run.sh` joins `common.py` with `capture_body.py` or `probe_body.py` and pipes them to `browser-harness`. The scripts refuse a non-local origin and refuse to overwrite a profile that does not contain the fixture ids (`ALLOW_OVERWRITE=1` for a throwaway origin). They check the profile first and refuse before touching any tab or storage; only then they close earlier tabs on that exact origin, clear that origin's storage and cookies (`Storage.clearDataForOrigin`, no global cookie clearing) and seed the fixture through a script that runs before the app loads (the app writes its in-memory state back on unload, so writing storage and reloading does not work).

## Chronology and corrections (disclosed)
- `before/` was captured from the unchanged base commit bd1ab806 (separate worktree) after the code was written; it is a reproducible comparison, not a pre-change capture.
- Earlier screenshot sets were wrong and were deleted: Stats and Settings showed Home (path navigation instead of the HashRouter hash), and dark files were light (storage was seeded after the app loaded). Retaken with the scripts here.
- The signed-delta fix on `MetricCard` was committed together with its test, not RED first.

## Screenshots and manifests
`before/` (24) and `after/` (30): Home, Stats, Settings and the active workout at 320, 390 and 1280 px, dark and light, plus in `after/` the body-weight card at 320 and 390 in both themes, `after/rtl-ar-bodyweight-320.png` (Arabic, `dir=rtl`) and `after/zoom200-bodyweight-320.png` (root font size 200%, computed 32px, `overflowX` recorded). `before/manifest.json` and `after/manifest.json` records per file: sha, base URL, requested theme, viewport, expected and observed `location.hash`, observed `data-theme`, computed body background, `dir`, root font size, horizontal overflow and byte size. The capture script raises before saving when hash, heading (or expected text), observed theme, background luminance (dark below 0.3, light above 0.7) or `dir` do not match. Checked after the run: 0 theme mismatches and no two files share a byte size in either manifest.

## Console and network (capture runs)
Per capture run: 4 expected entries, no unexpected ones, no JS exceptions, no failed requests. Expected and disclosed: `GET /api/me` 401 (guest, no session) and Chrome's "Blocked call to navigator.vibrate" intervention (no user activation for vibration). This is not a zero-console run.

## Interaction probe (`probe_body.py`)
Guest setup (clicking "Continue without account") uses a DOM `.click()`. Every asserted workout and keyboard interaction below is a real CDP mouse event at coordinates resolved from DOM geometry (scrolled into view, `elementFromPoint` must reach the target) or a real CDP key event: Start row (`.tag.acc`), Set 1 done (`button[aria-label="Set 1 done"]`, `role=checkbox`), Finish (`.whdr-finish`), "Finish and save" (a `.sheet [role=button]`, not a native button), Tab stops, Enter and Space on a clickable `MetricCard`. Assertions in each result file under `probe-results/`: workout opens at `#/workout`; set persisted as done; `#timer.rest` visible and its text changes after 1.4 s; one workout added and `active` cleared; both survive a reload; MetricCard keyboard, name `Body weight: 82.4 kg −0.6`, focus ring solid, target at least 44 px (final build only; the module does not exist on base); no unexpected console errors.

Taps to log one set: 2 (Start, then Set done); 1 inside the workout. Tab focus stops from the initial focus (nothing focused) to Set 1 done: 18 on base and on final, every run.

Timing: from the native `pointerdown` to (a) the checkbox reading `aria-checked=true` and (b) `gym_state_v1` in localStorage holding the set as done (the store writes it on every change). Both are polled per animation frame, so resolution is one frame, and in every run both were first seen in the same frame (values are equal). The 800 ms native-file save and the 1500 ms server sync are not waited on. Milliseconds, three runs per configuration, in run order:

| build / motion | run 1 | run 2 | run 3 |
|---|---|---|---|
| base, no-preference | 78.4 | 87.2 | 87.2 |
| base, reduce | 79.3 | 82.9 | 80.7 |
| final, no-preference | 207.8 | 86.1 | 106.0 |
| final, reduce | 73.7 | 73.5 | 72.0 |

The final build with normal motion had one slow run (207.8 ms) and a higher median (106 vs 87); with reduced motion it was not slower than base. I cannot attribute that to EP-02: set rows, the rest timer and the save path have no new CSS or script, and the numbers are three samples in a dev server. It is reported, not explained, and not rerun (sampling was stopped on request).

Attempts, exactly (`probe-results/batch.log` is the batch's own log, kept as written; it records only the attempt number that ended the loop, not the logs of failed attempts, which were not kept). The batch was planned as 5 rounds x 4 configurations with up to 3 attempts each and was stopped on request after 14 configuration-runs: rounds 1 to 3 complete (12 runs) plus round 4 for the two final builds. Attempt 2 was needed, after an attempt 1 that produced no result file, for: base no-preference runs 1 and 2, final no-preference run 3. The cause of those three first attempts is unknown (the first attempt's log was overwritten, not kept). Round 4 for the two final configurations (`final-no-preference-run4`, `final-reduce-run4`) completed on the first attempt, and I then deleted those two result files to keep three samples per configuration. That deletion was my choice, not a failure, and their numbers are not available. Round 4 for the base builds and all of round 5 never ran. All 12 kept result files have `failed: []`.

## Bundle (`npm run build`)
Parent's same-environment comparison at c0393641 (Node 22.23.5): entry JS +713 B raw, +266 B gzip; entry CSS +1,301 B raw, +320 B gzip; total +2,057 B raw. My Node 24.22.1 build agrees on raw entry JS (586,454 to 587,167).

## Suites
Full frontend suite earlier at c0393641: 655 files, 7855 tests, exit 0, Node 24.22.1. Not rerun for this evidence-only change. API and MCP unchanged; baseline CI run 43498778572.
