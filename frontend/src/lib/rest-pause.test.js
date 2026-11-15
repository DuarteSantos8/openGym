import { describe, it, expect } from 'vitest'
import {
  restPausePlan, restPauseAim, restPauseToSave, burstReps, restPauseRow, readRestPauseRow,
  judgeRestPause, restPausePrescription, RP_BURSTS_MAX, RP_DELOAD_AFTER,
} from './rest-pause.js'
import { buildPlannedEntry } from './session-start.js'
import { readSession, nextPrescription } from './progression.js'
import { isWarmupRow, syncSideAggregate } from './workout-model.js'
import { setLabel } from './history.js'

const BENCH = '0025'
const rp = (extra = {}, cfg = {}) => ({ id: BENCH, reps: 10, sets: 1, weight: 60, mode: 'reps', prog: 'linear', intensifier: { type: 'restpause', bursts: 3, total: 20, totalMax: 22, restSec: 15, ...extra }, ...cfg })

describe('restPausePlan', () => {
  it('is null for anything that does not plan rest-pause', () => {
    expect(restPausePlan({ reps: 8 })).toBeNull()
    expect(restPausePlan({ reps: 8, intensifier: { type: 'dropset', count: 1, pct: 20 } })).toBeNull()
    expect(restPausePlan(null)).toBeNull()
  })

  it('reads the plan, the activation set being the exercise\'s own reps', () => {
    expect(restPausePlan(rp())).toEqual({ activation: 10, bursts: 3, total: 20, totalMax: 22, restSec: 15, legacy: false })
  })

  it('reads a pre-1.4.6 plan as the bursts its total halved into, and that total past the activation set', () => {
    // 12 past 8: 6+3+2+1, four bursts, 20 in all; no range, so the top is where it starts
    expect(restPausePlan({ reps: 8, intensifier: { type: 'restpause', totalReps: 12, restSec: 20 } }))
      .toEqual({ activation: 8, bursts: 4, total: 20, totalMax: 20, restSec: 20, legacy: true })
  })

  it('holds every number to something trainable', () => {
    const plan = restPausePlan({ reps: 10, intensifier: { type: 'restpause', bursts: 40, total: 3, totalMax: 1, restSec: 1 } })
    expect(plan.bursts).toBe(RP_BURSTS_MAX)
    // every burst gets a rep, and the top of the range is never under where it starts
    expect(plan.total).toBe(10 + RP_BURSTS_MAX)
    expect(plan.totalMax).toBe(plan.total)
    expect(plan.restSec).toBe(5)
  })

  it('saves the new fields only, a session\'s aim and the old total left behind', () => {
    expect(restPauseToSave({ reps: 8, intensifier: { type: 'restpause', totalReps: 12, restSec: 15, aim: 21 } }))
      .toEqual({ type: 'restpause', bursts: 4, total: 20, totalMax: 20, restSec: 15 })
  })
})

describe('restPauseAim', () => {
  it('is where the plan starts, or the aim a session was stamped with, inside the range', () => {
    expect(restPauseAim(rp())).toBe(20)
    expect(restPauseAim(rp({ aim: 21 }))).toBe(21)
    expect(restPauseAim(rp({ aim: 40 }))).toBe(22)
    expect(restPauseAim(rp({ aim: 2 }))).toBe(20)
  })
})

describe('burstReps', () => {
  it('shares what the activation set leaves over, the first bursts taking the odd reps', () => {
    expect(burstReps(20, 10, 3)).toEqual([4, 3, 3])
    expect(burstReps(16, 10, 3)).toEqual([2, 2, 2])
    expect(burstReps(12, 10, 3)).toEqual([1, 1])
    expect(burstReps(10, 10, 3)).toEqual([])
    expect(burstReps(18, 10, 1)).toEqual([8])
  })
})

