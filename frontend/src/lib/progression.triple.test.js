import { describe, it, expect } from 'vitest'
import { nextPrescription, readSession, stallCount, sessionsFor, tripleSetsOf, plannedOf, planChanged, applyPrescription, POLICIES_FOR, POLICY_NAME, POLICY_DESC, DELOAD_AFTER } from './progression.js'
import { buildSessionEntries } from './session-start.js'
import { routineFromSession } from './session-routines.js'
import { isWarmupRow, makeSideSet } from './workout-model.js'
import { EXDB, isAssisted } from './exercises.js'

// Triple progression (issue #179): reps, then sets, then load.
const LIFT = EXDB.find(e => e.bp !== 'cardio' && !['upper legs', 'lower legs', 'back', 'hips', 'glutes'].includes(e.bp) && !['body weight', 'band', 'resistance band'].includes(e.eq) && !isAssisted(e.id)).id
const cfg = { id: LIFT, sets: 3, setsMax: 5, reps: 12, repsMin: 8, weight: 60, inc: 2.5, mode: 'reps', prog: 'triple' }
const routine = { id: 'r', name: 'A', ex: [cfg] }
const work = rows => rows.filter(s => !isWarmupRow(s))

// One session the way the app runs it: built from the routine, every set lifted with `lift(aim, k)`
// reps (all of them as asked when no function is given), then saved.
let day = 0
function train(st, lift = aim => aim) {
  const [entry] = buildSessionEntries(st, routine)
  const sets = entry.sets.map(s => (isWarmupRow(s) ? s : s))
  let k = -1
  const done = sets.map(s => { if (isWarmupRow(s)) return { ...s, done: true }; k++; return { ...s, r: lift(s.r, k), done: true } })
  day++
  const w = { d: `2026-01-${String(day).padStart(2, '0')}`, routineId: 'r', entries: [{ ...entry, rid: 'r', sets: done }] }
  return { st: { ...st, workouts: [...st.workouts, w] }, entry }
}
const aims = entry => work(entry.sets).map(s => s.r)
const fresh = () => { day = 0; return { unit: 'kg', workouts: [], exWeights: {}, routines: [routine] } }

describe('triple progression is a policy like the others', () => {
  it('is offered for rep work with a name, an explanation and the usual deload', () => {
    expect(POLICIES_FOR.reps).toContain('triple')
    expect(POLICIES_FOR.time).not.toContain('triple')
    expect(POLICY_NAME.triple).toBe('Triple progression')
    expect(POLICY_DESC.triple).toMatch(/set/)
    expect(DELOAD_AFTER.triple).toBe(3)
  })

  it('reads its set range off sets and setsMax, never below the base sets', () => {
    expect(tripleSetsOf({ sets: 3, setsMax: 5 })).toEqual({ setsMin: 3, setsMax: 5 })
    expect(tripleSetsOf({ sets: 3 })).toEqual({ setsMin: 3, setsMax: 3 })
    expect(tripleSetsOf({ sets: 4, setsMax: 2 })).toEqual({ setsMin: 4, setsMax: 4 })
    expect(tripleSetsOf({ sets: 3, setsMax: 99 }).setsMax).toBe(10)
  })

  it('stamps setsMax as part of the plan, so raising it starts the plan again', () => {
    expect(plannedOf(cfg)).toMatchObject({ sets: 3, reps: 12, repsMin: 8, setsMax: 5 })
    expect(planChanged(plannedOf(cfg), { ...cfg, setsMax: 6 })).toBe(true)
    expect(planChanged(plannedOf(cfg), cfg)).toBe(false)
    // A plan without it stamps exactly what it always did.
    expect('setsMax' in plannedOf({ ...cfg, setsMax: undefined, prog: 'double' })).toBe(false)
  })
})

