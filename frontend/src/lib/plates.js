// Plate loading for a set row: which plates go on for THIS weight, from the plates you own.
//
// bar.js knows the bar and splits what is beyond it per side. This module turns that number
// into plates ("45 · 5"), and does the same for a single stack (a dip belt, a landmine, a
// plate-loaded machine, a sled). Both read the plate inventory in S.plates: pairs per
// denomination, kept per unit like the bar weight is — a 45 lb plate is a 45 lb plate, a unit
// switch does not turn it into a 20.4 kg one — so a profile with no inventory of its own gets
// the standard set for its unit, six pairs of each, which is a rack, not a home gym.
//
// Logged weights stay the total on the bar (or the added load). Everything here is display.

import { EXIDX } from './exercises.js'
import { usesBar, defaultBarWeight } from './bar.js'
import { isBw } from './history.js'

/** The plate sizes the inventory editor lists, heaviest first, per unit. */
export const PLATE_SIZES = {
  kg: [25, 20, 15, 10, 5, 2.5, 1.25, 0.5],
  lb: [45, 35, 25, 15, 10, 5, 2.5, 1.25],
}
/** Sizes a gym without an inventory of its own is assumed NOT to have. */
const UNCOMMON = { kg: new Set([0.5]), lb: new Set([15, 1.25]) }
/** Pairs of each size the default inventory holds — plenty, the way a rack is. */
export const DEFAULT_PAIRS = 6

/** Equipment that loads a single stack rather than two sides of a bar. */
const SINGLE_EQ = new Set(['weighted', 'sled machine'])

const exOf = exOrId => (typeof exOrId === 'string' ? EXIDX[exOrId] : exOrId)
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0)

/**
 * The plates this profile can load, heaviest first: [{ w, n }] with n pairs (or plates, for a
 * single stack) of each size. S.plates[unit] is { [size]: count }; absent → the default set.
 */
export function inventoryFor(S) {
  const unit = S?.unit === 'lb' ? 'lb' : 'kg'
  const own = S?.plates?.[unit]
  const sizes = PLATE_SIZES[unit]
  const out = []
  if (own && typeof own === 'object') {
    for (const [k, v] of Object.entries(own)) {
      const w = num(k), n = Math.floor(num(v))
      if (w > 0 && n > 0) out.push({ w, n })
    }
  } else {
    for (const w of sizes) if (!UNCOMMON[unit].has(w)) out.push({ w, n: DEFAULT_PAIRS })
  }
  return out.sort((a, b) => b.w - a.w)
}

/** The count of one size in this profile's inventory (0 when it has none). */
export const pairsOf = (S, w) => inventoryFor(S).find(p => p.w === w)?.n || 0

// Everything is done in quarter-units so 1.25 and 2.5 stay exact integers.
const Q = 4
const q = w => Math.round(w * Q)

/**
 * Plates for `weight`, from `inv` ([{ w, n }], heaviest first). Heaviest-first greedy when that
 * lands exactly — the way a bar is loaded in practice. When greedy misses (a home gym with one
 * pair of each size, an odd inventory) the fewest plates that hit the weight exactly, biased to
 * heavier plates on ties. When nothing hits it, the closest load BELOW and what is missing.
 *   → { plates: [w, …] heaviest first, missing: number }   (missing 0 = exact)
 */
export function plateStack(weight, inv) {
  const target = q(Math.max(0, num(weight)))
  if (target === 0) return { plates: [], missing: 0 }
  const items = (inv || []).filter(p => p.w > 0 && p.n > 0).sort((a, b) => b.w - a.w)
  // 1. greedy
  const greedy = []
  let left = target
  for (const p of items) {
    const unit = q(p.w)
    let k = Math.min(p.n, Math.floor(left / unit))
    while (k-- > 0) { greedy.push(p.w); left -= unit }
  }
  if (left === 0) return { plates: greedy, missing: 0 }
  // 2. exact fit with the fewest plates: f[i][s] = min plates using sizes i.. to make s
  const n = items.length
  const INF = 1e9
  const f = Array.from({ length: n + 1 }, () => new Int32Array(target + 1).fill(INF))
  f[n][0] = 0
  for (let i = n - 1; i >= 0; i--) {
    const unit = q(items[i].w), cap = items[i].n
    for (let s = 0; s <= target; s++) {
      let best = f[i + 1][s]
      for (let k = 1; k <= cap && k * unit <= s; k++) {
        const v = f[i + 1][s - k * unit]
        if (v + k < best) best = v + k
      }
      f[i][s] = best
    }
  }
  // The heaviest reachable sum at or below the target (the target itself when it fits).
  let sum = target
  while (sum > 0 && f[0][sum] >= INF) sum--
  const plates = []
  let s = sum
  for (let i = 0; i < n; i++) {
    const unit = q(items[i].w), cap = items[i].n
    // Largest k that still leaves an optimal remainder → heavier plates on ties.
    for (let k = Math.min(cap, Math.floor(s / unit)); k >= 0; k--) {
      if (f[i + 1][s - k * unit] + k === f[i][s]) {
        for (let j = 0; j < k; j++) plates.push(items[i].w)
        s -= k * unit
        break
      }
    }
  }
  return { plates, missing: (target - sum) / Q }
}

