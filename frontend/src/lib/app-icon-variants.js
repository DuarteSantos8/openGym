// The home-screen icons a phone can switch to (Settings → Look & Home → App icon). Plain data, no
// imports: scripts/app-icons.mjs draws every icon file from this list and the settings row lists
// the same ids, so the picker can never offer an icon the native projects do not have.
//
// `name` is the English key the row passes to t(). `ios` is the AppIcon set in the asset catalog
// (null: the primary icon) and `android` the activity-alias in AndroidManifest.xml. `art` is a
// hand-made SVG the script renders instead of the glyph; `bg`/`fg` are then just its main colours.
export const APP_ICON_VARIANTS = [
  { id: 'default', name: 'Original', bg: '#0c0e12', fg: '#a3e635', ios: null, android: 'IconDefault' },
  { id: 'light', name: 'Light', bg: '#ffffff', fg: '#65a30d', ios: 'AppIcon-Light', android: 'IconLight' },
  { id: 'mono', name: 'Mono', bg: '#0c0e12', fg: '#f2f2f7', ios: 'AppIcon-Mono', android: 'IconMono' },
  { id: 'neon', name: 'Green', bg: '#a3e635', fg: '#0c0e12', ios: 'AppIcon-Neon', android: 'IconNeon' },
  { id: 'sky', name: 'Blue', bg: '#0a84ff', fg: '#ffffff', ios: 'AppIcon-Sky', android: 'IconSky' },
  { id: 'orange', name: 'Orange', bg: '#ff9f0a', fg: '#0c0e12', ios: 'AppIcon-Orange', android: 'IconOrange' },
  { id: 'pink', name: 'Pink', bg: '#ff375f', fg: '#ffffff', ios: 'AppIcon-Pink', android: 'IconPink' },
  { id: 'violet', name: 'Purple', bg: '#bf5af2', fg: '#ffffff', ios: 'AppIcon-Violet', android: 'IconViolet' },
  // All year, Halloween theme or not: some people are spooky in March.
  { id: 'halloween', name: 'Halloween', bg: '#0d0517', fg: '#ff7a1a', art: 'resources/icons/halloween.svg', ios: 'AppIcon-Halloween', android: 'IconHalloween' },
  // Christmas 2026: the advent calendar's present on 12 December 2026 (door 12, PRESENTS in the theme),
  // only for whoever opened that door, and theirs to keep all year (`prize`, S.prizes). One already
  // on the home screen stays offered. The native projects carry it in every build.
  { id: 'christmas', name: 'Christmas', bg: '#070b16', fg: '#a3e635', art: 'resources/icons/christmas.svg', ios: 'AppIcon-Christmas', android: 'IconChristmas', prize: 'xmas-icon-2026' },
]

export const APP_ICON_IDS = APP_ICON_VARIANTS.map(v => v.id)

/** The icons the picker offers: all but a seasonal one out of its months and a present not given
 *  (`prizes`, S.prizes, lib/prizes.js), unless it is the one on the home screen. */
export const offeredIcons = (now, current, prizes = []) => APP_ICON_VARIANTS.filter(v =>
  v.id === current || ((!v.months || v.months.includes(now.getMonth() + 1)) && (!v.prize || (Array.isArray(prizes) && prizes.includes(v.prize)))))
