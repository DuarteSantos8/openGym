// Focused workout semantics shared by session, history, and strength views.
// Legacy records have no explicit phase or mode, so the defaults preserve main's work/reps shape.

const MODES = ['reps', 'time', 'cardio']
const objectOf = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {}

function normalizedPhase(value, fallback = 'work') {
  const token = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (token === 'warmup' || token === 'warm-up' || token === 'warm_up') return 'warmup'
  if (token === 'work') return 'work'
  return fallback === 'warmup' ? 'warmup' : 'work'
}

/** Resolve a row's phase. An explicit phase wins over the legacy warmup boolean. */
export function phaseForSet(set, fallback = 'work') {
  const source = objectOf(set)
  if (source.phase != null && source.phase !== '') return normalizedPhase(source.phase, fallback)
  return source.warmup === true ? 'warmup' : normalizedPhase(undefined, fallback)
}

export function isWarmupRow(set) {
  return phaseForSet(set) === 'warmup'
}

// A row's shape beyond warm-up/work: 'straight' (default), 'dropset' (a main set followed by
// weight drops logged with no rest) or 'restpause' (an activation set followed by short-rest
// bursts). Both extras ride on the row itself — same card, not a new set in the array — the
// same trick `phase` uses for warm-ups, so the rest of the app can keep reading a row's own
// `w`/`r` and stay correct without knowing this field exists.
export function setType(set) {
  const source = objectOf(set)
  return source.type === 'dropset' || source.type === 'restpause' ? source.type : 'straight'
}
export const isDropSet = set => setType(set) === 'dropset'
export const isRestPauseSet = set => setType(set) === 'restpause'

/** A drop-set's weight drops, oldest first; empty for anything else. */
export function dropsOf(set) {
  const source = objectOf(set)
  return isDropSet(source) && Array.isArray(source.drops) ? source.drops : []
}

/** A rest-pause set's short-rest bursts, oldest first; empty for anything else. */
export function clustersOf(set) {
  const source = objectOf(set)
  return isRestPauseSet(source) && Array.isArray(source.clusters) ? source.clusters : []
}

/**
 * Weight x reps from a drop-set's drops, on top of its own main set. The 1RM estimate and the
 * progression engine deliberately read only a row's own `w`/`r` (the heaviest effort), so this
 * is the one place a drop-set's extra volume gets added back in for totals.
 *
 * A rest-pause row is different: its own `r` IS the total (every burst's reps included), and
 * `clusters` is only how that total breaks down — not extra volume on top of it. Adding
 * `clustersOf(set)` here as well would double-count the same reps twice.
 */
export function extraVolumeOf(set) {
  const source = objectOf(set)
  // A per-side set carries its drops on each side (issue #60), so the extra volume is the sum of
  // both sides' drops — the row itself has no `drops`. dropsOf reads a side's own {type,drops}.
  if (isSideSet(source)) {
    return [source.sides.L, source.sides.R].reduce(
      (v, side) => v + dropsOf(side).reduce((n, d) => n + (Number(d?.w) || 0) * (Number(d?.r) || 0), 0), 0)
  }
  const drops = dropsOf(source)
  return drops.reduce((v, d) => v + (Number(d?.w) || 0) * (Number(d?.r) || 0), 0)
}

/** Append a weight drop to a row, marking it a drop-set. */
export function addDrop(set, drop) {
  const prev = Array.isArray(objectOf(set).drops) ? objectOf(set).drops : []
  return { ...objectOf(set), type: 'dropset', drops: [...prev, { w: Number(drop?.w) || 0, r: Number(drop?.r) || 0 }] }
}

/** Append a short-rest burst to a row, marking it a rest-pause set. */
export function addCluster(set, cluster) {
  const prev = Array.isArray(objectOf(set).clusters) ? objectOf(set).clusters : []
  return { ...objectOf(set), type: 'restpause', clusters: [...prev, { r: Number(cluster?.r) || 0, restSec: Number(cluster?.restSec) || 0 }] }
}

