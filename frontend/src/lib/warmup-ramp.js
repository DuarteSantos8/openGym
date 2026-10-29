// Warm-ups that build themselves (#156) and warm-ups you keep in a routine (#525).
//
// Three places decide an exercise's warm-up block, the most specific first:
//
//   cfg.warmup        the routine slot's own choice: 'auto' (the generator below), 'own' (the
//                     rows in cfg.warmupRows) or 'none'. Written only when chosen.
//   cfg.warmupSets    the older "number of ramp sets" (history.js buildSets halves the gap per
//                     set). A slot that has one keeps it exactly as before.
//   S.warmupAuto      Settings → Workout: 'off' (the default, nothing changes), 'compounds' or
//                     'all'. What every slot without a choice of its own follows.
//
// The generator ramps by load, the way a coach would write it on a whiteboard: a heavy squat gets
// the bar for ten and three climbing sets, a medium press two, a light curl one, a 6 kg raise
// none, and a pull-up none until you hang weight on it. Every rung is rounded DOWN to something
// the active gym can actually load (its plates, its dumbbells, the machine's stack, else the
// exercise's step: plates.js dropGrid), never under the bar and never as heavy as the work set.
//
// A generated row remembers the rung it came from (`wp` percent, `wb` the bare bar), so when the
// work weight moves the open rungs move with it (history.js rerampWarmups) and a block saved as
// your own scales with your progress instead of freezing at the day you saved it.
import { modeOf, isBw, isPerSide } from './history.js'
import { isWarmupRow, makeSideSet } from './workout-model.js'
import { exerciseOf, isAssisted } from './exercises.js'
import { rungWeight } from './warmup-snap.js'

export const WARMUP_AUTO = ['off', 'compounds', 'all']
export const WARMUP_MODES = ['auto', 'own', 'none']
/** The most rows a block of your own may hold, the same ceiling as the ramp-set stepper. */
export const MAX_OWN_WARMUPS = 5
export const OWN_PCT_MIN = 5
export const OWN_PCT_MAX = 95
export const OWN_REPS_MAX = 30

const LB_KG = 0.45359237

/** Settings → Workout → Warm-ups, read safely: anything unknown is off. */
export const warmupAutoOf = S => (S?.warmupAuto === 'compounds' || S?.warmupAuto === 'all' ? S.warmupAuto : 'off')

/** The slot's own choice, or null when it follows the setting. */
export const warmupModeOf = cfg => (WARMUP_MODES.includes(cfg?.warmup) ? cfg.warmup : null)

// Lifts that move several joints under load. Read off the name, because the catalogue has no
// such field; the isolation words win, so a "leg extension" or a "calf press" is not a squat.
const COMPOUND = /squat|deadlift|\bpress\b|\brow\b|rowing|pull-?up|chin-?up|\bdips?\b|lunge|clean|snatch|jerk|thrust|good ?morning|step-?up|push-?up|leg press|hack|rack pull|pulldown|pull-down|swing|carry|floor press|landmine/i
const ISOLATION = /curl|extension|raise|\bfly\b|flye|kickback|shrug|calf|crunch|pullover|pushdown|push-down|face pull|wrist|adduct|abduct|lateral|stretch|twist|\bsit-?up/i
const SOFT_CATS = new Set(['stretching', 'mobility', 'yoga', 'pilates', 'cardio', 'rehab'])

/** Whether an exercise is a compound lift, for "Auto for compounds". */
export function isCompoundEx(idOrCfg) {
  const ex = exerciseOf(typeof idOrCfg === 'string' ? idOrCfg : idOrCfg?.id)
  if (!ex) return false
  if (SOFT_CATS.has(ex.cat) || ex.bp === 'cardio') return false
  const n = String(ex.n || '')
  return COMPOUND.test(n) && !ISOLATION.test(n)
}

const clampInt = (v, lo, hi) => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null
}

