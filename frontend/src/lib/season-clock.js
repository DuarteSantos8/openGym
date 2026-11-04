// The clock the seasonal themes and the advent calendar read (lib/seasonal.js, lib/advent.js,
// seasonal/). In every real build it is simply `new Date()`, the device's own local time.
//
// QA hook, for testing December in November and for the screenshot builds. It exists only:
//   - on the dev server (`npm run dev`, import.meta.env.DEV), and
//   - in a build made with VITE_SEASON_CLOCK=1 (`VITE_SEASON_CLOCK=1 VITE_DEMO=1 npx vite build`),
//     which no release, CI, Docker or store build sets.
// Both are replaced by `false` at build time (vite.config.js defines __SEASON_CLOCK__), so in a
// production bundle the branch below and the function it calls are dropped: there is no query
// parameter or storage key that can move the clock. season-clock.build.test.js builds this file
// for production and checks the hook is gone; CI also scans the real dist (scripts/check-season-clock.mjs).
//
// How to use it where it exists: open the app with ?season-date=2026-12-14 (a local date, an
// optional THH:MM after it), which is remembered in localStorage (og_season_clock) until
// ?season-date=off. The fake day keeps the real time of day ticking.

/* global __SEASON_CLOCK__ */
const HOOK = (import.meta.env && import.meta.env.DEV) || (typeof __SEASON_CLOCK__ !== 'undefined' && __SEASON_CLOCK__ === true)

/** Now, as the seasonal code sees it. */
export function seasonNow() {
  if (HOOK) {
    const fake = fakeSeasonDate()
    if (fake) return fake
  }
  return new Date()
}

function fakeSeasonDate() {
  try {
    const KEY = 'og_season_clock'
    const q = new URLSearchParams(globalThis.location?.search || '').get('season-date')
    if (q === 'off') localStorage.removeItem(KEY)
    else if (q) localStorage.setItem(KEY, q)
    const v = localStorage.getItem(KEY)
    const m = v && /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(v)
    if (!m) return null
    const real = new Date()
    const d = new Date(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : real.getHours(), m[5] ? +m[5] : real.getMinutes(), real.getSeconds())
    return Number.isNaN(d.getTime()) ? null : d
  } catch (e) { return null }
}
