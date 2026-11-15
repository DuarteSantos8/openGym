// Settings > Workout > Live widget: what a switch that is on but shows nowhere says about itself,
// and the moment the preview jumps to when a switch is flipped. Both come from the real thing:
// the sample moments run through glanceView for the surfaces this phone has, so a note is never a
// guess from a formula (the old "No room" notes counted buttons that were not even drawn).
import { t } from './i18n.js'
import { glanceView, islandChips, workButtons } from './live-glance.js'
import { sampleLive } from './live-samples.js'
import { recordHintsOn } from './set-records.js'

export const KIND_SAMPLE = { lift: 'strength', band: 'band', hold: 'hold', cardio: 'cardio', carry: 'carry' }
const STEP_KEYS = ['wDown', 'wUp', 'rDown', 'rUp']

/**
 * The surfaces a note has to answer for. A phone: its own (the island only when it has one). The
 * web, which shows them all as a showcase: the tab in view, with the Lock Screen beside the island
 * so "Lock Screen only" can be told from "no room".
 */
export function noteSurfaces ({ os = null, island = false, surface = 'lock' } = {}) {
  if (os === 'android') return ['android']
  if (os === 'ios') return island ? ['lock', 'island'] : ['lock']
  return surface === 'android' ? ['android'] : surface === 'island' ? ['lock', 'island'] : ['lock']
}

/** The platform the rows describe: the phone's own, or on the web the one the tab in view belongs to. */
export const rowPlatform = (os, surface) => os || (surface === 'android' ? 'android' : 'ios')

function viewsOf (S, G, sample, surfaces, now) {
  let live = null
  try { live = sampleLive(S, sample, { glance: G, now }) } catch { live = null }
  if (!live) return null
  // `all`: with endless room (no surface trims its row), so "not drawn at all" and "cut" differ.
  const out = { live, all: glanceView(live.attributes, live.state, 'app', now) }
  for (const sf of surfaces) out[sf] = glanceView(live.attributes, live.state, sf, now)
  return out
}

// Whether button `k` is drawn on a surface: in its row, or as a − + pair beside its number.
const drawn = (view, k) => !!view && (view.buttons.includes(k) || (STEP_KEYS.includes(k) && view.steps.length === 2))

/** Why a button that would be drawn with endless room is missing, or null when it shows everywhere. */
function roomNote (views, k) {
  if (!views || !drawn(views.all, k)) return null
  if (views.android) return drawn(views.android, k) ? null : t('No room on the notification.')
  if (!drawn(views.lock, k)) return t('No room on the Lock Screen.')
  if (views.island && !drawn(views.island, k)) return t('Lock Screen only.')
  return null
}

const chipsOn = (view, island) => (island ? islandChips(view) : view.chips).map(c => c.k)
/** The same for a chip (heart rate, calories, effort): cut for room, or kept off the island. */
function chipNote (views, keys) {
  if (!views) return null
  // Not in the payload at all (no heart rate source, nothing rated yet): room is not the reason.
  const st = views.live.state, cur = st.cur || {}
  const carried = (cur.ck || []).some(k => keys.includes(k) && cur.tv?.[k]) || (st.g?.sx || []).some(k => keys.includes(k) && st.tv?.[k])
  if (!carried) return null
  const has = (view, island) => chipsOn(view, island).some(k => keys.includes(k))
  if (views.android) return has(views.android) ? null : t('No room right now.')
  if (!has(views.lock)) return t('No room right now.')
  if (views.island && !has(views.island, true)) return t('Lock Screen only.')
  return null
}

/**
 * For each switch of the main page that is on: the note that replaces its subtitle when the widget
 * cannot show it right now, or null when it shows (or is off, or a kind's own setup overrides it).
 * `os` 'ios' | 'android' | null (web), `island` the iPhone has one, `surface` the preview tab.
 */
export function optionNotes (S, G, { os = null, island = false, surface = 'lock', now = Date.now() } = {}) {
  const surfaces = noteSurfaces({ os, island, surface })
  const set = viewsOf(S, G, 'strength', surfaces, now)
  const rest = viewsOf(S, G, 'rest', surfaces, now)
  const out = { adjust: null, nextEx: null, pause: null, effort: null, record: null, picture: null, heart: null, calories: null, elapsed: null, next: null, addRest: null }
  if (!set) return out
  // Strength with its own setup ignores these switches: the footer says so, a note would mislead.
  const own = !!G.kinds.lift
  const android = surfaces[0] === 'android'
  if (!own) {
    if (G.buttons.adjust) out.adjust = roomNote(set, 'wUp') || roomNote(set, 'rUp')
    // Android's Less weight and More weight are the whole point there (the row says so itself).
    if (android) out.adjust = null
    if (G.buttons.nextEx) out.nextEx = roomNote(set, 'next')
    if (G.buttons.pause) out.pause = roomNote(set, 'pause')
    // With the effort button there, the button says it ("RIR 2") and no chip is owed.
    if (G.show.effort && !drawn(set.all, 'effort')) out.effort = chipNote(set, ['effort', 'effortLast'])
    if (G.show.record && recordHintsOn(S) && !android) {
      const lock = set.lock
      out.record = G.look === 'clean' ? t('Only in the detailed look.')
        : lock && (lock.still || lock.steps.length) ? t('Hidden while the picture or the − and + buttons are showing.')
          : surface === 'island' && surfaces.includes('island') ? t('Lock Screen only.') : null
    }
  }
  if (G.show.heart) out.heart = chipNote(set, ['hr'])
  if (G.show.calories) out.calories = chipNote(set, ['kcal'])
  if (G.buttons.addRest && rest && !android) out.addRest = roomNote(rest, 'restAdd')
  return out
}

const SET_ONLY = ['adjust', 'nextEx', 'pause', 'effort', 'record', 'picture']
const REST_ONLY = ['next', 'addRest']
const NOT_DONE = ['heart', 'calories', 'look']
/**
 * The moment the preview goes to when option `k` is flipped while `sample` is in view, or null to
 * stay: never away from "Your workout", never to another surface.
 */
export function jumpFor (k, sample) {
  if (sample === 'live') return null
  if (SET_ONLY.includes(k)) return sample === 'strength' ? null : 'strength'
  if (REST_ONLY.includes(k)) return sample === 'rest' ? null : 'rest'
  if (NOT_DONE.includes(k)) return sample === 'done' ? 'strength' : null
  return null
}

/**
 * Where each picked button of `kind` fits (Per exercise type), from the real view of the kind's
 * sample: `{ k: note | null }`. A button that is not drawn for another reason (no effort scale,
 * no exercise after this one) gets no room note: room is not what it waits for.
 */
export function kindButtonNotes (S, G, kind, { os = null, island = true, sample = KIND_SAMPLE[kind], now = Date.now() } = {}) {
  const surfaces = os === 'android' ? ['android'] : island ? ['lock', 'island'] : ['lock']
  const views = viewsOf(S, G, sample, surfaces, now)
  const out = {}
  for (const k of workButtons(G, kind)) if (k !== 'log') out[k] = roomNote(views, k)
  return out
}

/**
 * Per exercise type: the record hint is picked for `kind`, but the Lock Screen gives its line to
 * the picture or the − and + buttons while they show. The note for that, or null.
 */
export function kindRecordNote (S, G, kind, { os = null, sample = KIND_SAMPLE[kind], now = Date.now() } = {}) {
  if (os === 'android') return null
  const lock = viewsOf(S, G, sample, ['lock'], now)?.lock
  return lock && (lock.still || lock.steps.length) ? t('Hidden while the picture or the − and + buttons are showing.') : null
}
