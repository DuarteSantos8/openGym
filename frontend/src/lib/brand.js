// The app's name as people see it. This fork is Ironvane, based on openGym (AGPL v3).
//
// Only what people read changes. Everything that is data stays openGym: storage keys, backup and
// CSV formats, the FIT file's product name, the backup folder on the phone (Documents/openGym),
// API routes and history state. So a backup, an export or a server from either app still opens.
//
// The translations keep saying "openGym"; brandText() swaps the name on the way out of t(), in
// every language at once. It leaves alone the names that are not this app's to change:
//   - apps openGym publishes on its own: openGym Offline, openGym for Garmin / Wear OS;
//   - "openGym animation(s)": the exercise media are licensed to openGym (catalogue/media/NOTICE.md);
//   - a path such as Documents/openGym/ or DOCUMENTS/openGym/;
//   - "based on openGym", the credit;
//   - whole strings in KEEP_KEYS, such as "openGym green", the accent named after the old logo.
export const APP_NAME = 'Ironvane'
export const UPSTREAM_NAME = 'openGym'

/** Source strings shown as translated, name and all (i18n-core t() checks the key). */
export const KEEP_KEYS = new Set([
  'openGym green',
  // These point at openGym itself: its author's donation pages, its store listings, and the
  // in-app updater, which downloads openGym's own releases. Ironvane must not borrow them.
  'Support openGym',
  'openGym is free: no ads, no subscriptions, no tracking. A coffee keeps it that way.',
  'Rate openGym on the App Store',
  'Rate openGym on Google Play',
  'Update to openGym v{0}',
])

// Where this build's source is (AGPL v3 §13: people using a modified version over a network are
// offered its source). openGym's own repository is credited as "Based on openGym".
export const SOURCE_URL = 'https://github.com/sorensadrgit-art/openGym'
export const UPSTREAM_URL = 'https://github.com/DuarteSantos8/openGym'

const KEEP_AFTER = /^(?: Offline| for Garmin| for Wear OS| Garmin| animation| [Aa]nimatie| [Aa]nimation|\/)/
const KEEP_BEFORE = /(?:[Bb]ased on |\/)$/

/** The visible text with the app's own name as Ironvane; the exceptions above stay openGym. */
export function brandText(s) {
  if (typeof s !== 'string' || !s.includes(UPSTREAM_NAME)) return s
  let out = ''
  let i = 0
  for (;;) {
    const j = s.indexOf(UPSTREAM_NAME, i)
    if (j < 0) return out + s.slice(i)
    const end = j + UPSTREAM_NAME.length
    const keep = KEEP_AFTER.test(s.slice(end)) || KEEP_BEFORE.test(s.slice(0, j)) || /[A-Za-z0-9_]/.test(s[end] || '')
    out += s.slice(i, j) + (keep ? UPSTREAM_NAME : APP_NAME)
    i = end
  }
}