describe('a full cycle: reps → sets → load', () => {
  it('climbs the base sets together, adds one set at a time, then raises the weight', () => {
    let st = fresh()
    const seen = []
    for (let i = 0; i < 26; i++) {
      const r = train(st)
      seen.push({ w: work(r.entry.sets)[0].w, aims: aims(r.entry) })
      st = r.st
    }
    const line = seen.map(s => `${s.w}:${s.aims.join(',')}`)
    expect(line.slice(0, 5)).toEqual(['60:8,8,8', '60:9,9,9', '60:10,10,10', '60:11,11,11', '60:12,12,12'])
    // The fourth set climbs alone, the first three stay at the top.
    expect(line.slice(5, 10)).toEqual(['60:12,12,12,8', '60:12,12,12,9', '60:12,12,12,10', '60:12,12,12,11', '60:12,12,12,12'])
    expect(line.slice(10, 15)).toEqual(['60:12,12,12,12,8', '60:12,12,12,12,9', '60:12,12,12,12,10', '60:12,12,12,12,11', '60:12,12,12,12,12'])
    // All five at the top: more weight, back to the base sets at the bottom of the range.
    expect(line[15]).toBe('62.5:8,8,8')
    expect(line.slice(16, 20)).toEqual(['62.5:9,9,9', '62.5:10,10,10', '62.5:11,11,11', '62.5:12,12,12'])
  })

  it('opens the first session at the base sets and the bottom of the range', () => {
    const [entry] = buildSessionEntries(fresh(), routine)
    expect(entry.plan).toMatchObject({ kind: 'first', sets: 3, reps: 8, rowReps: [8, 8, 8] })
    expect(aims(entry)).toEqual([8, 8, 8])
    expect(entry.target.rowReps).toEqual([8, 8, 8])
    expect(work(entry.sets).every(s => s.w === 60)).toBe(true)
  })

  it('counts reps beyond the aim: a set that already reached the top adds the next set', () => {
    let st = fresh()
    st = train(st, () => 12).st                        // asked for 8s, did 12s
    const p = nextPrescription(st, cfg, routine)
    expect(p).toMatchObject({ kind: 'up', sets: 4, rowReps: [12, 12, 12, 8], weight: 60 })
  })

  it('without a set ceiling above the base sets it is double progression with per-set aims', () => {
    const flat = { ...cfg, setsMax: undefined }
    const r = { ...routine, ex: [flat] }
    let st = { unit: 'kg', workouts: [], exWeights: {}, routines: [r] }
    const run = () => { const [entry] = buildSessionEntries(st, r); st = { ...st, workouts: [...st.workouts, { d: '2026-02-0' + (st.workouts.length + 1), routineId: 'r', entries: [{ ...entry, rid: 'r', sets: entry.sets.map(s => ({ ...s, r: 12, done: true })) }] }] }; return entry }
    run()
    expect(nextPrescription(st, flat, r)).toMatchObject({ kind: 'up', weight: 62.5, rowReps: [8, 8, 8] })
  })
})

describe('misses, stalls and deloads', () => {
  // Reach 12, 12, 12, 9 at 60 kg, then fail the fourth set in different ways.
  const atFourthSet = () => {
    let st = fresh()
    for (let i = 0; i < 7; i++) st = train(st).st
    return st
  }

  it('holds the same sets and reps after a miss, without cutting the added set', () => {
    let st = atFourthSet()
    expect(aims(train(st).entry)).toEqual([12, 12, 12, 10])
    st = train(st, (aim, k) => (k === 3 ? aim - 3 : aim)).st   // 12,12,12,7 of 12,12,12,10
    const p = nextPrescription(st, cfg, routine)
    expect(p).toMatchObject({ kind: 'hold', weight: 60, sets: 4, rowReps: [12, 12, 12, 10] })
    expect(p.why[0]).toBe('Missed reps last time. Same sets and reps again ({0} of {1} to go).')
  })

  it('more reps on the moving set is progress, so it does not count toward a deload', () => {
    let st = atFourthSet()
    st = train(st, (aim, k) => (k === 3 ? 7 : aim)).st         // aim 10, got 7
    st = train(st, (aim, k) => (k === 3 ? 8 : aim)).st         // got 8: better
    st = train(st, (aim, k) => (k === 3 ? 9 : aim)).st         // got 9: better again
    const sessions = sessionsFor(st, LIFT, cfg, 'r')
    expect(stallCount(sessions, 'triple')).toBe(0)
    const p = nextPrescription(st, cfg, routine)
    expect(p.kind).toBe('hold')
    expect(p.rowReps).toEqual([12, 12, 12, 10])
    expect(p.why[0]).toBe('Short of the target, but more reps than before. Same sets and reps again.')
  })

  it('three real stalls deload with Epley and start the cycle again at the base sets', () => {
    let st = atFourthSet()
    for (let i = 0; i < 3; i++) st = train(st, (aim, k) => (k === 3 ? 7 : aim)).st
    expect(stallCount(sessionsFor(st, LIFT, cfg, 'r'), 'triple')).toBe(3)
    const p = nextPrescription(st, cfg, routine)
    expect(p.kind).toBe('deload')
    expect(p.rowReps).toEqual([8, 8, 8])
    expect(p.sets).toBe(3)
    expect(p.weight).toBeLessThan(60)
    expect(p.weight % 2.5).toBe(0)
    // Epley: 60 × (1 + 12/30) × 0.9 is about 75.6 kg, which at 8 reps is about 59.7 kg: the grid
    // below 60 is 57.5.
    expect(p.weight).toBe(57.5)
    const [entry] = buildSessionEntries(st, routine)
    expect(aims(entry)).toEqual([8, 8, 8])
    expect(work(entry.sets).every(s => s.w === 57.5)).toBe(true)
  })

  it('a deloaded session that went well climbs again from there', () => {
    let st = atFourthSet()
    for (let i = 0; i < 3; i++) st = train(st, (aim, k) => (k === 3 ? 7 : aim)).st
    st = train(st).st                                           // 57.5 × 8, 8, 8 done
    expect(nextPrescription(st, cfg, routine)).toMatchObject({ kind: 'hold', weight: 57.5, rowReps: [9, 9, 9] })
  })
})

