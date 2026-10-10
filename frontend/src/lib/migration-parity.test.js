// v1 parity of the first session after the upgrade. Every expected number below is what v1's own
// nextPrescription (git ce30c730, frontend/src/lib/progression.js) answered for the same history,
// computed outside this repo and pinned here: independent of the engine under test. Each history
// is migrated after every one of its sessions, and the first v2 session must open where v1 would
// have — the load, and the reps or sets where v1 named them.
import { describe, expect, it } from 'vitest'
import { migrateProfileV1ToV2, validateCanonicalProfile } from '../../../api/migration/profile-migration.js'
import { LIB_BY_ID } from '../../../api/coach/core/library.js'
import { buildSessionExposures } from './session-start.js'
import { buildCompletedSession } from './finish-session.js'
import { entriesForExposures } from './session-ui-adapter.js'
import { isWarmupRow } from './workout-model.js'

const DAY = 86400000
const T0 = Date.parse('2026-01-05T10:00:00Z')
const PUSH_UP = '1311'   // wide hand push up: body weight, chest
const BENCH = '0025'

// A session: [the reps v1 asked for, the weight it asked for, what was done as "reps@weight …"].
const v1Profile = (cfg, sessions) => ({
  unit: 'kg', restSec: 90, routines: [{ id: 'r1', name: 'R', ex: [cfg] }],
  workouts: sessions.map(([reps, weight, done], k) => ({
    id: 'w' + k, d: new Date(T0 + k * DAY).toISOString().slice(0, 10), start: T0 + k * DAY, end: T0 + k * DAY + 3600000, routineId: 'r1', routineIds: ['r1'],
    entries: [{
      id: cfg.id, rid: 'r1', target: { mode: 'reps', sets: cfg.sets, reps, weight }, planned: { sets: cfg.sets, reps: cfg.reps, ...(cfg.repsMin ? { repsMin: cfg.repsMin } : {}), ...(cfg.weight != null ? { weight: cfg.weight } : {}) },
      sets: done.split(' ').map(s => { const [r, w] = s.split('@').map(Number); return { r, w, done: true } })
    }]
  }))
})
const firstSession = profile => {
  const [x] = buildSessionExposures(profile, profile.routines[0], { now: T0 + 30 * DAY, newId: s => s, unit: 'kg' })
  const p = profile.prescriptions[x.prescriptionId]
  return { w: p.parameters.load.resolved?.value ?? 0, r: p.prefill.reps, s: p.prefill.sets }
}

const CASES = {
  'bodyweight linear: weight added, then taken off again': {
    cfg: { id: PUSH_UP, sets: 3, reps: 5, repsMax: 10, prog: 'linear' },
    sessions: [[5, 0, '5@0 5@0 5@0'], [6, 0, '6@0 6@0 6@0'], [7, 0, '5@10 5@10 5@10'], [5, 10, '5@12.5 5@12.5 5@12.5'], [5, 15, '5@15 5@15 5@15'], [5, 17.5, '5@0 5@0 5@0']],
    v1: [['up', 0, 6], ['up', 0, 7], ['hold', 10, null], ['up', 15, null], ['up', 17.5, null], ['up', 0, 6]]
  },
  'bodyweight linear: a clean loaded session keeps adding load': {
    cfg: { id: PUSH_UP, sets: 3, reps: 5, repsMax: 10, prog: 'linear' },
    sessions: [[5, 0, '5@0 5@0 5@0'], [6, 0, '6@10 6@10 6@10'], [5, 12.5, '6@12.5 6@12.5 6@12.5'], [5, 15, '6@15 6@15 6@15']],
    v1: [['up', 0, 6], ['up', 12.5, null], ['up', 15, null], ['up', 17.5, null]]
  },
  'bodyweight: an unclean session is judged against the target it asked for': {
    cfg: { id: PUSH_UP, sets: 3, reps: 5, repsMax: 10, prog: 'linear' },
    sessions: [[5, 0, '5@0 5@0 5@0'], [6, 0, '6@0 6@0 6@0'], [7, 0, '7@0 7@0 6@0'], [7, 0, '6@0 6@0 6@0'], [7, 0, '7@0 7@0 7@0']],
    v1: [['up', 0, 6], ['up', 0, 7], ['hold', 0, 7], ['hold', 0, 7], ['up', 0, 8]]
  },
  'bodyweight double: weight added climbs v1\'s own rep window': {
    cfg: { id: PUSH_UP, sets: 3, reps: 10, repsMin: 6, prog: 'double' },
    sessions: [[10, 0, '6@0 6@0 6@0'], [10, 0, '6@10 6@10 6@10'], [7, 10, '7@10 7@10 7@10'], [8, 10, '10@10 10@10 10@10'], [6, 12.5, '6@12.5 6@12.5 6@12.5']],
    v1: [['hold', 0, 10], ['hold', 10, 7], ['hold', 10, 8], ['up', 12.5, 6], ['hold', 12.5, 7]]
  },
  'barbell linear: steps, a stalled run and its deload': {
    cfg: { id: BENCH, sets: 3, reps: 5, weight: 60, prog: 'linear' },
    sessions: [[5, 60, '5@60 5@60 5@60'], [5, 62.5, '5@62.5 5@62.5 5@62.5'], [5, 65, '4@65 4@65 4@65'], [5, 65, '4@65 4@65 4@65'], [5, 65, '4@65 4@65 4@65'], [5, 57.5, '5@57.5 5@57.5 5@57.5']],
    v1: [['up', 62.5, null], ['up', 65, null], ['hold', 65, null], ['hold', 65, null], ['deload', 57.5, 5], ['up', 60, null]]
  }
}

