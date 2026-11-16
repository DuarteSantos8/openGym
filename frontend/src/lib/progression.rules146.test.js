// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { presetForPolicy, policyOfPreset, defaultDeload, planOptions } from './prescription/index.js'
import { PRESET_LABEL, PRESET_HINT } from '../components/RuleEditor.jsx'
import { dupReps, dupDayIndex, recentEstimatedMax } from './undulating.js'
import { buildSessionExposures } from './session-start.js'
import { entriesForExposures } from './session-ui-adapter.js'
import { buildCompletedSession } from './finish-session.js'
import { migratedFixture } from './test-fixtures.js'
import { isWarmupRow } from './workout-model.js'
import { EXDB, isAssisted } from './exercises.js'

// The three rules added in 1.4.5: steady double progression, undulating days and shorter rests.
// Every one is run here the way the app runs it on v2: a session started from the routine,
// lifted, finished, and the next one started from that.
const LIFT = EXDB.find(e => e.bp !== 'cardio' && !['upper legs', 'lower legs', 'back', 'hips', 'glutes'].includes(e.bp) && !['body weight', 'band', 'resistance band'].includes(e.eq) && !isAssisted(e.id)).id
const work = rows => rows.filter(s => !isWarmupRow(s))
const DENSITY_STEP = 15

function rig(cfg, extra = {}) {
  let st = migratedFixture({ unit: 'kg', workouts: [], exWeights: {}, routines: [{ id: 'r', name: 'A', ex: [cfg] }], ...extra })
  let day = 0
  // The session Start would open now: the exposure, and the workout screen's entry with its plan.
  const open = () => {
    const d = `2026-02-${String(day + 1).padStart(2, '0')}`
    const draft = { ...st, prescriptions: { ...st.prescriptions } }
    const [x] = buildSessionExposures(draft, draft.routines[0], { now: Date.parse(d + 'T10:00:00Z'), newId: v => v + d })
    const [e] = entriesForExposures([x], draft.prescriptions, draft)
    return { draft, x, d, entry: { ...e, plan: x.plan } }
  }
  return {
    get st() { return st },
    // The slot edited to another v1 config: its rule replaced, the slot (and its track) kept.
    edit(next) {
      const [o] = migratedFixture({ unit: 'kg', workouts: [], routines: [{ id: 'r', name: 'A', ex: [next] }] }).routines[0].ex
      const cur = st.routines[0].ex[0]
      st = { ...st, routines: [{ ...st.routines[0], ex: [{ ...cur, rule: { ...o.rule, id: cur.rule.id, revision: (cur.rule.revision || 1) + 1 } }] }] }
    },
    // The next session's plan, read as v1's prescription was: { kind, weight, reps, rest, dup }.
    next() {
      const { entry } = open()
      const w = work(entry.sets)[0]
      return { ...(entry.plan || {}), weight: w.w ?? 0, reps: w.r, rest: entry.target.restSec, dup: entry.target.dup }
    },
    // `lift(aim, k)` is what set k got; all of them as asked when left out.
    train(lift = aim => aim) {
      const { draft, x, d, entry } = open()
      let k = -1
      const sets = entry.sets.map(s => { if (isWarmupRow(s)) return { ...s, done: true }; k++; return { ...s, r: lift(s.r, k), done: true } })
      day++
      const live = { id: 'w' + day, d, start: Date.parse(d + 'T10:00:00Z'), routineIds: ['r'], name: 'A', exposures: [x], entries: [{ ...entry, sets }] }
      const done = buildCompletedSession(live, draft, { end: live.start + 1, newId: v => v + d, unit: 'kg' })
      st = { ...draft, workouts: [...draft.workouts, done.session], progression: { ...draft.progression, ...done.progression } }
      return entry
    },
  }
}

describe('the new rules are policies like the others', () => {
  it('are offered for rep work with a name, an explanation and a deload count', () => {
    for (const p of ['steady', 'undulating', 'density']) {
      expect(presetForPolicy(p, 'reps', false)).toBe(p)
      expect(presetForPolicy(p, 'time', false)).not.toBe(p)
      expect(policyOfPreset(p)).toBe(p)
      expect(PRESET_LABEL[p]).toBeTruthy()
      expect(PRESET_HINT[p]).toBeTruthy()
      expect(PRESET_HINT[p]).not.toMatch(/—/)
    }
    expect(defaultDeload('steady').after).toBe(3)
    expect(defaultDeload('density').after).toBe(3)
  })

  it('leaves every old rule and an unknown one exactly where they were', () => {
    expect(presetForPolicy('double', 'reps', false)).toBe('double')
    expect(presetForPolicy('triple', 'reps', false)).toBe('triple')
    expect(presetForPolicy('undulating', 'time', false)).toBe('manual')
    expect(presetForPolicy('something-newer', 'reps', false)).toBe('manual')
  })
})

