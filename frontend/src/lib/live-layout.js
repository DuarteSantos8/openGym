// v1 of the live workout widget's layout (1.4.5 test builds): which tiles and buttons each surface
// showed, in order. Nothing writes it any more: v2 (lib/live-glance.js, S.liveWidget) follows the
// exercise and the moment by itself, and reads a v1 layout only to carry its choices over
// (migrateV1). It stays so a profile synced from a test build still loads, and an older build
// still finds what it knows. The button catalogue (ACTIONS) is still the one every surface uses.
// Was: one model for all of them. Stored in the profile as S.liveLayout, so it syncs like any setting:
//
//   { v: 1, app: { t: [{ k, s }], a: [k] }, lock: {…}, island: {…}, compact: { t }, android: {…}, widget: { t } }
//
// `t` the tiles (`k` a TILES key, `s` its size: 's', 'm' or 'l'), `a` the buttons (ACTIONS keys).
// The surfaces are the workout screen's own card (unlimited), the iPhone's Lock Screen and Dynamic
// Island (a Live Activity), Android's workout notification and the Home Screen widget's set
// logger. Each platform caps what fits; fitSurface says which tiles and buttons show and, for the
// rest, why not, so the builder can say it and every payload builder sends only what fits.
//
// normalizeLayout is the one way in: anything stored, synced or imported goes through it and comes
// out valid (known keys, allowed sizes, no doubles, at most every tile once per surface).

export const LAYOUT_VERSION = 1
export const SURFACES = ['app', 'lock', 'island', 'compact', 'android', 'widget']
export const SIZES = ['s', 'm', 'l']

// `set`: the value belongs to the set shown (it moves on with Log set on the Lock Screen too).
// `native`: drawn by the platform itself (a countdown, a clock, a bar, a picture), not as text.
// `sizes` the sizes it comes in, first the default. `no` the surfaces it cannot show on.
export const TILES = {
  ex: { label: 'Exercise', icon: 'dumbbell', set: true, sizes: ['l', 'm'] },
  still: { label: 'Exercise picture', icon: 'image', set: true, native: true, sizes: ['s', 'm'], no: ['widget'] },
  setOf: { label: 'Set {0} of {1}', labelArgs: ['x', 'y'], icon: 'list', set: true, sizes: ['m', 's'] },
  target: { label: 'Target', icon: 'target', set: true, sizes: ['m', 'l'] },
  weight: { label: 'Weight', icon: 'barbell', set: true, sizes: ['s', 'm', 'l'] },
  reps: { label: 'Reps', icon: 'repeat', set: true, sizes: ['s', 'm', 'l'] },
  effort: { label: 'Effort', icon: 'gauge', set: true, sizes: ['s', 'm'] },
  warm: { label: 'Warm-up', icon: 'sunrise', set: true, sizes: ['s', 'm'] },
  time: { label: 'Duration', icon: 'stopwatch', set: true, sizes: ['s', 'm'] },
  dist: { label: 'Distance', icon: 'figureRun', set: true, sizes: ['s', 'm'] },
  speed: { label: 'Speed', icon: 'gauge', set: true, sizes: ['s', 'm'] },
  incline: { label: 'Incline', icon: 'stairs', set: true, sizes: ['s', 'm'] },
  level: { label: 'Resistance', icon: 'slider', set: true, sizes: ['s', 'm'] },
  band: { label: 'Band', icon: 'ring', set: true, sizes: ['s', 'm'] },
  equip: { label: 'Equipment', icon: 'kettlebell', set: true, sizes: ['m', 's'] },
  partner: { label: 'Superset partner', icon: 'link', set: true, sizes: ['m', 'l'] },
  notes: { label: 'Notes', icon: 'note', set: true, sizes: ['l', 'm'] },
  pr: { label: 'Record hint', icon: 'trophy', set: true, sizes: ['l', 'm'] },
  next: { label: 'Up next', icon: 'chevronRight', set: true, sizes: ['m', 'l'] },
  // A widget line is text that waits for the next update: no countdowns there. The Lock Screen,
  // the Dynamic Island and the notification shade show the time already, so the clock is the app's.
  rest: { label: 'Rest timer', icon: 'timer', native: true, sizes: ['m', 's', 'l'], no: ['widget'] },
  elapsed: { label: 'Time since start', icon: 'clock', native: true, sizes: ['s', 'm'], no: ['widget'] },
  clock: { label: 'Clock', icon: 'clock', native: true, sizes: ['s', 'm'], no: ['lock', 'island', 'compact', 'android', 'widget'] },
  sets: { label: 'Sets', icon: 'checkCircle', sizes: ['s', 'm'] },
  progress: { label: 'Progress', icon: 'chartLine', native: true, sizes: ['l'], no: ['widget', 'compact'] },
  volume: { label: 'Volume', icon: 'chart', sizes: ['s', 'm'] },
  hr: { label: 'Heart rate', icon: 'heart', sizes: ['s', 'm'] },
  hrZone: { label: 'Heart-rate zone', icon: 'heart', sizes: ['s', 'm'] },
  kcal: { label: 'Calories', icon: 'flame', sizes: ['s', 'm'] },
  gym: { label: 'Gym', icon: 'house', sizes: ['m', 's'] },
  workout: { label: 'Workout name', icon: 'clipboard', sizes: ['m', 'l'] },
}
export const TILE_KEYS = Object.keys(TILES)

