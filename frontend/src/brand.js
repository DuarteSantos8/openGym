// The one place the app's identity lives.
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

export const LINKS = {
  // Legal wording, so it is not translated.
  copyright: ['Copyright © 2026 Duarte Santos (openGym)', 'Modifications © 2026 steradrian'],
  // AGPL-3.0 section 13: where the corresponding source of this build is.
  source: [
    { label: 'Gains (training)', url: 'https://github.com/steradrian/gains' },
    { label: 'NutriTrace (nutrition)', url: 'https://github.com/steradrian/gains-nutrition' },
  ],
  upstream: {
    name: 'openGym',
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
