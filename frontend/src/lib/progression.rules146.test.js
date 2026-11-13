import { describe, it, expect } from 'vitest'
import { nextPrescription, POLICIES_FOR, POLICY_NAME, POLICY_DESC, DELOAD_AFTER, dupReps, dupDayIndex, recentEstimatedMax, densityRestOf, DENSITY_STEP, policyFor } from './progression.js'
import { buildSessionEntries } from './session-start.js'
import { isWarmupRow } from './workout-model.js'
import { EXDB, isAssisted } from './exercises.js'

// The three rules added in 1.4.5: steady double progression, undulating days and shorter rests.
// Every one is derived from the log like the others, and every one is run here the way the app
// runs it: a session built from the routine, lifted, saved, and the next one built from that.
const LIFT = EXDB.find(e => e.bp !== 'cardio' && !['upper legs', 'lower legs', 'back', 'hips', 'glutes'].includes(e.bp) && !['body weight', 'band', 'resistance band'].includes(e.eq) && !isAssisted(e.id)).id
const work = rows => rows.filter(s => !isWarmupRow(s))

function rig(cfg, extra = {}) {
  const routine = { id: 'r', name: 'A', ex: [cfg] }
  let day = 0
  let st = { unit: 'kg', workouts: [], exWeights: {}, routines: [routine], ...extra }
  return {
    get st() { return st },
    routine,
    // `lift(aim, k)` is what set k got; all of them as asked when left out.
    train(lift = aim => aim) {
      const [entry] = buildSessionEntries(st, routine)
      let k = -1
      const sets = entry.sets.map(s => { if (isWarmupRow(s)) return { ...s, done: true }; k++; return { ...s, r: lift(s.r, k), done: true } })
      day++
      const w = { d: `2026-02-${String(day).padStart(2, '0')}`, routineId: 'r', entries: [{ ...entry, rid: 'r', sets }] }
      st = { ...st, workouts: [...st.workouts, w] }
      return entry
    },
  }
}

describe('the new rules are policies like the others', () => {
  it('are offered for rep work with a name, an explanation and a deload count', () => {
    for (const p of ['steady', 'undulating', 'density']) {
      expect(POLICIES_FOR.reps).toContain(p)
      expect(POLICIES_FOR.time).not.toContain(p)
      expect(POLICY_NAME[p]).toBeTruthy()
      expect(POLICY_DESC[p]).toBeTruthy()
      expect(POLICY_DESC[p]).not.toMatch(/—/)
    }
    expect(DELOAD_AFTER.steady).toBe(3)
    expect(DELOAD_AFTER.density).toBe(3)
  })

  it('leaves every old rule and an unknown one exactly where they were', () => {
    expect(policyFor({ prog: 'double' }, null, 'reps')).toBe('double')
    expect(policyFor({ prog: 'triple' }, null, 'reps')).toBe('triple')
    expect(policyFor({ prog: 'undulating' }, null, 'time')).toBe('off')
    expect(policyFor({ prog: 'something-newer' }, null, 'reps')).toBe('off')
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
    const p = nextPrescription(r.st, cfg, r.routine)
    expect(p).toMatchObject({ kind: 'hold', weight: 50, reps: 10 })
  })

  it('adds weight at the top of the range and goes back to the bottom', () => {
    const r = rig(cfg)
    r.train(); r.train(); r.train()
    const p = nextPrescription(r.st, cfg, r.routine)
    expect(p).toMatchObject({ kind: 'up', weight: 52.5, reps: 8 })
  })

  it('deloads after three misses in a row', () => {
    const r = rig(cfg)
    r.train()
    for (let i = 0; i < 3; i++) r.train(aim => aim - 2)
    expect(nextPrescription(r.st, cfg, r.routine).kind).toBe('deload')
  })

  it('reads an old double-progression history from where it stands', () => {
    const r = rig({ ...cfg, prog: 'double' })
    r.train(aim => aim - 1)                         // double opens at the top: 9, 9, 9 of 10
    const p = nextPrescription(r.st, cfg, r.routine)
    expect(p).toMatchObject({ policy: 'steady', kind: 'hold', weight: 50, reps: 10 })
    r.train()                                        // and once the top is clean, weight goes up
    expect(nextPrescription(r.st, cfg, r.routine)).toMatchObject({ policy: 'steady', kind: 'up', weight: 52.5, reps: 8 })
  })
})

describe('undulating days', () => {
  const cfg = { id: LIFT, sets: 3, reps: 8, weight: 60, inc: 2.5, mode: 'reps', prog: 'undulating' }

  it('reads the reps of each day off the plan, even for per-side work', () => {
    expect(dupReps({ reps: 8 }, 'medium')).toBe(8)
    expect(dupReps({ reps: 8 }, 'heavy')).toBe(5)
    expect(dupReps({ reps: 8 }, 'light')).toBe(12)
    const side = { id: LIFT, reps: 10, side: true }
    for (const d of ['medium', 'heavy', 'light']) expect(dupReps(side, d) % 2).toBe(0)
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
    expect(recentEstimatedMax([{ mode: 'reps', weight: 60, low: 12 }, { mode: 'reps', weight: 0, low: 10 }])).toBe(84)
    r.train(() => 1)                                  // a heavy day gone wrong
    const p = nextPrescription(r.st, cfg, r.routine)
    expect(p.dup).toBe(2)
    // The max still comes from the strong day: 60 × 12 → 84.
    expect(p.why[4]).toBeGreaterThanOrEqual(83.9)
  })

  it('rotates over the whole history, whichever routine trained the lift', () => {
    const sessions = [{ target: { dup: 0 } }, { target: {} }, { target: { dup: 1 } }]
    expect(dupDayIndex(sessions)).toBe(2)
    expect(dupDayIndex([])).toBe(0)
    expect(dupDayIndex([{ target: { dup: 2 } }])).toBe(0)
    expect(dupDayIndex([{ target: { dup: 'x' } }])).toBe(0)
  })

  it('leaves a bodyweight lift with nothing loaded to the bodyweight climb', () => {
    const pushup = EXDB.find(e => e.eq === 'body weight' && /push-up/.test(e.n) && !isAssisted(e.id))
    const c = { id: pushup.id, sets: 3, reps: 10, weight: 0, mode: 'reps', prog: 'undulating', bodyweight: true }
    const r = rig(c)
    r.train()
    const p = nextPrescription(r.st, c, r.routine)
    expect(p.weight).toBe(0)
    expect(p.dup).toBeUndefined()
  })
})

describe('shorter rests', () => {
  const cfg = { id: LIFT, sets: 3, reps: 8, weight: 40, inc: 2.5, mode: 'reps', prog: 'density', restSec: 90, restMin: 60 }

  it('takes its start from the exercise, then the profile, and its floor from the plan', () => {
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
    expect(nextPrescription(r.st, cfg, r.routine)).toMatchObject({ kind: 'hold', rest: 60, weight: 40 })
    r.train(aim => aim - 1); r.train(aim => aim - 1)
    expect(nextPrescription(r.st, cfg, r.routine)).toMatchObject({ kind: 'deload', weight: 40, rest: 90 })
  })

  it('never turns "No timer" back on', () => {
    const c = { ...cfg, restOff: true }
    const r = rig(c)
    r.train()
    const e = r.train()
    expect(e.target.restOff).toBe(true)
    expect(e.target.restSec).toBe(90)
  })
})
