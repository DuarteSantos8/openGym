// A worst-case profile for the PDF exports: the 12-week demo history plus one routine and one
// workout built to break a printout. Fifteen exercises, the longest German catalogue names, a
// custom exercise with a sentence for a name, supersets, drop-sets, timed and cardio work, notes
// that wrap, and up to ten sets in one exercise. Nothing here touches exercise media.

const LONG_CUSTOM = {
  id: 'pdf-long-custom', custom: true, eq: 'dumbbell', bp: 'shoulders', tg: 'delts',
  n: 'Single-arm half-kneeling landmine press with a two-second pause and slow eccentric (left side first)',
}

// [id, sets, reps, weight, extra]
const PLAN = [
  ['0025', 5, 5, 100, { note: 'Pause every rep on the chest. Shoulder blades pinned, feet planted, and breathe before the press.' }],
  ['11718', 4, 12, 35, { sg: 'a' }],
  ['5448', 4, 12, 60, { sg: 'a' }],
  ['6515', 4, 10, 40, { repsMin: 8 }],
  ['3096', 3, 12, 70, { intensifier: { type: 'dropset', count: 2, pct: 20 } }],
  ['1679', 3, 12, 14, { sg: 'b' }],
  ['10670', 3, 10, 30, { sg: 'b' }],
  ['6517', 3, 10, 40, {}],
  ['0027', 4, 8, 60, { intensifier: { type: 'restpause', totalReps: 20, restSec: 15 } }],
  ['pdf-long-custom', 3, 8, 22.5, { note: 'Left side first, then right. Stop one rep short of failure.' }],
  ['4950', 3, 12, 0, {}],
  ['0043', 10, 3, 140, { note: 'Ten singles-ish triples, climbing.' }],
  ['0085', 3, 10, 60, {}],
  ['0464', 3, 45, 0, { mode: 'time', sec: 45 }],
  ['3567', 2, 10, 0, {}],
]

function routineEx() {
  return PLAN.map(([id, sets, reps, weight, extra]) => {
    const e = { id, sets, mode: 'reps', reps, weight, ...extra }
    if (extra.mode === 'time') { e.mode = 'time'; e.sec = extra.sec; delete e.reps }
    return e
  })
}

function workoutEntries() {
  return PLAN.map(([id, sets, reps, weight, extra], i) => {
    const rows = []
    if (weight > 40) rows.push({ w: Math.round(weight * 0.5), r: 8, done: true, warmup: true })
    for (let s = 0; s < sets; s++) {
      if (extra.mode === 'time') rows.push({ sec: extra.sec + s * 5, done: true })
      else rows.push({ w: weight + (id === '0043' ? s * 2.5 : 0), r: Math.max(1, reps - (s > 1 ? 1 : 0)), done: true, rir: s === sets - 1 ? 1 : 2 })
    }
    const entry = { id, sets: rows, ...(extra.sg ? { sg: extra.sg } : {}), ...(extra.note ? { note: extra.note } : {}) }
    if (i === 0 || i === 11) entry.topW = weight
    return entry
  })
}

/** Adds the stress-test routine and workout to a demo state, in place, and returns it. */
export function addStressCase(S, { now = Date.now() } = {}) {
  S.customEx = [...(S.customEx || []), LONG_CUSTOM]
  S.routines = [...S.routines, { id: 'pdf-long', name: 'Ganzkörper Hypertrophie Donnerstag (lang)', emoji: 'dumbbell', ex: routineEx() }]
  S.week = { ...(S.week || {}), 4: ['pdf-long'] }
  const day = new Date(now - 86400000); day.setHours(18, 5, 0, 0)
  const start = day.getTime()
  const iso = day.toISOString().slice(0, 10)
  const w = {
    id: 'pdf-long-w', d: iso, start, end: start + 104 * 60000, routineId: 'pdf-long',
    name: 'Ganzkörper Hypertrophie Donnerstag (lang)', bw: 80.4,
    entries: workoutEntries(), prs: ['0025', '0043', 'pdf-long-custom'],
    note: 'Felt strong today. Gym was packed, so the supersets took a while. Next time: start with the deadlifts.',
  }
  S.workouts = [...S.workouts.filter(x => x.d <= iso), w, ...S.workouts.filter(x => x.d > iso)]
  return S
}

export const STRESS_ROUTINE_ID = 'pdf-long'
export const STRESS_WORKOUT_ID = 'pdf-long-w'
