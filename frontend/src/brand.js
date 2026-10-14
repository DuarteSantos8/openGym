// The one place the app's identity lives, so the fork's rename touches this file and not the
// upstream sources. Upstream's strings and locale packs still say "openGym" (~1,350 times);
// i18n-core.js t() swaps UPSTREAM_NAME for BRAND.name on the way out, so every language shows the
// new name without a single locale file being edited and upstream rebases stay cheap.
//
// index.html, public/manifest.json and public/sw.js repeat the name and colour as plain text,
// because they are read before any script runs.

export const BRAND = {
  name: 'Gains',
  shortName: 'Gains',
  // Gains' own version, shown to users. __APP_VERSION__ is upstream's and stays for the service
  // worker, update checks and support templates; it only appears on Licences as the base version.
  version: '0.1.0',
  // Status bar and browser chrome: the page background (index.css --bg) of each theme.
  themeColor: { dark: '#0c0b0a', light: '#f5f4f1' },
  // Where the app is, for the printed footers (no upstream domain).
  url: 'https://github.com/steradrian/gains',
}

// What upstream calls itself in every source string and locale pack.
export const UPSTREAM_NAME = 'openGym'

export const LINKS = {
  // Legal wording, so it is not translated.
  copyright: ['Copyright © 2026 Duarte Santos (openGym)', 'Modifications © 2026 steradrian'],
  // AGPL-3.0 section 13: where the corresponding source of this build is.
  source: [
    { label: 'Gains (training)', url: 'https://github.com/steradrian/gains' },
    { label: 'NutriTrace (nutrition)', url: 'https://github.com/steradrian/gains-nutrition' },
  ],
  upstream: {
    name: UPSTREAM_NAME,
    author: 'Duarte Santos',
    url: 'https://github.com/DuarteSantos8/openGym',
    notice: 'https://github.com/steradrian/gains/blob/main/NOTICE.md',
    license: 'https://www.gnu.org/licenses/agpl-3.0.html',
  },
  media: { name: 'Gym visual', url: 'https://gymvisual.com/' },
  muscleMap: { name: 'MuscleMap', url: 'https://github.com/melihcolpan/MuscleMap' },
  exerciseDb: { name: 'ExerciseDB v1', url: 'https://exercisedb.dev/' },
  lucide: { name: 'Lucide', url: 'https://lucide.dev/license' },
}

// English "an openGym" must become "a Gains": the article follows the new name's first sound.
const ARTICLE = /^[aeiou]/i.test(BRAND.name) ? 'an' : 'a'
const AN_UPSTREAM = new RegExp(`\\b([Aa])n ${UPSTREAM_NAME}`, 'g')
// A name after a slash is a path or a URL (Documents/openGym is a real folder on the phone), not prose.
const UPSTREAM_PROSE = new RegExp(`(?<!/)${UPSTREAM_NAME}`, 'g')
// "openGym's" -> "Gains'" when the name ends in s, "Name's" otherwise.
const POSSESSIVE = new RegExp(`(?<!/)${UPSTREAM_NAME}(['’])s\\b`, 'g')
const ENDS_IN_S = /s$/i.test(BRAND.name)

// t() runs on every render, so each distinct string is rewritten once.
const cache = new Map()

/** `s` with upstream's name replaced by the brand name, in prose only. */
export const brandText = s => {
  if (typeof s !== 'string' || !s.includes(UPSTREAM_NAME)) return s
  let out = cache.get(s)
  if (out === undefined) {
    out = s
      .replace(AN_UPSTREAM, (_, a) => `${a}${ARTICLE === 'an' ? 'n' : ''} ${UPSTREAM_NAME}`)
      .replace(POSSESSIVE, (_, q) => BRAND.name + (ENDS_IN_S ? q : q + 's'))
      .replace(UPSTREAM_PROSE, BRAND.name)
    cache.set(s, out)
  }
  return out
}
