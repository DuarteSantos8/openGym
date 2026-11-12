// Safety copies: whole-profile snapshots the browser keeps for you, so that deleting something (a
// reset, an import that replaces the profile, cleared site data) is never the end of it.
//
//   Copy = { id, at, reason: 'auto' | 'reset' | 'import', summary, state }
//
// Everything that decides WHEN a copy is made, which ones are kept and what a profile holds lives
// here, pure and tested. Where they are stored (IndexedDB) is lib/safety-store.js, and the screen
// is components/SafetyCopiesSheet.jsx. A copy is restored through the store's importBackup, so a
// restore is a deliberate add-back that syncs like any other backup import.

export const KEEP_AUTO = 3          // the newest daily copies
export const KEEP_BEFORE = 3        // the newest copies taken just before a deletion
export const AUTO_GAP_MS = 20 * 3600 * 1000   // at most about one automatic copy a day

const arr = v => (Array.isArray(v) ? v : [])
const count = v => (v && typeof v === 'object' && !Array.isArray(v) ? Object.keys(v).length : 0)

/** What a profile holds, for the list ("120 workouts, 4 routines") and for "is it empty". */
export function summarize(S) {
  return {
    workouts: arr(S?.workouts).length,
    routines: arr(S?.routines).length,
    weighIns: arr(S?.bodyweight).length,
    plans: count(S?.cardioPlans),
    programmes: count(S?.programmes),
  }
}

/** True when there is nothing worth protecting: no history, no routine, no weigh-in, no plan. */
export const isEmptyProfile = S => {
  const s = summarize(S)
  return !(s.workouts || s.routines || s.weighIns || s.plans || s.programmes)
}

/**
 * Should an automatic copy be taken now? Not for an empty profile (it would push real copies out),
 * and not when the newest automatic copy is recent and the profile changed little since: one a day.
 */
export function autoCopyDue(S, copies, now = Date.now()) {
  if (isEmptyProfile(S)) return false
  const last = arr(copies).filter(c => c.reason === 'auto').reduce((m, c) => Math.max(m, c.at || 0), 0)
  return now - last >= AUTO_GAP_MS
}

/** Newest first. */
export const newestFirst = copies => arr(copies).slice().sort((a, b) => (b.at || 0) - (a.at || 0))

/**
 * The list after adding `copy`: the newest KEEP_AUTO automatic ones and the newest KEEP_BEFORE of
 * the deletion ones, so a run of daily copies never pushes out the copy taken before a reset.
 */
export function withCopy(copies, copy) {
  const all = newestFirst([...arr(copies).filter(c => c.id !== copy.id), copy])
  const auto = all.filter(c => c.reason === 'auto').slice(0, KEEP_AUTO)
  const before = all.filter(c => c.reason !== 'auto').slice(0, KEEP_BEFORE)
  return newestFirst([...auto, ...before])
}

/** A copy of `S`, or null when there is nothing in it. */
export function makeCopy(S, reason, now = Date.now()) {
  if (!S || typeof S !== 'object' || isEmptyProfile(S)) return null
  // The workout in progress is not part of a copy: it is not history yet, and a copy restored later
  // must not bring back a session that ended long ago.
  const { active: _running, ...state } = S
  return { id: `${now}-${reason}`, at: now, reason, summary: summarize(S), state }
}

/**
 * Offer a restore when this profile is empty and a copy that holds something exists. The newest
 * copy is the one offered.
 */
export function copyToOffer(S, copies) {
  // A profile emptied on purpose ("Reset everything" stamps resetAt) is not a loss to repair.
  if (!isEmptyProfile(S) || S?.resetAt) return null
  return newestFirst(copies).find(c => !isEmptyProfile(c.state)) || null
}