describe('steady double progression', () => {
  const cfg = { id: LIFT, sets: 3, reps: 10, repsMin: 8, weight: 50, inc: 2.5, mode: 'reps', prog: 'steady' }

  it('starts at the bottom of the range and climbs one rep only after every set hit it', () => {
    const r = rig(cfg)
    const e1 = r.train()
    expect(work(e1.sets).map(s => s.r)).toEqual([8, 8, 8])
    const e2 = r.train()
    expect(work(e2.sets).map(s => s.r)).toEqual([9, 9, 9])
    expect(work(e2.sets)[0].w).toBe(50)
    // One set short of 10: unlike double progression, the target does not follow the weak set
    // up or down, it simply stays.
    const e3 = r.train((aim, k) => (k === 2 ? aim - 1 : aim + 1))
    expect(work(e3.sets).map(s => s.r)).toEqual([10, 10, 10])
    const p = r.next()
    expect(p).toMatchObject({ kind: 'hold', weight: 50, reps: 10 })
  })

  it('adds weight at the top of the range and goes back to the bottom', () => {
    const r = rig(cfg)
    r.train(); r.train(); r.train()
    const p = r.next()
    expect(p).toMatchObject({ kind: 'up', weight: 52.5, reps: 8 })
  })

  it('deloads after three misses in a row', () => {
    const r = rig(cfg)
    r.train()
    for (let i = 0; i < 3; i++) r.train(aim => aim - 2)
    expect(r.next().kind).toBe('deload')
  })

  // v1 read the double's history on from where it stood (10 reps, then 52.5 kg). v2 restarts a slot
  // whose rule changed from the plan (engine planFingerprint): the weight stays, the reps go back to
  // the bottom of the range. A known difference, left to the owner (.superpowers/rebase-145/LEDGER.md).
  it('switched from double progression, keeps the weight and climbs the range again', () => {
    const r = rig({ ...cfg, prog: 'double' })
    r.train(aim => aim - 1)                         // double opens at the top: 9, 9, 9 of 10
    r.edit(cfg)
    expect(r.next()).toMatchObject({ policy: 'steady', weight: 50, reps: 8 })
    r.train()
    expect(r.next()).toMatchObject({ policy: 'steady', kind: 'hold', weight: 50, reps: 9, why: ['Every set hit {0}. Same weight, {1} reps this time.', 8, 9] })
  })
})

