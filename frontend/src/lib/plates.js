// Plate loading for a set row: which plates go on for THIS weight, from the plates you own.
//
// bar.js knows the bar and splits what is beyond it per side. This module turns that number
// into plates ("45 + 5"), and does the same for a single stack (a dip belt, a landmine, a
// plate-loaded machine, a sled). Both read the plate inventory in S.plates: pairs per
// denomination, kept per unit like the bar weight is — a 45 lb plate is a 45 lb plate, a unit
// switch does not turn it into a 20.4 kg one — so a profile with no inventory of its own gets
// the standard set for its unit, six pairs of each, which is a rack, not a home gym.
//
// Logged weights stay the total on the bar (or the added load). Everything here is display.

import { EXIDX } from './exercises.js'
import { usesBar, defaultBarWeight } from './bar.js'
import { isBw } from './history.js'
import { weightIncrement } from './progression.js'
import { ownedWeightsFor, ownedFloor } from './dumbbells.js'

/** The plate sizes the inventory editor lists, heaviest first, per unit. The 2, 1.5 and 1 kg
 *  are the change plates of a gym that stocks whole and half kilos instead of the 1.25 (#510). */
export const PLATE_SIZES = {
  kg: [25, 20, 15, 10, 5, 2.5, 2, 1.5, 1.25, 1, 0.5],
  lb: [45, 35, 25, 15, 10, 5, 2.5, 1.25],
}
/** Sizes a gym without an inventory of its own is assumed NOT to have. */
const UNCOMMON = { kg: new Set([2, 1.5, 1, 0.5]), lb: new Set([15, 1.25]) }
/** Pairs of each size the default inventory holds — plenty, the way a rack is. */
export const DEFAULT_PAIRS = 6

/** Equipment that loads a single stack rather than two sides of a bar. */
const SINGLE_EQ = new Set(['weighted', 'sled machine'])

const exOf = exOrId => (typeof exOrId === 'string' ? EXIDX[exOrId] : exOrId)
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0)
const unitOf = S => (S?.unit === 'lb' ? 'lb' : 'kg')

// Both choices this module reads are stored with the time they were made, the way a Structural
// Balance override is: S.loadKind[exId] is `{ kind, _ts }` and S.plates[unit] is
// `{ [size]: pairs, …, _ts }`. Going back to the default — the equipment's own loading, the
// standard plate set — is written as a stamped entry too (`kind: null`; a list with no sizes)
// rather than a deleted key, so it wins a sync against the other device's older choice instead
// of coming back from it (lib/sync-merge.js keeps whichever side set a key last).

/** The sizes of a stored plate list with their counts, `_ts` and junk keys left out. */
const sizesOf = entry => (entry && typeof entry === 'object' && !Array.isArray(entry)
  ? Object.entries(entry).filter(([k]) => num(k) > 0)
  : [])

/** Whether this profile counts its own plates for its unit, rather than loading the standard set. */
export const ownsPlates = S => sizesOf(S?.plates?.[unitOf(S)]).length > 0

/**
 * The plates this profile can load, heaviest first: [{ w, n }] with n pairs of each size (a
 * single stack loads both plates of a pair, see rowLoad). S.plates[unit] is { [size]: count, _ts }; absent or without any
 * size → the default set.
 */
export function inventoryFor(S) {
  const unit = unitOf(S)
  const own = sizesOf(S?.plates?.[unit])
  const out = []
  if (own.length) {
    for (const [k, v] of own) {
      const w = num(k), n = Math.floor(num(v))
      if (w > 0 && n > 0) out.push({ w, n })
    }
  } else {
    for (const w of PLATE_SIZES[unit]) if (!UNCOMMON[unit].has(w)) out.push({ w, n: DEFAULT_PAIRS })
  }
  return out.sort((a, b) => b.w - a.w)
}

/**
 * S.plates with `n` pairs of size `w` for the profile's unit, stamped. The first change copies
 * the standard set in, so the list the inventory sheet shows is always the one the rows load from.
 */
export function withPlatePairs(S, w, n, now = Date.now()) {
  const unit = unitOf(S)
  const list = ownsPlates(S)
    ? Object.fromEntries(sizesOf(S.plates[unit]))
    : Object.fromEntries(inventoryFor(S).map(p => [p.w, p.n]))
  list[w] = Math.max(0, Math.round(num(n)))
  return { ...(S?.plates || {}), [unit]: { ...list, _ts: now } }
}

/** S.plates with the profile's unit back on the standard set: a stamped list with no sizes. */
export const withStandardPlates = (S, now = Date.now()) => ({ ...(S?.plates || {}), [unitOf(S)]: { _ts: now } })