// `open`: the phone app has to come up for it (finishing asks what to save). Elsewhere a tap
// runs it in the background: an App Intent on the iPhone, a broadcast on Android.
export const ACTIONS = {
  log: { label: 'Log set', icon: 'check' },
  wDown: { label: 'Less weight', icon: 'minus', field: 'w' },
  wUp: { label: 'More weight', icon: 'plus', field: 'w' },
  rDown: { label: 'One rep less', icon: 'minus', field: 'r' },
  rUp: { label: 'One rep more', icon: 'plus', field: 'r' },
  effort: { label: 'Effort', icon: 'gauge', field: 'e' },
  warm: { label: 'Warm-up', icon: 'sunrise' },
  restAdd: { label: '+15 s', icon: 'timer' },
  restSkip: { label: 'Skip rest', icon: 'skipForward' },
  next: { label: 'Next exercise', icon: 'chevronRight' },
  prev: { label: 'Previous exercise', icon: 'chevronLeft' },
  pause: { label: 'Pause', icon: 'pause' },
  finish: { label: 'Finish', icon: 'flag', open: true },
  addSet: { label: 'Add set', icon: 'plusCircle' },
}
export const ACTION_KEYS = Object.keys(ACTIONS)
export const REST_ADD_SEC = 15

/*
 * What each surface can hold. The Lock Screen is measured in points: Apple gives a Live Activity
 * about 160 pt of height there, so the tiles are laid in rows of four columns (s one, m two, l
 * four) and the rows stop where the height runs out. The others count.
 */
export const LOCK_HEIGHT = 160
export const LOCK_PAD = 14
export const LOCK_GAP = 6
export const LOCK_COLS = 4
// Heights in points: a label over a value, the set's own words (one line), the bar, the still.
const LOCK_TILE = 34
const LOCK_OWN = { ex: 24, setOf: 20, target: 20 }
const LOCK_KIND = { progress: 6, still: 44 }
export const LOCK_ACTION_ROW = 34
export const LIMITS = {
  app: { tiles: Infinity, actions: Infinity },
  lock: { tiles: Infinity, actions: 4 },
  island: { tiles: 4, actions: 3 },
  compact: { tiles: 2, actions: 0 },
  android: { tiles: 6, actions: 3 },
  widget: { tiles: 3, actions: 0 },
}
// The Dynamic Island's pill has room for a few characters a side: a clock or a number.
export const COMPACT_KINDS = ['rest', 'elapsed', 'sets', 'hr', 'weight', 'reps', 'setOf', 'effort', 'time', 'still', 'kcal', 'hrZone']

const isObj = v => v && typeof v === 'object' && !Array.isArray(v)

/** Whether tile `k` can show on `surface` at all (size and room aside). */
export function tileAllowed (surface, k) {
  const d = TILES[k]
  if (!d || !SURFACES.includes(surface)) return false
  if (d.no && d.no.includes(surface)) return false
  if (surface === 'compact') return COMPACT_KINDS.includes(k)
  return true
}

/** Whether button `k` can be on `surface`. */
export const actionAllowed = (surface, k) => !!ACTIONS[k] && LIMITS[surface] && LIMITS[surface].actions > 0

/** The size `s` if tile `k` comes in it, else its default. */
export function sizeFor (k, s) {
  const d = TILES[k]
  if (!d) return 'm'
  return d.sizes.includes(s) ? s : d.sizes[0]
}

const T = (k, s) => ({ k, s: sizeFor(k, s) })

