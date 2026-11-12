// A backup someone edited by hand, or one a broken disk gave back, can hold rows that are not rows:
// a `null` among the workouts, a routine without its exercise list. Every screen reads those lists
// expecting objects, so one such row left Home, History, Stats and the Library on "Something went
// wrong" until the profile was reset. The import drops what cannot be a row and keeps the rest:
// a backup with one bad line still brings everything else back.
//
// Only the shape is checked here, never the numbers: a set of 1,000,000 reps is the person's own.

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v)
const rows = (list, ok = isObj) => (Array.isArray(list) ? list.filter(ok) : [])

/**
 * `state` with the rows no reader can use taken out. Returns { state, dropped }: the same object
 * when nothing had to go (dropped 0), a shallow copy with cleaned lists otherwise.
 */
export function dropBrokenRows(state) {
  if (!isObj(state)) return { state, dropped: 0 }
  let dropped = 0
  const out = { ...state }
  const clean = (key, fix) => {
    if (!(key in state)) return
    const before = Array.isArray(state[key]) ? state[key] : []
    const after = fix(before)
    const changed = !Array.isArray(state[key]) || after.length !== before.length || after.some((r, i) => r !== before[i])
    if (changed) { out[key] = after; dropped += Math.max(1, before.length - after.length) }
  }
  // A workout is an object with its entries; an entry is an object with an exercise id and sets.
  clean('workouts', list => rows(list, w => isObj(w) && Array.isArray(w.entries)).map(w => {
    const entries = rows(w.entries, e => isObj(e) && e.id != null && Array.isArray(e.sets))
    const fixed = entries.map(e => (e.sets.every(isObj) ? e : { ...e, sets: rows(e.sets) }))
    return fixed.length === w.entries.length && fixed.every((e, i) => e === w.entries[i]) ? w : { ...w, entries: fixed }
  }))
  // A routine is an object with an id and its exercise list.
  clean('routines', list => rows(list, r => isObj(r) && r.id != null).map(r => {
    const ex = rows(r.ex, e => isObj(e) && e.id != null)
    return Array.isArray(r.ex) && ex.length === r.ex.length ? r : { ...r, ex }
  }))
  // A weigh-in needs its day and a weight that is a number.
  clean('bodyweight', list => rows(list, b => isObj(b) && typeof b.d === 'string' && typeof b.w === 'number' && Number.isFinite(b.w)))
  clean('measurements', list => rows(list, m => isObj(m) && typeof m.d === 'string'))
  clean('customEx', list => rows(list, c => isObj(c) && c.id != null))
  return dropped ? { state: out, dropped } : { state, dropped: 0 }
}