describe('undulating days', () => {
  const cfg = { id: LIFT, sets: 3, reps: 8, weight: 60, inc: 2.5, mode: 'reps', prog: 'undulating' }

  it('reads the reps of each day off the plan, even for per-side work', () => {
    expect(dupReps(8, 'medium')).toBe(8)
    expect(dupReps(8, 'heavy')).toBe(5)
    expect(dupReps(8, 'light')).toBe(12)
    for (const d of ['medium', 'heavy', 'light']) expect(dupReps(10, d, true) % 2).toBe(0)
  })

  it('rotates medium, heavy, light and back, stamping the day on each session', () => {
    const r = rig(cfg)
    const days = []
    const reps = []
    for (let i = 0; i < 5; i++) {
      const e = r.train()
      days.push(e.target.dup)
      reps.push(work(e.sets)[0].r)
    }
    expect(days).toEqual([0, 1, 2, 0, 1])
    expect(reps).toEqual([8, 5, 12, 8, 5])
  })

  it('takes the weights from the estimated max: heavier on the heavy day, lighter on the light one', () => {
    const r = rig(cfg)
    r.train()                                        // 60 × 8, baseline
    const heavy = r.train()
    const light = r.train()
    const wH = work(heavy.sets)[0].w
    const wL = work(light.sets)[0].w
    expect(wH).toBeGreaterThan(wL)
    expect(wH % 2.5).toBe(0)
    expect(wL % 2.5).toBe(0)
    // 60 × 8 is an Epley max of 76; heavy at 5 reps with two in reserve lands near 61.
    expect(Math.abs(wH - 76 / (1 + 7 / 30))).toBeLessThanOrEqual(1.25)
  })

  it('climbs when more reps go up at the same weight, and a bad day does not drag it down', () => {
    const r = rig(cfg)
    r.train(aim => aim + 4)                           // a strong medium day
    expect(recentEstimatedMax([])).toBeNull()
    expect(recentEstimatedMax([{ weight: 60, low: 12 }, { weight: 0, low: 10 }])).toBe(84)
    r.train(() => 1)                                  // a heavy day gone wrong
    const p = r.next()
    expect(p.dup).toBe(2)
    // The max still comes from the strong day: 60 × 12 → 84.
    expect(p.why[4]).toBeGreaterThanOrEqual(83.9)
  })

  it('rotates over the whole history, whichever routine trained the lift', () => {
    const sessions = [{ dup: 0 }, {}, { dup: 1 }]
    expect(dupDayIndex(sessions)).toBe(2)
    expect(dupDayIndex([])).toBe(0)
    expect(dupDayIndex([{ dup: 2 }])).toBe(0)
    expect(dupDayIndex([{ dup: 'x' }])).toBe(0)
  })

  it('leaves a bodyweight lift with nothing loaded to the bodyweight climb', () => {
    const pushup = EXDB.find(e => e.eq === 'body weight' && /push-up/.test(e.n) && !isAssisted(e.id))
    const c = { id: pushup.id, sets: 3, reps: 10, weight: 0, mode: 'reps', prog: 'undulating', bodyweight: true }
    const r = rig(c)
    r.train()
    const p = r.next()
    expect(p.weight).toBe(0)
    expect(p.dup).toBeUndefined()
  })
})

describe('shorter rests', () => {
  const cfg = { id: LIFT, sets: 3, reps: 8, weight: 40, inc: 2.5, mode: 'reps', prog: 'density', restSec: 90, restMin: 60 }

  it('takes its start from the exercise, then the profile, and its floor from the plan', () => {
    // v2: the migration writes them onto the rule (planOptions restSeconds / restFloor).
    const densityRestOf = (S, c) => {
      const o = planOptions(migratedFixture({ unit: 'kg', ...S, routines: [{ id: 'r', name: 'A', ex: [{ id: LIFT, sets: 3, reps: 8, weight: 40, prog: 'density', ...c }] }], workouts: [] }).routines[0].ex[0].rule)
      return { start: o.restSeconds, floor: o.restFloor }
    }
    expect(densityRestOf({ restSec: 120 }, { restSec: 90, restMin: 60 })).toEqual({ start: 90, floor: 60 })
    expect(densityRestOf({ restSec: 120 }, {})).toEqual({ start: 120, floor: 45 })
    expect(densityRestOf({}, { restMin: 200 })).toEqual({ start: 90, floor: 90 })
  })

  it('shortens the rest after each clean session, then adds weight and starts the rest over', () => {
    const r = rig(cfg)
    const rests = []
    const weights = []
    for (let i = 0; i < 4; i++) {
      const e = r.train()
      rests.push(e.target.restSec)
      weights.push(work(e.sets)[0].w)
    }
    expect(rests).toEqual([90, 90 - DENSITY_STEP, 90 - 2 * DENSITY_STEP, 90])
    expect(weights).toEqual([40, 40, 40, 42.5])
  })

  it('holds the rest after a miss and gives rest back, not weight, after three', () => {
    const r = rig(cfg)
    r.train(); r.train()                              // 90 s, then 75 s
    r.train(aim => aim - 1)                           // 60 s, one rep short
    expect(r.next()).toMatchObject({ kind: 'hold', rest: 60, weight: 40 })
    r.train(aim => aim - 1); r.train(aim => aim - 1)
    expect(r.next()).toMatchObject({ kind: 'deload', weight: 40, rest: 90 })
  })

  it('never turns "No timer" back on', () => {
    const c = { ...cfg, restOff: true }
    const r = rig(c)
    r.train()
    const e = r.train()
    expect(e.target.restOff).toBe(true)
    // v2 shows "No timer" as no rest on the card (session-ui-adapter.js); the plan's own is still 90.
    expect(planOptions(r.st.routines[0].ex[0].rule).restSeconds).toBe(90)
  })
})