describe('triple progression keeps the rules every policy follows', () => {
  it('an edited plan starts again at the base sets', () => {
    let st = fresh()
    for (let i = 0; i < 7; i++) st = train(st).st                // at 12, 12, 12, 9
    const edited = { ...cfg, setsMax: 4 }
    const p = nextPrescription(st, edited, { ...routine, ex: [edited] })
    expect(p.why[0]).toBe('Plan changed, so starting from your new target.')
    expect(p.sets).toBe(3)
    expect(p.rowReps).toHaveLength(3)
  })

  it('a session judged against its own per-set aims, not the top of the range', () => {
    const entry = { id: LIFT, target: { ...cfg, sets: 4, reps: 12, rowReps: [12, 12, 12, 9] }, sets: [12, 12, 12, 9].map(r => ({ w: 60, r, done: true })) }
    expect(readSession(entry, cfg).ok).toBe(true)
    expect(readSession({ ...entry, sets: [12, 12, 12, 8].map(r => ({ w: 60, r, done: true })) }, cfg).ok).toBe(false)
    // The current config never lends a session aims it was not built with.
    expect(readSession({ id: LIFT, sets: [12, 12, 12, 9].map(r => ({ w: 60, r, done: true })) }, { ...cfg, reps: 12, rowReps: [12, 12, 12, 9] }).ok).toBe(false)
  })

  it('a session in progress keeps its logged rows when the aims are applied', () => {
    const rows = [{ w: 60, r: 10, done: true }, { w: 60, r: 8, done: false }, { w: 60, r: 8, done: false }]
    const out = applyPrescription(rows, { kind: 'hold', weight: 60, reps: 12, sets: 4, rowReps: [12, 12, 12, 8] }, 2.5)
    expect(out.map(s => s.r)).toEqual([10, 12, 12, 8])
    expect(out).toHaveLength(4)
  })

  it('splits the aims across the sides of a unilateral set', () => {
    const rows = [makeSideSet({ w: 20, r: 16 }), makeSideSet({ w: 20, r: 16 })]
    const out = applyPrescription(rows, { kind: 'hold', weight: 20, reps: 20, sets: 3, rowReps: [20, 20, 16] }, 2.5)
    expect(out.map(s => [s.sides.L.r, s.sides.R.r])).toEqual([[10, 10], [10, 10], [8, 8]])
  })

  it('an assistance machine takes less help as its raise', () => {
    const c = { ...cfg, assisted: true, sets: 1, setsMax: 1, reps: 10, repsMin: 8, weight: 40, inc: 5 }
    const r = { ...routine, ex: [c] }
    const st = { unit: 'kg', exWeights: {}, routines: [r], workouts: [{ d: '2026-03-01', routineId: 'r', entries: [{ id: c.id, rid: 'r', planned: plannedOf(c), target: { ...c, sets: 1, reps: 10, rowReps: [10] }, sets: [{ w: 40, r: 10, done: true }] }] }] }
    expect(nextPrescription(st, c, r)).toMatchObject({ kind: 'up', weight: 35, rowReps: [8] })
  })

  it('a routine copied from a session does not take the day’s per-set aims as its plan', () => {
    const st = train(fresh()).st
    const copied = routineFromSession(st.workouts[0], 'Copy', [routine]).ex[0]
    expect('rowReps' in copied).toBe(false)
    expect(copied.setsMax).toBe(5)
  })

  it('leaves linear and double progression exactly as they were', () => {
    const st = { unit: 'kg', exWeights: {}, routines: [], workouts: [{ d: '2026-03-01', entries: [{ id: LIFT, target: { sets: 3, reps: 12, repsMin: 8 }, sets: [10, 10, 10].map(r => ({ w: 60, r, done: true })) }] }] }
    const dbl = nextPrescription(st, { ...cfg, prog: 'double', setsMax: undefined }, null)
    expect(dbl).toMatchObject({ kind: 'hold', weight: 60, reps: 11 })
    expect('rowReps' in dbl).toBe(false)
    const lin = nextPrescription(st, { ...cfg, prog: 'linear', setsMax: undefined }, null)
    expect('rowReps' in lin).toBe(false)
  })
})

describe('triple progression in the plan around it', () => {
  it('reads its set range on the routine line', async () => {
    const { setsRepsOf, exLine } = await import('./history.js')
    expect(setsRepsOf(cfg)).toBe('3–5 × 8–12')
    expect(exLine(cfg, 'kg')).toBe('3–5 × 8–12 · 60 kg')
    expect(setsRepsOf({ ...cfg, setsMax: undefined })).toBe('3 × 8–12')
  })

  it('travels with a shared plan', async () => {
    const { buildPlanBundle, parsePlan } = await import('./plan-share.js')
    const S = { unit: 'kg', week: {}, customEx: [], routines: [routine] }
    const ex = parsePlan(JSON.stringify(buildPlanBundle(S, 'Plan'))).routines[0].ex[0]
    expect(ex).toMatchObject({ prog: 'triple', sets: 3, setsMax: 5, reps: 12, repsMin: 8 })
  })
})