/** Remove one drop by index. Clearing the last one reverts the row to a straight set. */
export function removeDropAt(set, i) {
  const drops = (objectOf(set).drops || []).filter((_, idx) => idx !== i)
  return drops.length ? { ...objectOf(set), drops } : { ...objectOf(set), type: 'straight', drops }
}

/** Remove one burst by index. Clearing the last one reverts the row to a straight set. */
export function removeClusterAt(set, i) {
  const clusters = (objectOf(set).clusters || []).filter((_, idx) => idx !== i)
  return clusters.length ? { ...objectOf(set), clusters } : { ...objectOf(set), type: 'straight', clusters }
}

/** Patch one drop's fields in place (weight/reps steppers edit an existing drop). */
export function setDropAt(set, i, patch) {
  const drops = (objectOf(set).drops || []).slice()
  if (!drops[i]) return set
  drops[i] = { ...drops[i], ...patch }
  return { ...objectOf(set), drops }
}

/** Patch one burst's fields in place (a reps stepper edits an existing burst). */
export function setClusterAt(set, i, patch) {
  const clusters = (objectOf(set).clusters || []).slice()
  if (!clusters[i]) return set
  clusters[i] = { ...clusters[i], ...patch }
  return { ...objectOf(set), clusters }
}

/** Suggested weight for the next drop: pct% lighter than the previous weight, rounded to .5. */
export function nextDropWeight(prevWeight, pct = 20) {
  const p = Math.min(90, Math.max(1, Number(pct) || 20))
  return Math.round(Math.max(0, (Number(prevWeight) || 0) * (1 - p / 100)) * 2) / 2
}

/** Suggested reps for the next rest-pause burst: roughly half the previous rep count. */
export function nextBurstReps(prevReps) {
  return Math.max(1, Math.round((Number(prevReps) || 0) / 2))
}

/**
 * Split a rest-pause total (the extra reps you want past the activation set) into a descending,
 * roughly-halving sequence of bursts that adds back up to it — e.g. 12 -> [6, 3, 2, 1]. This is
 * what a planned rest-pause exercise configures directly, rather than a burst count picked by
 * hand: you say how many reps you want out of the whole rest-pause portion, not how many rests.
 */
export function splitBurstReps(total) {
  const bursts = []
  let remaining = Math.max(0, Math.round(Number(total) || 0))
  while (remaining > 0) {
    const burst = Math.min(remaining, nextBurstReps(remaining))
    bursts.push(burst)
    remaining -= burst
  }
  return bursts
}

// --- one-sided (unilateral) sets (issue #60) -------------------------------------------------
//
// A unilateral exercise (cfg.side, see history.js isPerSide) is trained one limb at a time, and
// asymmetries are the whole point of tracking it — a stronger right that carries a weaker left is
// exactly what a single combined row hides. So a per-side row logs each side on its own: weight,
// reps, effort and its own done tick, held in `sides: { L, R }`.
//
// Like `drops`/`clusters`, this rides on the row while the row's own `w`/`r`/`done`/effort stay a
// correct aggregate of the two sides — so volume, 1RM, PRs, progression, recovery, history and the
// coach keep reading a row's scalar fields and need not know sides exist:
//   r     = L.r + R.r   (the both-sides total, exactly what those readers expect of a per-side set)
//   w     = max(L.w, R.w)  (the heavier side; the two are usually equal)
//   done  = L.done && R.done  (a set counts done only once both sides are)
//   effort= the harder side's rating (lower RIR / higher RPE), for the history tail only
// `syncSideAggregate` recomputes those scalars from `sides` after any per-side edit.
export function isSideSet(set) {
  const s = objectOf(set)
  return !!(s.sides && typeof s.sides === 'object' && s.sides.L && s.sides.R)
}

const sideOf = value => {
  const v = objectOf(value)
  const out = { w: Number(v.w) || 0, r: Number(v.r) || 0, done: v.done === true }
  if (v.rir != null) out.rir = v.rir
  if (v.rpe != null) out.rpe = v.rpe
  // A side can carry its own intensifier (issue #60): drop-sets and rest-pause bursts are logged
  // per limb, exactly like the main set, so the same {type, drops, clusters} shape rides on the
  // side. Reuses the row-level helpers below (addDrop/dropsOf/…), which read this very shape.
  if (v.type === 'dropset' || v.type === 'restpause') out.type = v.type
  if (Array.isArray(v.drops)) out.drops = v.drops
  if (Array.isArray(v.clusters)) out.clusters = v.clusters
  return out
}