describe('reading a rest-pause row back', () => {
  const row = restPauseRow(restPausePlan(rp()), 20, 60)

  it('builds one row whose reps are the whole set and whose clusters are the bursts', () => {
    expect(row).toEqual({ w: 60, r: 20, done: false, type: 'restpause', act: true, clusters: [4, 3, 3].map(r => ({ r, restSec: 15 })) })
  })

  it('reads the activation set as what the bursts leave over', () => {
    expect(readRestPauseRow({ ...row, done: true })).toEqual({ done: true, planned: true, act: 10, total: 20, bursts: 3 })
    // one fewer rep on the last burst: the total drops, the activation set is what it was
    const short = { ...row, done: true, r: 19, clusters: [{ r: 4 }, { r: 3 }, { r: 2 }] }
    expect(readRestPauseRow(short)).toMatchObject({ act: 10, total: 19 })
  })

  it('adds up the sides of a per-side row that were ticked', () => {
    const plan = restPausePlan(rp({}, { side: true }))
    const sided = restPauseRow(plan, 20, 20, { perSide: true, sides: (base, L, R) => syncSideAggregate({ ...base, sides: { L, R } }) })
    expect(sided.r).toBe(20)
    const both = syncSideAggregate({ ...sided, sides: { L: { ...sided.sides.L, done: true }, R: { ...sided.sides.R, done: true } } })
    expect(readRestPauseRow(both)).toEqual({ done: true, planned: true, act: 10, total: 20, bursts: 3 })
  })

  it('cannot judge a row from before the activation set lived in it', () => {
    const old = { w: 60, r: 12, done: true, type: 'restpause', clusters: [6, 3, 2, 1].map(r => ({ r, restSec: 15 })) }
    expect(readRestPauseRow(old).planned).toBe(false)
    expect(judgeRestPause(rp(), old).ok).toBe(false)
  })

  it('is done when the activation set reached its reps and the whole set its total', () => {
    expect(judgeRestPause(rp(), { ...row, done: true }).ok).toBe(true)
    // the total, but carried by the bursts after a short activation set: not the plan done
    expect(judgeRestPause(rp(), { ...row, done: true, clusters: [{ r: 5 }, { r: 4 }, { r: 3 }] }).ok).toBe(false)
    // unticked
    expect(judgeRestPause(rp(), row).ok).toBe(false)
  })
})

describe('restPausePrescription: double progression on the total', () => {
  const session = (aim, total, act = 10, extra = {}) => ({
    weight: 60, rp: { planned: true, aim, total, act, key: '10/3/20/22', ok: total >= aim && act >= 10 }, ...extra,
  })
  const args = (sessions, cfg = rp()) => ({ cfg, sessions, policy: 'linear', harder: w => w + 2.5, easier: w => w - 5 })

  it('starts at the plan\'s total with nothing logged', () => {
    expect(restPausePrescription(args([]))).toMatchObject({ kind: 'first', rpAim: 20 })
  })

  it('a clean session adds a rep to the total at the same weight', () => {
    expect(restPausePrescription(args([session(20, 20)]))).toMatchObject({ kind: 'up', weight: 60, rpAim: 21 })
  })

  it('past the top of the range the weight goes up and the total starts over', () => {
    expect(restPausePrescription(args([session(20, 20), session(21, 21), session(22, 22)])))
      .toMatchObject({ kind: 'up', weight: 62.5, rpAim: 20 })
  })

  it('a miss keeps the target, and misses in a row take the weight down', () => {
    expect(restPausePrescription(args([session(21, 19)]))).toMatchObject({ kind: 'hold', weight: 60, rpAim: 21 })
    const misses = Array.from({ length: RP_DELOAD_AFTER }, () => session(21, 19))
    expect(restPausePrescription(args(misses))).toMatchObject({ kind: 'deload', weight: 55, rpAim: 20 })
  })

  it('starts over from the plan\'s total when the plan changed, or the history is from before', () => {
    const edited = rp({ total: 18 })
    expect(restPausePrescription(args([session(20, 20)], edited))).toMatchObject({ kind: 'hold', weight: 60, rpAim: 18 })
    expect(restPausePrescription(args([{ weight: 60, rp: { planned: false, key: '10/3/20/22' } }]))).toMatchObject({ kind: 'hold', weight: 60, rpAim: 20 })
  })

  it('work with no load to add stays at the top and says so', () => {
    const out = restPausePrescription({ ...args([session(22, 22, 10, { weight: 0 })]), weightless: true })
    expect(out).toMatchObject({ kind: 'hold', rpAim: 22 })
    expect(out.why[0]).toMatch(/add weight or try a harder variation/)
  })
})

