# EP-02 evidence

Synthetic guest profile (one routine, 4 workouts, 3 weigh-ins), Vite dev server only (no API running, so `/api/*` returns 502 from the dev proxy), Chromium through browser-harness. Exercise media URLs were blocked, so no media appears. `before/` is `origin/next/integration` bd1ab806 built from a separate worktree; `after/` is this branch.

- `before/`, `after/`: Home, Stats, Settings, active workout at 320, 390, 1280 px, dark and light (24 each).
- `after/bodyweight-*`: the changed card at 320 and 390, dark and light.
- `after/rtl-ar-bodyweight-320.png`: Arabic (dir=rtl). `after/zoom200-bodyweight-320.png`: root font size 200% at 320 px (no horizontal overflow; the card title wraps by letters, as CardHead already did, not changed here).
- The "before" captures were taken after the code was written, from the untouched base commit. The order differs from the brief's "before any source change".

## Taps to log a set
1 tap ("Set 1 done" button, weight and reps prefilled). Unchanged: no workout file was touched. Click to stored-state time, median of 3 runs in a 390 px viewport: base 14.4 ms, branch 16.3 ms (motion allowed), 13.4 ms (prefers-reduced-motion). Within noise. The rest timer element was not detected by that probe (`#timer` selector), so rest-timer timing is covered only by unit tests, not measured here.

## Console and network
Home, Stats, Settings, Home: 3 errors, all `GET /api/config` or `/api/me` returning 502 (no API started). No JS exceptions.

## Bundle (frontend `npm run build`, Node 24 locally)
Entry chunk `index-*.js`: 586,454 to 587,149 bytes (+695 raw, +259 gzip: 183,471 to 183,730). `dist/assets` total 29,252,647 to 29,254,554 (+1,907).