// Build a per-side row from a plain row: each side starts as half the row's total reps (a unilateral
// target is always even, so the split is whole) at the same weight, carrying nothing done yet.
export function makeSideSet(row = {}) {
  const base = objectOf(row)
  const half = Math.round((Number(base.r) || 0) / 2)
  const w = Number(base.w) || 0
  const side = () => ({ w, r: half, done: false })
  const next = { ...base, sides: { L: side(), R: side() } }
  // effort/done/reps on the parent become derived — drop any straight-set leftovers so the row
  // carries one source of truth, then recompute the aggregate.
  delete next.rir; delete next.rpe
  return syncSideAggregate(next)
}

// Recompute the row's scalar mirror from its two sides. No-op (returns a shallow copy) for a row
// that is not per-side, so callers can pipe every edit through it unconditionally.
export function syncSideAggregate(row) {
  const base = objectOf(row)
  if (!isSideSet(base)) return { ...base }
  const L = sideOf(base.sides.L)
  const R = sideOf(base.sides.R)
  const out = { ...base, sides: { L, R }, r: L.r + R.r, w: Math.max(L.w, R.w), done: L.done && R.done }
  // The row's effort tail shows the harder side: fewer reps in reserve (lower RIR) or a higher RPE.
  // Only one scale is ever in play, matching how a straight row carries rir XOR rpe.
  delete out.rir; delete out.rpe
  const rirs = [L.rir, R.rir].filter(v => v != null)
  const rpes = [L.rpe, R.rpe].filter(v => v != null)
  if (rirs.length) out.rir = Math.min(...rirs)
  else if (rpes.length) out.rpe = Math.max(...rpes)
  // Drops/clusters live on the sides now, so the row itself never carries them — only the shared
  // `type` so isDropSet/isRestPauseSet still classify the set. extraVolumeOf reads the sides.
  delete out.drops; delete out.clusters; delete out.type
  const sideType = setType(L) !== 'straight' ? setType(L) : setType(R)
  if (sideType !== 'straight') out.type = sideType
  return out
}

// Patch one field on one side ('L'|'R'), returning a new row with the aggregate resynced. A null
// value clears an optional field (effort), mirroring how a straight row drops the key.
export function setSideField(row, side, field, value) {
  const base = objectOf(row)
  if (!isSideSet(base) || (side !== 'L' && side !== 'R')) return { ...base }
  const cur = { ...sideOf(base.sides[side]) }
  if (value == null && (field === 'rir' || field === 'rpe')) delete cur[field]
  else cur[field] = value
  return syncSideAggregate({ ...base, sides: { ...base.sides, [side]: cur } })
}

// Flip one side's done tick, resyncing the row's own done (true only when both sides are).
export function toggleSide(row, side) {
  const base = objectOf(row)
  if (!isSideSet(base) || (side !== 'L' && side !== 'R')) return { ...base }
  const cur = { ...sideOf(base.sides[side]), done: !sideOf(base.sides[side]).done }
  return syncSideAggregate({ ...base, sides: { ...base.sides, [side]: cur } })
}

// --- per-side intensifiers (drop-sets / rest-pause) --------------------------------------------
//
// On a unilateral set the intensifier is logged per limb too. The structure stays symmetric —
// both sides always carry the same number of drops/bursts — while each side's weights and reps
// are edited independently, mirroring how the main set works. These reuse the side-agnostic
// helpers above (addDrop/dropsOf/setDropAt/…) on each side object, then resync the aggregate.

// Apply an editing fn to a single side and resync (used to edit one side's drop/burst).
function patchSide(row, side, fn) {
  const base = objectOf(row)
  if (!isSideSet(base) || (side !== 'L' && side !== 'R')) return { ...base }
  return syncSideAggregate({ ...base, sides: { ...base.sides, [side]: fn(sideOf(base.sides[side])) } })
}
// Apply an editing fn to both sides and resync (used to add/remove a drop/burst symmetrically).
function patchBothSides(row, fn) {
  const base = objectOf(row)
  if (!isSideSet(base)) return { ...base }
  return syncSideAggregate({ ...base, sides: { L: fn(sideOf(base.sides.L), 'L'), R: fn(sideOf(base.sides.R), 'R') } })
}

