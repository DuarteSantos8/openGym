// The app's name as people see it. This fork is Ironvane, based on openGym (AGPL v3).
//
// Only what people read changes. Everything that is data stays openGym: storage keys, backup and
// CSV formats, the FIT file's product name, the backup folder on the phone (Documents/openGym),
// API routes and history state. So a backup, an export or a server from either app still opens.
//
// The translations keep saying "openGym"; brandText() swaps the name on the way out of t(), in
// every language at once. It leaves alone the names that are not this app's to change:
//   - apps still published as openGym: openGym Offline and the watch apps (Garmin, Wear OS,
//     Apple Watch, Zepp OS), so an instruction to find one names it as it is listed;
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
  // The credit, in every language (the translation does not say "Based on").
  'Based on openGym',
  // The watch apps are still published as openGym, so instructions to find them say so.
  'Get openGym for Garmin',
  'openGym isn’t on it yet',
  'openGym is on your Garmin. Sets you log on the wrist land here.',
  'openGym is on your Garmin. It catches up as soon as the watch is in reach.',
  'Your Garmin is here, openGym isn’t on it yet. Get it, then open it once on the watch.',
  'Start a workout on the phone and your Garmin asks to open openGym.',
  'Get openGym for Wear OS',
  'Your watch is here, openGym isn’t on it yet. On the watch, open the Play Store and install openGym from “Apps on your phone”.',
  'openGym is on your watch and in reach. Sets you log on the wrist land here.',
  'openGym is on your watch, but the watch is out of reach right now. Sets you log on it wait there and land here once it is back.',
  'No Apple Watch is paired with this iPhone. Pair one in the Watch app, then install openGym on it there.',
  'openGym is not on your Apple Watch yet. Open the Watch app on this iPhone, find openGym under Available Apps and tap Install.',
  'openGym is not on your Apple Watch yet. Install it in the Watch app.',
  'openGym is on your Apple Watch',
  'The watch hasn’t checked in yet. Open openGym on it once.',
  'Start a workout on the phone and openGym pops up on your wrist.',
  'In the Zepp app, open the openGym watch app’s settings and type in this address and code. The code lasts ten minutes.',
  'openGym isn’t in the Zepp App Store yet. Until it is, the watch app goes on through the Zepp app’s developer mode. The guide walks you through it.',
  // The exercise media are licensed to openGym (catalogue/media/NOTICE.md).
  'It is mine to share. I made it, recorded it or may pass it on, and it is not an openGym animation.',
  'openGym animation or other licensed stuff',
  // openNutrition's own button is labelled "Link openGym".
  'In openNutrition: Settings, Connected apps, Link openGym. Type the code it shows, or paste a token with summary access. The token stays on this device.',
])

/** openGym Offline is its own app, published under that name: every string about it keeps it. */
export const keepsName = key => KEEP_KEYS.has(key) || (typeof key === 'string' && key.includes('openGym Offline'))

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