/** The built-in layouts. `default` is the look the surfaces had before the builder existed. */
export const PRESETS = {
  default: {
    app: { t: [], a: [] },
    lock: { t: [T('ex', 'm'), T('rest', 'm'), T('setOf', 'm'), T('target', 'm'), T('progress', 'l')], a: ['restSkip', 'next', 'log'] },
    island: { t: [T('ex', 'm'), T('rest', 'm'), T('setOf', 'm'), T('target', 'm')], a: ['restSkip', 'next', 'log'] },
    compact: { t: [T('still', 's'), T('rest', 's')] },
    android: { t: [T('ex', 'l'), T('setOf', 'm'), T('target', 'm'), T('rest', 'm'), T('progress', 'l')], a: ['log', 'restSkip', 'next'] },
    widget: { t: [] },
  },
  minimal: {
    app: { t: [T('ex', 'l'), T('target', 'm'), T('rest', 'm')], a: ['log'] },
    lock: { t: [T('ex', 'l'), T('target', 'm'), T('rest', 'm')], a: ['log'] },
    island: { t: [T('ex', 'm'), T('rest', 'm')], a: ['log'] },
    compact: { t: [T('elapsed', 's'), T('rest', 's')] },
    android: { t: [T('ex', 'l'), T('target', 'm')], a: ['log'] },
    widget: { t: [] },
  },
  lifter: {
    app: { t: [T('ex', 'l'), T('setOf', 's'), T('weight', 'm'), T('reps', 's'), T('effort', 's'), T('pr', 'l'), T('rest', 'm'), T('next', 'm')], a: ['wDown', 'wUp', 'rDown', 'rUp', 'effort', 'log', 'restAdd', 'restSkip'] },
    lock: { t: [T('ex', 'm'), T('rest', 'm'), T('weight', 'm'), T('reps', 's'), T('effort', 's')], a: ['wDown', 'wUp', 'restSkip', 'log'] },
    island: { t: [T('ex', 'm'), T('rest', 'm'), T('weight', 'm'), T('reps', 'm')], a: ['wUp', 'restSkip', 'log'] },
    compact: { t: [T('weight', 's'), T('rest', 's')] },
    android: { t: [T('ex', 'l'), T('weight', 'm'), T('reps', 'm'), T('effort', 's'), T('still', 's')], a: ['log', 'wUp', 'restSkip'] },
    widget: { t: [T('effort', 's'), T('pr', 'm')] },
  },
  cardio: {
    app: { t: [T('ex', 'l'), T('time', 'm'), T('dist', 'm'), T('speed', 's'), T('incline', 's'), T('level', 's'), T('hr', 'm'), T('hrZone', 's'), T('kcal', 's'), T('elapsed', 'm')], a: ['log', 'next', 'pause'] },
    lock: { t: [T('ex', 'm'), T('elapsed', 'm'), T('speed', 's'), T('incline', 's'), T('hr', 's'), T('hrZone', 's')], a: ['pause', 'log'] },
    island: { t: [T('ex', 'm'), T('elapsed', 'm'), T('speed', 'm'), T('hr', 'm')], a: ['log'] },
    compact: { t: [T('hr', 's'), T('elapsed', 's')] },
    android: { t: [T('ex', 'l'), T('speed', 's'), T('incline', 's'), T('hr', 's'), T('elapsed', 'm')], a: ['log', 'pause', 'next'] },
    widget: { t: [T('hr', 's'), T('speed', 's')] },
  },
  everything: null,   // filled below: every tile and button each surface allows, in catalogue order
}
PRESETS.everything = Object.fromEntries(SURFACES.map(sf => [sf, {
  t: TILE_KEYS.filter(k => tileAllowed(sf, k)).map(k => T(k)),
  ...(LIMITS[sf].actions > 0 ? { a: ACTION_KEYS.filter(k => actionAllowed(sf, k)) } : {}),
}]))
export const PRESET_IDS = ['minimal', 'lifter', 'cardio', 'everything']

function cleanSurface (sf, raw, fallback) {
  const src = isObj(raw) ? raw : fallback
  const seen = new Set()
  const t = []
  for (const x of Array.isArray(src?.t) ? src.t : []) {
    const k = typeof x === 'string' ? x : isObj(x) ? x.k : null
    if (typeof k !== 'string' || seen.has(k) || !tileAllowed(sf, k)) continue
    seen.add(k)
    t.push({ k, s: sizeFor(k, isObj(x) ? x.s : null) })
  }
  const out = { t }
  if (LIMITS[sf].actions > 0) {
    const seenA = new Set()
    out.a = (Array.isArray(src?.a) ? src.a : []).filter(k => typeof k === 'string' && actionAllowed(sf, k) && !seenA.has(k) && seenA.add(k))
  }
  return out
}

/**
 * A valid layout from whatever is stored: null or junk gives the default; v0 (a bare list of
 * tile keys, the builder's first sketch) becomes the app card's tiles; a surface missing (a newer
 * surface than the copy knows) takes the default's.
 */
export function normalizeLayout (raw) {
  let src = raw
  if (Array.isArray(raw)) src = { v: 1, app: { t: raw, a: ['log'] } }
  if (!isObj(src)) src = {}
  const out = { v: LAYOUT_VERSION }
  for (const sf of SURFACES) out[sf] = cleanSurface(sf, src[sf], PRESETS.default[sf])
  return out
}