// The whole loop, the way the app runs it: build the session from the routine, log it, finish it,
// and build the next one from the history. This is what was broken before 1.4.6: the plan's three
// sets were read against one rest-pause row, so every session was short and nothing ever moved.
describe('a rest-pause routine over several weeks', () => {
  const routine = cfg => ({ id: 'A', name: 'A', ex: [cfg] })
  const start = cfg => ({ unit: 'kg', exWeights: {}, routines: [routine(cfg)], startFrom: 'plan', workouts: [], week: {}, dayPlan: {} })
  const build = st => buildPlannedEntry(st, st.routines[0].ex[0], st.routines[0])
  // Log every row as planned, or with `short` reps fewer on the last burst.
  const log = (entry, short = 0) => ({
    ...entry,
    sets: entry.sets.map(s => {
      if (s.sides) return syncSideAggregate({ ...s, sides: { L: { ...s.sides.L, done: true }, R: { ...s.sides.R, done: true } } })
      if (isWarmupRow(s) || short <= 0) return { ...s, done: true }
      const clusters = s.clusters.map((c, i) => (i === s.clusters.length - 1 ? { ...c, r: c.r - short } : c))
      return { ...s, r: s.r - short, clusters, done: true }
    }),
  })
  const finish = (st, entry, i) => ({ ...st, workouts: [...st.workouts, { id: 'w' + i, d: `2026-09-${String(10 + i).padStart(2, '0')}`, routineIds: ['A'], entries: [{ id: BENCH, ...entry, rid: 'A' }] }] })
  const workRow = entry => entry.sets.find(s => !isWarmupRow(s))

  it('climbs the total, then the weight, then starts the total again', () => {
    let st = start(rp({}, { sets: 3, warmupSets: 0 }))
    const seen = []
    for (let i = 0; i < 4; i++) {
      const entry = build(st)
      // three sets on the plan still train as one rest-pause row
      expect(entry.sets.filter(s => !isWarmupRow(s))).toHaveLength(1)
      const row = workRow(entry)
      seen.push([row.w, row.r, setLabel(BENCH, row, entry.target)])
      st = finish(st, log(entry), i)
    }
    expect(seen).toEqual([
      [60, 20, '60×10+4+3+3'],
      [60, 21, '60×10+4+4+3'],
      [60, 22, '60×10+4+4+4'],
      [62.5, 20, '62.5×10+4+3+3'],
    ])
  })

  it('reads a finished session as done, against the total it aimed for', () => {
    const st = start(rp())
    const entry = log(build(st))
    expect(readSession(entry)).toMatchObject({ ok: true, goal: 20, rp: { act: 10, total: 20 } })
    expect(readSession(log(build(st), 1))).toMatchObject({ ok: false, rp: { total: 19 } })
  })

  it('holds the target after a miss and deloads after three', () => {
    let st = start(rp())
    const aims = []
    for (let i = 0; i < 4; i++) {
      const entry = build(st)
      aims.push([workRow(entry).w, workRow(entry).r, entry.plan.kind])
      st = finish(st, log(entry, 2), i)
    }
    expect(aims).toEqual([[60, 20, 'first'], [60, 20, 'hold'], [60, 20, 'hold'], [55, 20, 'deload']])
  })

  it('a pre-1.4.6 history starts the new plan at the weight last lifted instead of reading it as misses', () => {
    const cfg = { id: BENCH, reps: 8, sets: 1, weight: 60, mode: 'reps', prog: 'linear', intensifier: { type: 'restpause', totalReps: 12, restSec: 15 } }
    const old = { id: 'old', d: '2026-09-01', routineIds: ['A'], entries: [{ id: BENCH, rid: 'A', target: { ...cfg }, sets: [
      { w: 70, r: 8, done: true, phase: 'warmup' },
      { w: 70, r: 12, done: true, type: 'restpause', clusters: [6, 3, 2, 1].map(r => ({ r, restSec: 15 })) },
    ] }] }
    const st = { ...start(cfg), workouts: [old, { ...old, id: 'old2', d: '2026-09-03' }, { ...old, id: 'old3', d: '2026-09-05' }] }
    const p = nextPrescription(st, cfg, st.routines[0])
    expect(p).toMatchObject({ kind: 'hold', weight: 70, rpAim: 20 })
    expect(workRow(build(st))).toMatchObject({ w: 70, r: 20, act: true })
  })

  it('a per-side rest-pause climbs by two, one rep a side', () => {
    let st = start(rp({}, { side: true }))
    const first = build(st)
    st = finish(st, log(first), 0)
    expect(workRow(build(st)).r).toBe(22)
  })

  it('with progression off it trains the plan\'s total every time', () => {
    let st = start(rp({}, { prog: 'off' }))
    st = finish(st, log(build(st)), 0)
    expect(workRow(build(st))).toMatchObject({ w: 60, r: 20 })
  })
})

