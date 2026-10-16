// The settings the global search finds: Profile's pages and the rows on them, from the index
// Profile's own search reads (views/settings-pages.js), held to the global search's matcher so a
// typo finds them too ("thme" is Theme). A row shows the setting's current value where it can be
// read without opening its page (ui-search.md §8): a boolean as the word On or Off, a choice as
// its label, nothing where no value can be read.
import { LANGS, t } from '../i18n-core.js'
import { accentLabel } from '../accent.js'
import { fmtRest } from '../duration.js'
import { effortOf } from '../history.js'
import { MONDAY, weekStartOf } from '../format.js'
import { settingOf } from '../nutrition/use-nt-settings.js'
import { PAGES, PAGE_IDS, SEARCH, pageTrail, pageVisible } from '../../views/settings-pages.js'
import { matchRecord } from './match.js'

const onOff = v => (v == null ? null : v ? t('On') : t('Off'))

// Values of the rows that are not off-by-default switches (those say it with `feature`).
const VALUES = {
  'Theme': S => ({ dark: t('Dark'), light: t('Light'), system: t('System') })[S.theme || 'dark'] || t('Dark'),
  'Accent color': S => accentLabel(S),
  'Weight unit': S => S.unit || 'kg',
  'Language': (S, c) => LANGS[c.lang] || null,
  'Rest timer': S => fmtRest(S.restSec),
  'Effort per set': S => ({ rir: 'RIR', rpe: 'RPE', none: t('Off') })[effortOf(S)] || null,
  'Layout': S => ({ list: t('List'), compact: t('Compact') })[S.workoutView] || t('Cards'),
  'Week starts on': S => (weekStartOf(S) === MONDAY ? t('Monday') : t('Sunday')),
  'Exercise animations': S => ({ mini: t('Small'), off: t('Hidden') })[S.gifSize] || t('Full'),
  'Play a sound': S => onOff(!!S.sound),
  'Vibrate': S => onOff(S.vibrate !== false),
  'Keep screen awake': S => onOff(S.keepAwake !== false),
  'Gym check-in': S => onOff(S.checkIn !== false),
  'Body weight': S => onOff(S.showWeightCard !== false),
  'Show brand names': (S, c) => (c.ntSettings ? onOff(settingOf(c.ntSettings, 'diaryShowBrands')) : null),
  'Show macro summary': (S, c) => (c.ntSettings ? onOff(settingOf(c.ntSettings, 'diaryShowMacroSummary')) : null),
  'Search Open Food Facts': (S, c) => (c.ntSettings ? onOff(settingOf(c.ntSettings, 'offEnabled')) : null),
}

/** The value a settings row shows on the right, or null. */
export function settingValue(entry, S, ctx) {
  try {
    if (VALUES[entry.title]) return VALUES[entry.title](S, ctx) ?? null
    if (entry.feature) return onOff(entry.feature(S, ctx))
  } catch { /* a value that cannot be read is not shown */ }
  return null
}

const trailOf = (page, tr) => (page == null ? tr('Profile') : [tr('Profile'), pageTrail(page, tr)].join(' › '))

/**
 * Settings results for query `words` (match.js queryWords): Profile's pages and its rows on this
 * device and profile, best first. `ctx` is what settings-pages.js's rules read (views/Settings.jsx
 * builds the same), plus `lang`. Every result carries `entry` for the route (`page`, `title`, `via`).
 */
// `all`: no query, every row (to look one up).
export function settingsResults(words, S, ctx, tr = t, { all = false } = {}) {
  const out = []
  const push = (entry, isPage) => {
    const title = tr(entry.title)
    const opts = entry.opts || []
    const aliases = [entry.kw || '', entry.title, ...opts, ...opts.map(o => tr(o)), entry.tkw ? entry.tkw() : '']
    const secondary = isPage ? [] : [pageTrail(entry.page, tr), entry.page ? PAGES[entry.page]?.title : '']
    const m = all && !words.length ? { score: 0, ranges: [], exact: false, wordPrefix: false } : matchRecord(words, { title, aliases, secondary })
    if (!m) return
    const id = (entry.page || 'root') + ':' + entry.title
    out.push({
      type: 'setting',
      id,
      // The row's identity (its DOM id, its React key, how often it was opened) like every result's.
      key: 'setting:' + id,
      title,
      ranges: m.ranges,
      subtitle: isPage ? tr('Profile') : trailOf(entry.page, tr),
      media: { kind: 'glyph', glyph: entry.icon || (entry.page ? PAGES[entry.page]?.icon : 'gear') || 'gear' },
      frecency: 0,
      value: isPage ? null : settingValue(entry, S, ctx),
      score: m.score, exact: m.exact, wordPrefix: m.wordPrefix,
      entry: { page: entry.page, title: entry.title, via: entry.via || null, isPage, sheet: !!(isPage && PAGES[entry.page]?.sheet), to: isPage ? PAGES[entry.page]?.to || null : null },
    })
  }
  for (const id of PAGE_IDS) {
    if (pageVisible(id, ctx)) push({ page: id, title: PAGES[id].title, icon: PAGES[id].icon, kw: PAGES[id].kw }, true)
  }
  for (const e of SEARCH) {
    if (!pageVisible(e.page, ctx) || (e.when && !e.when(ctx))) continue
    push(e, false)
  }
  return out.sort((a, b) => b.score - a.score)
}

/** Every settings title, for "Did you mean". */
export const settingTitles = (tr = t) => [...PAGE_IDS.map(id => tr(PAGES[id].title)), ...SEARCH.map(e => tr(e.title))]