/**
 * An exercise's own loading as S.loadKind stores it: 'pairs' | 'single' | 'none', or null when
 * the equipment decides. A bare string is how the first builds of plate loading stored it, and
 * still reads as that kind.
 */
export function loadKindOf(value) {
  const k = value && typeof value === 'object' ? value.kind : value
  return k === 'pairs' || k === 'single' || k === 'none' ? k : null
}

/** S.loadKind with the exercise's loading set to `kind`, or back on its equipment's for null. */
export const withLoadKind = (map, exId, kind, now = Date.now()) =>
  ({ ...(map || {}), [exId]: { kind: loadKindOf(kind), _ts: now } })

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
  const requested = Math.max(0, num(weight))
  const target = Math.floor(requested * Q)
  if (target === 0) return { plates: [], missing: requested }
  const items = (inv || []).filter(p => p.w > 0 && p.n > 0).sort((a, b) => b.w - a.w)
  // 1. greedy
  const greedy = []
  let left = target
  for (const p of items) {
    const unit = q(p.w)
    let k = Math.min(p.n, Math.floor(left / unit))
    while (k-- > 0) { greedy.push(p.w); left -= unit }
  }
  // At or beyond everything you own, greedy has already put every plate on and the rest is
  // missing. The search below would only find that again, with a table as long as the target:
  // a typo like 9999 in a weight field built it on every keystroke.
  const all = items.reduce((sum, p) => sum + q(p.w) * p.n, 0)
  if (left === 0 || target >= all) return { plates: greedy, missing: requested - (target - left) / Q }
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
  return { plates, missing: requested - sum / Q }
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
 * of it beyond the base weight), 'none' (dumbbells, kettlebells, cables, pin machines, bands).
 * The user's own choice in S.loadKind (loadKindOf) wins; otherwise bar equipment → pairs,
 * body-weight and "weighted" exercises and sleds → single (the added load is what you hang on),
 * the rest → none.
 * A band's "weight" is its tension, not plates, so bands are none even though isBw counts them.
 */
export function loadKindFor(S, cfgOrId) {
  const cfg = typeof cfgOrId === 'string' ? { id: cfgOrId } : (cfgOrId || {})
  const ex = exOf(cfg.id)
  const own = loadKindOf(S?.loadKind?.[cfg.id])
  if (own) return own
  if (usesBar(ex)) return 'pairs'
  if (ex?.eq === 'band' || ex?.eq === 'resistance band') return 'none'
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
  // The inventory counts pairs. A bar takes one plate of a pair per side; a single stack can
  // take both, so one pair of 20s is two 20s on a sled, not one.
  const stock = kind === 'single' ? (inv || []).map(p => ({ ...p, n: p.n * 2 })) : inv
  const { plates, missing } = plateStack(perSide, stock)
  return { kind, barOnly: false, perSide, plates, missing }
}

/** Two rows load the same when their stacks match, both are (or are not) bar-only, and the same amount is missing. */
export const sameLoad = (a, b) =>
  !!a && !!b && a.barOnly === b.barOnly && a.missing === b.missing
  && a.plates.length === b.plates.length && a.plates.every((w, i) => w === b.plates[i])

/**
 * Where a drop-set's next weight may land (lib/workout-model.js nextDropWeight): on the dumbbells
 * this profile owns for a dumbbell lift, on the plates
 * this profile owns when it has counted them and the exercise is plate-loaded — the heaviest load
 * at or below the drop that those plates make — else on the exercise's own weight step. A drop
 * rounded to .5 read 48.5 kg on a bar that loads in 2.5s (QA 1.3.9).
 */
export function dropGrid(S, cfg) {
  // A dumbbell lift with the bells you own listed (issue #376) drops to the heaviest one at or
  // under the drop: a 20% drop from 21 kg is 16.8, and the rack holds a 15.
  const owned = ownedWeightsFor(S, cfg)
  if (owned) return w => ownedFloor(owned, w)
  const kind = loadKindFor(S, cfg)
  if (ownsPlates(S) && (kind === 'pairs' || kind === 'single')) {
    const base = baseWeightFor(S, cfg?.id)
    const inv = inventoryFor(S)
    const per = kind === 'pairs' ? 2 : 1
    return w => {
      if (w <= base) return base > 0 ? base : w
      const { perSide, missing } = rowLoad(kind, w, base, inv)
      return base + per * Math.max(0, perSide - missing)
    }
  }
  return weightIncrement(cfg, S?.unit === 'lb' ? 'lb' : 'kg')
}
