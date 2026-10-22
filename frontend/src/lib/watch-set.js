// The set the Apple Watch shows for logging (Completed on the wrist): the one the user is on in
// the active workout, as plain numbers the watch can put on its dials. Pure; watch-link.js sends it.
import { EXIDX } from './exercises.js'
import { exerciseNameFor } from './i18n-core.js'
import { isBw, modeOf, supersetUnits, unitOf } from './history.js'
import { isWarmupRow } from './workout-model.js'
import { nextUnfinishedUnit } from './supersetFlow.js'
import { bellsIn, entryDbLoad } from './dumbbells.js'
import { weightIncrement } from './progression.js'

// As health-sync names a workout's exercises.
const nameOf = e => (EXIDX[e.id] ? exerciseNameFor(EXIDX[e.id]) : (e.n || e.id))
const openAt = e => (Array.isArray(e?.sets) ? e.sets.findIndex(s => !s.done) : -1)
const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0)

// The entry to log next: the marked one while it has an open set, then the rest of its superset,
// then the next unit with work left.
function currentIdx(A) {
  const n = A.entries.length
  const cur = Number.isInteger(A.cur) ? Math.min(Math.max(A.cur, 0), n - 1) : 0
  if (openAt(A.entries[cur]) >= 0) return cur
  const units = supersetUnits(A.entries)
  const own = unitOf(units, cur).find(ui => openAt(A.entries[ui]) >= 0)
  if (own != null) return own
  const next = nextUnfinishedUnit(A.entries, units, cur)
  return next?.find(ui => openAt(A.entries[ui]) >= 0) ?? null
}

/** The current set as the watch's payload, or null with nothing open (or no live workout). */
export function currentSetFor(S) {
  const A = S?.active
  if (!A || A.backfill || A.editingWorkoutId || !Array.isArray(A.entries) || !A.entries.length) return null
  const idx = currentIdx(A)
  if (idx == null) return null
  const e = A.entries[idx]
  const i = openAt(e)
  const set = e.sets[i]
  const cfg = { ...(e.target || {}), id: e.id }
  const mode = modeOf(cfg)
  const warmup = isWarmupRow(set)
  // "Set 2 of 3" counts the work rows; a warm-up counts among the warm-ups.
  const same = e.sets.filter(s => isWarmupRow(s) === warmup)
  const setNo = e.sets.slice(0, i + 1).filter(s => isWarmupRow(s) === warmup).length
  const units = supersetUnits(A.entries)
  const nextUnit = nextUnfinishedUnit(A.entries, units, idx)
  const nextIdx = nextUnit?.find(ui => openAt(A.entries[ui]) >= 0)
  const unit = S.unit === 'lb' ? 'lb' : 'kg'
  return {
    id: String(A.id),
    entryId: String(e.id),
    name: String(nameOf(e)),
    idx, i, setNo,
    setCount: same.length,
    warmup,
    mode,
    w: num(set.w),
    r: num(set.r),
    unit,
    each: mode === 'reps' && !isBw(cfg) && bellsIn(cfg) === 2 && entryDbLoad(e) === 'each',
    inc: mode === 'reps' ? weightIncrement(cfg, unit) : 1,
    nextName: nextIdx != null ? String(nameOf(A.entries[nextIdx])) : null,
  }
}