describe('the first session after the upgrade opens where v1 would have', () => {
  for (const [name, { cfg, sessions, v1 }] of Object.entries(CASES)) {
    it(name, () => {
      v1.forEach(([kind, weight, reps], k) => {
        const { profile } = migrateProfileV1ToV2(v1Profile(cfg, sessions.slice(0, k + 1)), LIB_BY_ID)
        const got = firstSession(profile)
        expect(got.w, `after session ${k + 1} (v1: ${kind})`).toBe(weight)
        if (reps != null) expect(got.r, `after session ${k + 1} (v1: ${kind})`).toBe(reps)
      })
    })
  }
})

// A workout still running when the app upgrades: v1 started it (the target and plan stamp are
// v1's own), part of it is logged, and it is finished on v2. The session after it must open where
// v1's would have after the same finish; one thrown away instead leaves the track where v1 left it.
// Rows are "reps@weight", "seconds s", or "seconds s:L" for one limb of a per-side hold.
const PLANK = '0464', SITUP = '0001'
const rowOf = s => {
  const [v, limb] = s.split(':')
  if (v.endsWith('s')) return { sec: Number(v.slice(0, -1)), w: 0, done: true, ...(limb ? { side: limb } : {}) }
  const [r, w] = v.split('@').map(Number)
  return { r, w, done: true }
}
const rowsOf = done => done.split(' ').map(rowOf)
const shown = rows => rows.filter(r => !isWarmupRow(r)).map(r => (r.sec != null ? `${r.sec}s${r.side ? ':' + r.side : ''}` : `${r.r}@${r.w ?? 0}`)).join(' ')
const stamp = cfg => (cfg.sec ? { sets: cfg.sets, sec: cfg.sec } : { sets: cfg.sets, reps: cfg.reps, ...(cfg.repsMin ? { repsMin: cfg.repsMin } : {}), ...(cfg.weight != null ? { weight: cfg.weight } : {}) })
const entryOf = (cfg, target, sets) => ({ id: cfg.id, rid: 'r1', target: { ...cfg, ...target }, planned: stamp(cfg), sets })
const at = k => ({ d: new Date(T0 + k * DAY).toISOString().slice(0, 10), start: T0 + k * DAY, routineIds: ['r1'], name: 'R' })
const midSession = ({ cfg, sessions, active: [target, rows, ticked] }) => ({
  unit: 'kg', restSec: 90, routines: [{ id: 'r1', name: 'R', ex: [cfg] }],
  workouts: sessions.map(([target, done], k) => ({ id: 'w' + k, ...at(k), end: T0 + k * DAY + 3600000, routineId: 'r1', entries: [entryOf(cfg, target, rowsOf(done))] })),
  active: { id: 'a', ...at(sessions.length), cur: 0, entries: [entryOf(cfg, target, rowsOf(rows).map((row, i) => ({ ...row, done: i < ticked })))] }
})
const nextSession = profile => {
  const draft = structuredClone(profile)
  const exposures = buildSessionExposures(draft, draft.routines[0], { now: T0 + 30 * DAY, newId: s => s, unit: 'kg' })
  return shown(entriesForExposures(exposures, draft.prescriptions)[0].sets)
}
// What Finish does (sheets.jsx doFinishWorkout): the remaining rows ticked as `done`, the session
// saved, its progression and 1RMs merged in.
const finishOnV2 = (profile, active, done) => {
  const work = rowsOf(done)
  let k = 0
  const ticked = { ...active, entries: active.entries.map(e => ({ ...e, sets: e.sets.map(row => (isWarmupRow(row) ? row : { ...row, ...work[k++] })) })) }
  const { session, oneRepMaxes, progression } = buildCompletedSession(ticked, profile, { end: active.start + 3600000, newId: s => s, unit: 'kg' })
  return { ...profile, workouts: [...profile.workouts, session], progression: { ...profile.progression, ...progression },
    oneRepMaxes: { ...profile.oneRepMaxes, ...Object.fromEntries(oneRepMaxes.map(r => [r.id, r])) } }
}