/** One saved row, cleaned: `{ wb: true, r }` for the bare bar, else `{ wp, r }`. Null for junk. */
export function cleanOwnRow(row) {
  if (!row || typeof row !== 'object') return null
  const r = clampInt(row.r, 1, OWN_REPS_MAX)
  if (r == null) return null
  if (row.wb === true) return { wb: true, r }
  const wp = Number(row.wp)
  if (!Number.isFinite(wp)) return null
  // 0 is the body alone on a weighted bodyweight lift; anything else sits in the usual range.
  if (wp === 0) return { wp: 0, r }
  const pct = Math.min(OWN_PCT_MAX, Math.max(OWN_PCT_MIN, Math.round(wp)))
  return { wp: pct, r }
}

/** A slot's saved block, cleaned and in order. */
export const ownRowsOf = cfg => (Array.isArray(cfg?.warmupRows) ? cfg.warmupRows : [])
  .map(cleanOwnRow).filter(Boolean).slice(0, MAX_OWN_WARMUPS)

/**
 * Where an exercise's warm-ups come from: `{ kind: 'auto' | 'own' | 'count' | 'none', rows? }`.
 * 'count' is the older ramp-set number (history.js buildSets builds it as it always has).
 * Cardio, rest-pause (it builds its own warm-up row) and a timed hold have no generated block.
 */
export function warmupSource(S, cfg) {
  const mode = modeOf(cfg)
  if (mode === 'cardio' || cfg?.intensifier?.type === 'restpause') return { kind: 'none' }
  const own = warmupModeOf(cfg)
  if (own === 'none') return { kind: 'none' }
  if (own === 'own') {
    const rows = ownRowsOf(cfg)
    return rows.length ? { kind: 'own', rows } : { kind: 'none' }
  }
  if (own === 'auto') return mode === 'reps' ? { kind: 'auto' } : { kind: 'none' }
  if ((Math.round(cfg?.warmupSets) || 0) > 0) return { kind: 'count' }
  if (mode !== 'reps') return { kind: 'none' }
  const setting = warmupAutoOf(S)
  if (setting === 'all' || (setting === 'compounds' && isCompoundEx(cfg))) return { kind: 'auto' }
  return { kind: 'none' }
}

/**
 * The generator's rungs for a work weight: `[{ wp | wb, r }]`, lightest first, before rounding.
 * `kg` is the work weight in kilograms (the thresholds are a lifter's, not a unit's), `bar` the
 * bar's weight in the same unit as the work weight (0 without one).
 *
 *   compound, 60 kg and up     bar × 10, 40% × 5, 60% × 3, 80% × 1   (no bar: 40% × 8, 60% × 4, 80% × 1)
 *   compound, 30 to 60 kg      bar × 10, 70% × 3                       (no bar: 50% × 8, 75% × 3)
 *   compound, under 30 kg      bar × 10, or 50% × 8
 *   isolation, 40 kg and up    50% × 10, 75% × 4
 *   isolation, 10 to 40 kg     50% × 10
 *   isolation, under 10 kg     nothing
 *   weighted bodyweight        the body alone × 5, then 60% × 3 from 10 kg added
 *   bodyweight, assisted, 0    nothing
 */
export function autoRungs({ work, kg, bar = 0, compound = false, bw = false, assisted = false }) {
  if (!(work > 0) || assisted) return []
  if (bw) return kg >= 10 ? [{ wp: 0, r: 5 }, { wp: 60, r: 3 }] : [{ wp: 0, r: 5 }]
  const hasBar = bar > 0 && bar < work
  if (compound) {
    if (kg >= 60) return hasBar ? [{ wb: true, r: 10 }, { wp: 40, r: 5 }, { wp: 60, r: 3 }, { wp: 80, r: 1 }] : [{ wp: 40, r: 8 }, { wp: 60, r: 4 }, { wp: 80, r: 1 }]
    if (kg >= 30) return hasBar ? [{ wb: true, r: 10 }, { wp: 70, r: 3 }] : [{ wp: 50, r: 8 }, { wp: 75, r: 3 }]
    return hasBar ? [{ wb: true, r: 10 }] : [{ wp: 50, r: 8 }]
  }
  if (kg >= 40) return [{ wp: 50, r: 10 }, { wp: 75, r: 4 }]
  if (kg >= 10) return [{ wp: 50, r: 10 }]
  return []
}

/**
 * The rungs turned into set rows on real weights, for a work weight of `work`. A rung that rounds
 * onto the one before it, or up to the work weight, is left out: two identical warm-ups are one
 * warm-up, and a warm-up at the work weight is a work set. A per-side lift gets L/R rows with the
 * rung's reps on each side. `grid` and `floor` as warmup-snap.js reads them.
 */
