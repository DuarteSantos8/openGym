# EP-02 evidence

Synthetic guest profile (one routine, 4 workouts, 3 weigh-ins, rest 90 s). Vite dev server with a disposable API (`DATA_DIR` in /tmp, `ALLOW_GUEST=1`, port 3000) behind the dev proxy. Chromium via browser-harness. Exercise media URLs were blocked, so no media is shown.

## Chronology disclosure
`before/` was captured from the unchanged base commit bd1ab806 (separate worktree) after the code was written, not before it. It is a reproducible comparison, not a pre-change capture.

## Screenshots
`before/` and `after/`: Home, Stats, Settings, active workout at 320, 390, 1280 px, dark and light (24 each), plus `manifest.json` (sha, base URL, theme, viewport, expected and observed `location.hash`, observed `<h1>`, bytes). The capture script refuses to save a file when the hash (the app uses HashRouter: `#/home`, `#/stats`, `#/settings`, `#/workout`) or heading does not match, so a mislabelled capture cannot be written. An earlier set of captures at c0393641 had Stats and Settings showing Home (the script navigated by path, not hash); those were deleted and retaken.
Also in `after/`: `bodyweight-{dark,light}-{320,390}.png` (the changed card), `rtl-ar-bodyweight-320.png`, `zoom200-bodyweight-320.png` (root font size 200%, no horizontal overflow; the card title wraps by letters at that size, as CardHead already did). These extras were taken before the final route-fix and are not in the manifest.

## Interaction probe (`probe.py`)
Real Chromium. Per motion setting (`probe-after-no-preference.json`, `probe-after-reduce.json`, both exit 0, `failed: []`): metric animation-name `viewfade` / `none`; Start row present; workout opens (`#/workout`); tap Set 1 done (aria-label "Set 1 done", values prefilled) persists to `gym_state_v1` in 14 ms (limit asserted 100 ms); `#timer.rest` visible and its text counts down; Finish (`.whdr-finish`) then "Finish workout early" then `button.primary` "Finish workout" adds one workout and clears `active`; the saved workout survives a reload; a clickable MetricCard focused with its signed accessible name, activated once by real CDP Enter and once by Space, focus ring solid, target at least 44 px.
Taps to log one set: 2 (Start, Set done), same as base (base set tap measured 11.6 to 14.7 ms before the change). Focus stops were not counted separately. The probe's MetricCard step needs the dev server and does not run on the base commit.

## Console and network
Capture runs (24 shots each): 2 console errors per run, both `GET /api/me` 401 (guest, no session), no JS exceptions, no failed requests. Not a zero-console run; the 401s are the app's normal signed-out probe.

## Bundle (frontend `npm run build`, Node 24.22.1)
Entry chunk: 586,454 to 587,149 bytes (+695 raw, +259 gzip) at 12f8e8d4 (reviewer measured +575 raw / +212 gzip; the entry hash includes the MetricCard import). `dist/assets` total +1,907 bytes. Final (c-head after review fixes): entry 587,167 (+713 raw), gzip 183,729 (+258), `dist/assets` 29,254,704 (+2,057).

## Suites
Full frontend: 655 files, 7855 tests, exit 0, Node 24.22.1 (Node 22 not installed here). API and MCP not rerun (untouched); baseline CI run 43498778572.