// Append a drop to both sides, each seeded from its own side's weight (pct lighter) and reps.
export function addSideDrop(row, pct) {
  return patchBothSides(row, side => {
    const drops = dropsOf(side)
    const base = drops.length ? drops[drops.length - 1].w : (side.w || 0)
    return addDrop(side, { w: nextDropWeight(base, pct), r: side.r })
  })
}
export function removeSideDropAt(row, i) {
  return patchBothSides(row, side => removeDropAt(side, i))
}
export function setSideDropAt(row, side, i, patch) {
  return patchSide(row, side, sd => setDropAt(sd, i, patch))
}

// Append a rest-pause burst to both sides, each seeded from its own side's rep count. The side's
// own `r` grows by the added burst, mirroring the non-per-side rule that a rest-pause row's `r`
// is the running total across its bursts.
export function addSideCluster(row, restSec) {
  return patchBothSides(row, side => {
    const clusters = clustersOf(side)
    const base = clusters.length ? clusters[clusters.length - 1].r : (side.r || 0)
    const added = nextBurstReps(base)
    return { ...addCluster(side, { r: added, restSec }), r: (side.r || 0) + added }
  })
}
export function removeSideClusterAt(row, i) {
  return patchBothSides(row, side => {
    const removed = clustersOf(side)[i]?.r || 0
    return { ...removeClusterAt(side, i), r: Math.max(0, (side.r || 0) - removed) }
  })
}
export function setSideClusterAt(row, side, i, r) {
  return patchSide(row, side, sd => {
    const delta = (Number(r) || 0) - (clustersOf(sd)[i]?.r || 0)
    return { ...setClusterAt(sd, i, { r }), r: Math.max(0, (sd.r || 0) + delta) }
  })
}

export function normalizeMode(value, fallback = 'reps') {
  const token = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (MODES.includes(token)) return token
  return MODES.includes(fallback) ? fallback : 'reps'
}

function modeFromUnit(value) {
  const token = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (['rep', 'reps', 'repetition', 'repetitions'].includes(token)) return 'reps'
  if (['sec', 'secs', 'second', 'seconds'].includes(token)) return 'time'
  if (['min', 'mins', 'minute', 'minutes'].includes(token)) return 'cardio'
  return null
}

function explicitMode(source) {
  const value = objectOf(source).mode
  const token = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return MODES.includes(token) ? token : modeFromUnit(objectOf(source).unit)
}

function inferredMode(source) {
  const value = objectOf(source)
  const explicit = explicitMode(value)
  if (explicit) return explicit
  if (String(value.mode || '').trim().toLowerCase() === 'amrap') return 'reps'
  if (value.min != null || value.speed != null) return 'cardio'
  if (value.sec != null || value.seconds != null || value.durationSec != null) return 'time'
  if (value.r != null || value.reps != null || value.actualReps != null) return 'reps'
  return null
}

/** Resolve one row's mode: explicit row, parent target, then legacy result fields. */
export function modeForSet(set, target = {}) {
  return explicitMode(set) || inferredMode(target) || inferredMode(set) || 'reps'
}

/** Resolve a single mode for an entry; mixed work-row modes intentionally return null. */
export function modeForEntry(entry, fallback = null) {
  const source = objectOf(entry)
  const target = objectOf(source.target || source)
  const sets = Array.isArray(source.sets) ? source.sets : []
  const work = sets.filter(set => !isWarmupRow(set))
  const observed = work.length ? work : sets
  const modes = [...new Set(observed.map(set => modeForSet(set, target)))]
  if (modes.length > 1) return null
  if (modes.length === 1) return modes[0]
  const targetMode = inferredMode(target)
  if (targetMode) return targetMode
  return fallback == null ? modeForSet(source, target) : normalizeMode(fallback)
}