/**
 * Going from one stack to the next: what comes off and what goes on (multiset difference),
 * each heaviest first. { strip: [w…], add: [w…] } — both empty when nothing changes.
 */
export function plateDelta(prev, next) {
  const count = arr => { const m = new Map(); for (const w of arr || []) m.set(w, (m.get(w) || 0) + 1); return m }
  const a = count(prev), b = count(next)
  const strip = [], add = []
  for (const [w, n] of a) for (let i = 0; i < n - (b.get(w) || 0); i++) strip.push(w)
  for (const [w, n] of b) for (let i = 0; i < n - (a.get(w) || 0); i++) add.push(w)
  const desc = (x, y) => y - x
  return { strip: strip.sort(desc), add: add.sort(desc) }
}

/**
 * How an exercise's weight is loaded: 'pairs' (a bar or a two-post machine — plates split per
 * side beyond the bar), 'single' (one stack: dip belt, landmine, plate-loaded machine, sled — all
 * of it beyond the base weight), 'none' (dumbbells, kettlebells, cables, pin machines). The
 * user's own choice in S.loadKind wins; otherwise bar equipment → pairs, body-weight and
 * "weighted" exercises and sleds → single (the added load is what you hang on), the rest → none.
 */
export function loadKindFor(S, cfgOrId) {
  const cfg = typeof cfgOrId === 'string' ? { id: cfgOrId } : (cfgOrId || {})
  const ex = exOf(cfg.id)
  const own = S?.loadKind?.[cfg.id]
  if (own === 'pairs' || own === 'single' || own === 'none') return own
  if (usesBar(ex)) return 'pairs'
  if (SINGLE_EQ.has(ex?.eq) || isBw(cfg)) return 'single'
  return 'none'
}

/**
 * The weight that is there before any plate goes on, in the profile unit: the bar for bar
 * exercises (S.barWeights override, 0 = "no bar", else the type's default), the explicit
 * override for anything else (a sled's own weight), 0 otherwise.
 */
export function baseWeightFor(S, exOrId) {
  const ex = exOf(exOrId)
  if (!ex) return 0
  const own = S?.barWeights?.[ex.id]
  if (typeof own === 'number' && own >= 0) return own
  return defaultBarWeight(ex.eq, S?.unit) ?? 0
}

/**
 * The load line for one set row: null when there is nothing to load (kind none, no weight);
 * { barOnly: true } when the weight is at or below the base; otherwise the stack for the
 * per-side (pairs) or total (single) load plus what is missing from the inventory.
 *   → { kind, perSide, plates, missing, barOnly }
 */
export function rowLoad(kind, weight, base, inv) {
  if (kind !== 'pairs' && kind !== 'single') return null
  const w = num(weight)
  if (!(w > 0)) return null
  const b = Math.max(0, num(base))
  if (w <= b) return { kind, barOnly: true, perSide: 0, plates: [], missing: 0 }
  const perSide = Math.round(((w - b) / (kind === 'pairs' ? 2 : 1)) * 100) / 100
  const { plates, missing } = plateStack(perSide, inv)
  return { kind, barOnly: false, perSide, plates, missing }
}

/** Two rows load the same when their stacks match, both are (or are not) bar-only, and the same amount is missing. */
export const sameLoad = (a, b) =>
  !!a && !!b && a.barOnly === b.barOnly && a.missing === b.missing
  && a.plates.length === b.plates.length && a.plates.every((w, i) => w === b.plates[i])