export function rungRows(rungs, { work, grid, floor = 0, perSide = false }) {
  const out = []
  let last = -1
  for (const rung of rungs) {
    const w = rungWeight(rung, work, grid, floor)
    const body = rung.wp === 0 && !rung.wb
    if (!body && (!(w > 0) || w >= work)) continue
    if (w <= last) continue
    last = w
    const row = { w, r: rung.r, done: false, phase: 'warmup', warmup: true, ...(rung.wb ? { wb: true } : { wp: rung.wp }) }
    out.push(perSide ? makeSideSet({ ...row, r: rung.r * 2 }) : row)
  }
  return out
}

/** The first work row's load: the heavier side on a per-side row. */
export const workLoadOf = rows => {
  const row = (rows || []).find(r => !isWarmupRow(r))
  return row ? Number(row.w) || 0 : 0
}

/**
 * The generated (or saved) warm-up block for one exercise, ready to put in front of its work rows,
 * or null when the source is 'count' or 'none' (history.js builds those as before). `unit` is the
 * unit the rows are in; `grid` and `floor` the active gym's loading (plates.js dropGrid, barFloor).
 */
export function warmupBlock(S, cfg, rows, { grid, floor = 0, unit = 'kg' } = {}) {
  const source = warmupSource(S, cfg)
  if (source.kind !== 'auto' && source.kind !== 'own') return null
  const work = workLoadOf(rows)
  if (!(work > 0)) return []
  const perSide = isPerSide(cfg)
  if (source.kind === 'own') return rungRows(source.rows, { work, grid, floor, perSide })
  const kg = unit === 'lb' ? work * LB_KG : work
  // A dip belt or a vest ("weighted" equipment) adds load to the body, so it warms up like a
  // loaded bodyweight lift: the body alone first.
  const bw = isBw(cfg) || exerciseOf(cfg?.id)?.eq === 'weighted'
  const rungs = autoRungs({ work, kg, bar: floor, compound: isCompoundEx(cfg), bw, assisted: isAssisted(cfg) })
  return rungRows(rungs, { work, grid, floor, perSide })
}

/**
 * `rows` with the warm-up block a generated or saved source asks for in front of the work rows,
 * replacing whatever warm-ups they had. Unchanged for every other source.
 */
export function withWarmupBlock(S, cfg, rows, opts) {
  const block = warmupBlock(S, cfg, rows, opts)
  if (block == null) return rows
  return [...block, ...rows.filter(r => !isWarmupRow(r))]
}

/**
 * Today's warm-up rows as a block of your own: each row as a percent of the first work weight
 * (the bare bar stays the bar), so it scales when the work weight climbs. Null with nothing to
 * keep: no warm-ups, or no work weight to measure them against.
 */
export function ownRowsFromSession(rows, floor = 0) {
  const work = workLoadOf(rows)
  const warm = (rows || []).filter(isWarmupRow)
  if (!(work > 0) || !warm.length) return null
  const out = warm.slice(0, MAX_OWN_WARMUPS).map(row => {
    const r = isSideSetRow(row) ? Math.max(Number(row.sides.L?.r) || 0, Number(row.sides.R?.r) || 0) : Number(row.r) || 0
    const w = Number(row.w) || 0
    if (floor > 0 && Math.abs(w - floor) < 1e-6) return cleanOwnRow({ wb: true, r })
    return cleanOwnRow({ wp: Math.round((w / work) * 100), r })
  }).filter(Boolean)
  return out.length ? out : null
}
const isSideSetRow = row => !!row?.sides && typeof row.sides === 'object'

/** Two saved blocks hold the same rows. */
export const sameOwnRows = (a, b) => JSON.stringify((a || []).map(cleanOwnRow)) === JSON.stringify((b || []).map(cleanOwnRow))

/** A block as one short line: "Bar × 10 · 40% × 5 · 60% × 3". `bar` is the translated word. */
export const ownRowsLine = (rows, bar = 'Bar') => (rows || []).map(r => (r.wb ? bar : r.wp === 0 ? '0' : r.wp + '%') + ' × ' + r.r).join(' · ')