/** The profile's layout, always valid. */
export const layoutOf = S => normalizeLayout(S && S.liveLayout)

/** A preset as a full layout (unknown id: the default). */
export const presetLayout = id => normalizeLayout(PRESETS[id] || PRESETS.default)

/** Whether a surface of `layout` is the same as the preset's (the builder marks the one in use). */
export function presetMatches (layout, id) {
  const p = presetLayout(id)
  return SURFACES.every(sf => JSON.stringify(layout[sf]) === JSON.stringify(p[sf]))
}

/* ---------- what fits ---------- */

const lockRowHeight = row => Math.max(...row.map(x => LOCK_KIND[x.k] || LOCK_OWN[x.k] || LOCK_TILE))
const lockCols = x => (x.s === 'l' ? LOCK_COLS : x.s === 'm' ? 2 : 1)

/** The Lock Screen's tiles laid in rows of four columns, in order. */
export function lockRows (tiles) {
  const rows = []
  let row = [], used = 0
  for (const x of tiles) {
    const c = lockCols(x)
    if (used + c > LOCK_COLS && row.length) { rows.push(row); row = []; used = 0 }
    row.push(x); used += c
  }
  if (row.length) rows.push(row)
  return rows
}

/**
 * What of `surface`'s list shows: `{ tiles, actions }`, each item `{ k, s?, fit, why }` in the
 * user's order. `why` is a reason key for the ones left out: 'height' (Lock Screen full),
 * 'count' (the surface's count is reached), 'buttons' (no more buttons there).
 */
export function fitSurface (surface, layout) {
  const L = normalizeLayout(layout)[surface]
  const lim = LIMITS[surface]
  const tiles = L.t.map(x => ({ ...x, fit: true, why: null }))
  const actions = (L.a || []).map(k => ({ k, fit: true, why: null }))
  actions.forEach((x, i) => { if (i >= lim.actions) { x.fit = false; x.why = 'buttons' } })
  if (surface === 'lock') {
    const shownActions = actions.some(x => x.fit)
    let budget = LOCK_HEIGHT - 2 * LOCK_PAD - (shownActions ? LOCK_ACTION_ROW + LOCK_GAP : 0)
    let first = true
    let full = false
    for (const row of lockRows(tiles)) {
      const h = lockRowHeight(row) + (first ? 0 : LOCK_GAP)
      if (full || h > budget) { full = true; row.forEach(x => { x.fit = false; x.why = 'height' }); continue }
      budget -= h
      first = false
    }
  } else {
    let n = 0
    for (const x of tiles) {
      if (n >= lim.tiles) { x.fit = false; x.why = 'count'; continue }
      // Android has one picture per notification (its large icon): a second has nowhere to go.
      n++
    }
  }
  return { tiles, actions }
}

/** Only what fits, as the payloads carry it: `{ t: [{ k, s }], a: [k] }`. */
export function shownOn (surface, layout) {
  const f = fitSurface(surface, layout)
  return { t: f.tiles.filter(x => x.fit).map(({ k, s }) => ({ k, s })), a: f.actions.filter(x => x.fit).map(x => x.k) }
}

/* ---------- editing (the builder) ---------- */

const withSurface = (layout, sf, fn) => {
  const L = normalizeLayout(layout)
  return normalizeLayout({ ...L, [sf]: fn(L[sf]) })
}
export const addTile = (layout, sf, k, s) => withSurface(layout, sf, x => ({ ...x, t: [...x.t, { k, s: sizeFor(k, s) }] }))
export const removeTile = (layout, sf, k) => withSurface(layout, sf, x => ({ ...x, t: x.t.filter(y => y.k !== k) }))
export const resizeTile = (layout, sf, k, s) => withSurface(layout, sf, x => ({ ...x, t: x.t.map(y => (y.k === k ? { k, s: sizeFor(k, s) } : y)) }))
export const addAction = (layout, sf, k) => withSurface(layout, sf, x => ({ ...x, a: [...(x.a || []), k] }))
export const removeAction = (layout, sf, k) => withSurface(layout, sf, x => ({ ...x, a: (x.a || []).filter(y => y !== k) }))
const move = (list, from, to) => {
  if (from < 0 || from >= list.length || to < 0 || to >= list.length) return list
  const next = [...list]
  const [x] = next.splice(from, 1)
  next.splice(to, 0, x)
  return next
}
export const moveTile = (layout, sf, from, to) => withSurface(layout, sf, x => ({ ...x, t: move(x.t, from, to) }))
export const moveAction = (layout, sf, from, to) => withSurface(layout, sf, x => ({ ...x, a: move(x.a || [], from, to) }))
/** One surface back to the default's. */
export const resetSurface = (layout, sf) => withSurface(layout, sf, () => PRESETS.default[sf])