// [v1's target for the running session], the rows it had, how many were ticked before the upgrade;
// the rows as finished; and v1's next session after that finish (its nextPrescription, git ce30c730).
const RUNNING = {
  'barbell linear: the session runs at the step the last one earned': {
    cfg: { id: BENCH, sets: 3, reps: 5, weight: 60, prog: 'linear' },
    sessions: [[{}, '5@60 5@60 5@60']],
    active: [{ weight: 62.5 }, '5@62.5 5@62.5 5@62.5', 1], finish: '5@62.5 5@62.5 5@62.5', v1: '5@65 5@65 5@65'
  },
  'barbell linear: a back-off session missed again holds the backed-off load': {
    cfg: { id: BENCH, sets: 3, reps: 5, weight: 60, prog: 'linear' },
    sessions: [[{}, '5@60 5@60 5@60'], [{ weight: 62.5 }, '4@62.5 4@62.5 4@62.5'], [{ weight: 62.5 }, '4@62.5 4@62.5 4@62.5'], [{ weight: 62.5 }, '4@62.5 4@62.5 4@62.5']],
    active: [{ weight: 55 }, '5@55 5@55 5@55', 1], finish: '4@55 4@55 4@55', v1: '5@55 5@55 5@55'
  },
  'double progression: the aim climbs one rep at the raised load': {
    cfg: { id: BENCH, sets: 3, reps: 10, repsMin: 6, weight: 40, prog: 'double' },
    sessions: [[{}, '10@40 10@40 10@40']],
    active: [{ weight: 42.5, reps: 6 }, '6@42.5 6@42.5 6@42.5', 1], finish: '6@42.5 6@42.5 6@42.5', v1: '7@42.5 7@42.5 7@42.5'
  },
  'bodyweight ladder: the rep climb goes on': {
    cfg: { id: SITUP, sets: 3, reps: 10, repsMax: 12, prog: 'linear' },
    sessions: [[{}, '10@0 10@0 10@0']],
    active: [{ weight: 0, reps: 11 }, '11@0 11@0 11@0', 1], finish: '11@0 11@0 11@0', v1: '12@0 12@0 12@0'
  },
  'timed hold: the seconds climb': {
    cfg: { id: PLANK, mode: 'time', sets: 3, sec: 30, prog: 'time' },
    sessions: [[{}, '30s 30s 30s']],
    active: [{ sec: 35 }, '35s 35s 35s', 1], finish: '35s 35s 35s', v1: '40s 40s 40s'
  },
  'per-side timed hold: a left and a right row are one set': {
    cfg: { id: PLANK, mode: 'time', sets: 2, sec: 30, prog: 'time', side: true },
    sessions: [],
    active: [{}, '30s:L 30s:R 30s:L 30s:R', 1], finish: '30s:L 30s:R 30s:L 30s:R', v1: '35s:L 35s:R 35s:L 35s:R'
  }
}

describe('a workout running at the upgrade, finished on v2, leads where v1 would have', () => {
  for (const [name, c] of Object.entries(RUNNING)) {
    it(name, () => {
      const { profile, activeSession } = migrateProfileV1ToV2(midSession(c), LIB_BY_ID)
      // The rows on screen are the ones v1 opened, ticks kept.
      expect(shown(activeSession.entries[0].sets)).toBe(c.active[1])
      const finished = finishOnV2(profile, activeSession, c.finish)
      expect(validateCanonicalProfile(finished).errors).toEqual([])
      expect(nextSession(finished)).toBe(c.v1)
      // Thrown away instead: v1 would start the same session again.
      expect(nextSession(profile)).toBe(c.active[1])
    })
  }
})
