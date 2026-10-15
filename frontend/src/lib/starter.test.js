import { describe, expect, it } from 'vitest'
import { EXIDX } from './exercises.js'
import { ALL_EQUIPMENT, eqAvailable } from './equipment.js'
import { buildStarterPlan, starterPlanDays, starterPlanOptions, starterRoutines } from './starter.js'

// The approved prescription, written out again rather than imported: a test that reads the
// same table as the code would pass no matter what that table said. [weekday, name, sets].
const APPROVED = {
  ppl: [
    [1, 'Push Day', [['0025', 4, 8], ['0047', 3, 10], ['0426', 3, 10], ['0334', 3, 12], ['0241', 3, 12], ['0251', 3, 10]]],
    [3, 'Pull Day', [['2330', 4, 10], ['0027', 4, 8], ['1323', 3, 10], ['0031', 3, 10], ['0313', 3, 12]]],
    [5, 'Leg Day', [['0043', 4, 8], ['0085', 3, 10], ['0739', 3, 12], ['0585', 3, 12], ['0586', 3, 12], ['0605', 4, 15]]],
  ],
  'upper-lower': [
    [1, 'Upper A', [['0025', 3, 8], ['2330', 3, 10], ['0047', 2, 10], ['1323', 2, 10], ['0334', 2, 12], ['0241', 2, 12], ['0031', 2, 12]]],
    [2, 'Lower A', [['0043', 3, 8], ['0085', 3, 8], ['0739', 2, 10], ['0586', 2, 12], ['0605', 3, 15]]],
    [4, 'Upper B', [['0047', 3, 8], ['0027', 3, 8], ['0426', 2, 10], ['2330', 2, 10], ['0334', 2, 12], ['0241', 2, 12], ['0313', 2, 12]]],
    [5, 'Lower B', [['0739', 3, 10], ['0085', 2, 10], ['0585', 2, 12], ['0586', 3, 12], ['0605', 3, 15]]],
  ],
  'full-body': [
    [1, 'Full Body A', [['0043', 3, 8], ['0025', 3, 8], ['2330', 3, 10], ['0586', 3, 12], ['0334', 2, 12], ['0031', 2, 12]]],
    [3, 'Full Body B', [['0085', 3, 8], ['0047', 3, 10], ['1323', 3, 10], ['0585', 3, 12], ['0334', 2, 12], ['0241', 2, 12]]],
    [5, 'Full Body C', [['0739', 3, 10], ['0025', 2, 10], ['0027', 3, 10], ['0426', 2, 10], ['0586', 3, 12], ['0605', 3, 15]]],
  ],
  '5x5': [
    [1, '5×5 A', [['0043', 5, 5], ['0025', 5, 5], ['0027', 5, 5]]],
    [3, '5×5 B', [['0085', 5, 5], ['0426', 5, 5], ['2330', 5, 5]]],
    [5, '5×5 C', [['0739', 5, 5], ['0047', 5, 5], ['1323', 5, 5]]],
  ],
  // The plans for onboarding, which picks one by days a week (2, 5, 6); the chooser does not list them.
  'full-body-2': [
    [1, '2-Day Full Body A', [['0043', 3, 8], ['0025', 3, 8], ['2330', 3, 10], ['0586', 2, 12], ['0426', 2, 10], ['0031', 2, 12], ['0605', 2, 15]]],
    [4, '2-Day Full Body B', [['0085', 3, 8], ['0047', 3, 8], ['0027', 3, 10], ['0739', 3, 10], ['0334', 2, 12], ['0241', 2, 12], ['0585', 2, 12]]],
  ],
  'upper-lower-ppl': [
    [1, 'Upper', [['0025', 3, 8], ['0027', 3, 8], ['0426', 3, 10], ['2330', 3, 10], ['0334', 2, 12], ['0241', 2, 12], ['0031', 2, 12]]],
    [2, 'Lower', [['0043', 3, 8], ['0085', 3, 8], ['0739', 2, 10], ['0586', 2, 12], ['0605', 3, 15]]],
    [4, 'Push', [['0047', 3, 8], ['0289', 3, 10], ['0405', 3, 10], ['0334', 3, 12], ['0241', 3, 12], ['0251', 2, 10]]],
    [5, 'Pull', [['0198', 3, 10], ['0293', 3, 10], ['1323', 3, 10], ['5609', 3, 15], ['0313', 3, 12]]],
    [6, 'Legs', [['0739', 3, 10], ['1060', 3, 10], ['0585', 3, 12], ['0586', 3, 12], ['0605', 4, 15]]],
  ],
  'ppl-6': [
    [1, 'Push A', [['0025', 4, 8], ['0426', 3, 10], ['0314', 3, 10], ['0334', 3, 12], ['0241', 3, 12], ['0251', 2, 10]]],
    [2, 'Pull A', [['2330', 4, 10], ['0027', 4, 8], ['1323', 3, 10], ['5609', 3, 15], ['0031', 3, 10]]],
    [3, 'Legs A', [['0043', 4, 8], ['0085', 3, 10], ['0739', 3, 12], ['0586', 3, 12], ['0605', 4, 15]]],
    [4, 'Push B', [['0047', 4, 8], ['0405', 3, 10], ['0289', 3, 10], ['0178', 3, 15], ['0241', 3, 12]]],
    [5, 'Pull B', [['1326', 3, 8], ['0293', 3, 10], ['0861', 3, 10], ['0313', 3, 12], ['0031', 2, 12]]],
    [6, 'Legs B', [['0032', 3, 5], ['1992', 3, 10], ['1060', 3, 10], ['0585', 3, 12], ['0586', 3, 12], ['0605', 4, 15]]],
  ],
}
const CHOOSER = ['ppl', 'upper-lower', 'full-body', '5x5']
const ONBOARDING = { 'full-body-2': 2, 'upper-lower-ppl': 5, 'ppl-6': 6 }

const shape = r => r.ex.map(e => [e.id, e.sets, e.reps])

describe('starter plan catalog', () => {
  it('offers exactly the four plans, with the day count read off the schedule', () => {
    expect(starterPlanOptions()).toEqual([
      { id: 'ppl', days: 3 }, { id: 'upper-lower', days: 4 },
      { id: 'full-body', days: 3 }, { id: '5x5', days: 3 },
    ])
    for (const { id, days } of starterPlanOptions()) expect(starterPlanDays(id)).toHaveLength(days)
  })

  it('names every routine differently across all plans', () => {
    const names = Object.keys(APPROVED).flatMap(id => buildStarterPlan(id).routines.map(r => r.name))
    expect(new Set(names).size).toBe(names.length)
  })

  it('Legs B has a quad compound (the hack squat), and Pull B a vertical pull other than the lat pulldown Pull A uses', () => {
    const ids = name => buildStarterPlan('ppl-6').routines.find(r => r.name === name).ex.map(e => e.id)
    expect(ids('Legs B')).toContain('1992')
    expect(ids('Pull B')).not.toContain('0198')
    expect(ids('Pull B')).not.toContain('2330')
  })

  it('changes nothing for an unknown plan id', () => {
    expect(buildStarterPlan('nope')).toBeNull()
    expect(buildStarterPlan(undefined)).toBeNull()
    // A click handler wired straight to a loader would hand the event in as the plan.
    expect(buildStarterPlan({ type: 'click' })).toBeNull()
    expect(starterPlanDays('nope')).toBeNull()
  })
})

describe.each(Object.keys(APPROVED))('%s', planId => {
  const approved = APPROVED[planId]

  it('builds the approved exercises, sets and reps in order', () => {
    const { routines } = buildStarterPlan(planId)
    expect(routines.map(r => r.name)).toEqual(approved.map(([, name]) => name))
    routines.forEach((r, i) => expect(shape(r)).toEqual(approved[i][2]))
  })

  it('puts each routine on its approved weekday, by identity not position', () => {
    const { routines, schedule } = buildStarterPlan(planId)
    const nameOf = Object.fromEntries(routines.map(r => [r.id, r.name]))
    expect(schedule.map(({ day, routineId }) => [day, nameOf[routineId]]))
      .toEqual(approved.map(([day, name]) => [day, name]))
  })

  it('references only real exercises and starts every one at weight 0', () => {
    for (const r of buildStarterPlan(planId).routines) {
      for (const e of r.ex) {
        expect(EXIDX[e.id], e.id).toBeTruthy()
        expect(e.sets).toBeGreaterThan(0)
        expect(e.reps).toBeGreaterThan(0)
        expect(e.weight).toBe(0)
      }
    }
  })

  it('mints fresh ids and independent objects on every build', () => {
    const first = buildStarterPlan(planId)
    const second = buildStarterPlan(planId)
    const ids = first.routines.map(r => r.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(second.routines.some(r => ids.includes(r.id))).toBe(false)
    expect(first.routines[0].ex[0]).not.toBe(second.routines[0].ex[0])
    // and the static definition survives a caller mutating what it got back
    first.routines[0].ex[0].sets = 99
    expect(buildStarterPlan(planId).routines[0].ex[0].sets).toBe(approved[0][2][0][1])
  })
})

describe('the onboarding plans (2, 5 and 6 days)', () => {
  const build = id => buildStarterPlan(id)
  const parts = plan => new Set(plan.routines.flatMap(r => r.ex.map(e => EXIDX[e.id].bp)))

  it('are offered by day count when asked for, and left out of the chooser, which has no copy for them', () => {
    expect(starterPlanOptions().map(o => o.id)).toEqual(CHOOSER)
    const all = starterPlanOptions({ all: true })
    expect(all.map(o => o.id)).toEqual([...CHOOSER, ...Object.keys(ONBOARDING)])
    for (const [id, days] of Object.entries(ONBOARDING)) {
      expect(all.find(o => o.id === id).days).toBe(days)
      expect(starterPlanDays(id)).toHaveLength(days)
    }
    // Onboarding gets one plan for every number of days from 2 to 6.
    expect([...new Set(all.map(o => o.days))].sort()).toEqual([2, 3, 4, 5, 6])
  })

  it('2 days is full body A and B, with a rest day or more between the two', () => {
    const plan = build('full-body-2')
    expect(plan.routines.map(r => r.name)).toEqual(['2-Day Full Body A', '2-Day Full Body B'])
    const [a, b] = plan.schedule.map(s => s.day)
    expect(b - a).toBeGreaterThanOrEqual(2)
    // Each session trains legs, a press, a pull and the arms or shoulders: it is the whole week for that.
    for (const r of plan.routines) {
      const bp = new Set(r.ex.map(e => EXIDX[e.id].bp))
      for (const need of ['upper legs', 'chest', 'back']) expect(bp.has(need), `${r.name}: ${need}`).toBe(true)
      expect(bp.has('shoulders') || bp.has('upper arms'), `${r.name}: shoulders or arms`).toBe(true)
    }
  })

  it('5 days is upper and lower, then push, pull and legs, with Wednesday and Sunday free', () => {
    const plan = build('upper-lower-ppl')
    expect(plan.routines.map(r => r.name)).toEqual(['Upper', 'Lower', 'Push', 'Pull', 'Legs'])
    expect(plan.schedule.map(s => s.day)).toEqual([1, 2, 4, 5, 6])
  })

  it('6 days is push, pull and legs twice, with Sunday free and the second of each a different session', () => {
    const plan = build('ppl-6')
    expect(plan.routines.map(r => r.name)).toEqual(['Push A', 'Pull A', 'Legs A', 'Push B', 'Pull B', 'Legs B'])
    expect(plan.schedule.map(s => s.day)).toEqual([1, 2, 3, 4, 5, 6])
    for (let i = 0; i < 3; i++) {
      const a = new Set(plan.routines[i].ex.map(e => e.id)), b = plan.routines[i + 3].ex.map(e => e.id)
      expect(b.some(id => !a.has(id)), `${plan.routines[i].name} vs ${plan.routines[i + 3].name}`).toBe(true)
    }
  })

  it('every plan trains the whole body, never twice in one routine, at a sensible size', () => {
    for (const id of Object.keys(ONBOARDING)) {
      const plan = build(id)
      for (const need of ['upper legs', 'chest', 'back', 'shoulders', 'upper arms', 'lower legs']) expect(parts(plan).has(need), `${id}: ${need}`).toBe(true)
      for (const r of plan.routines) {
        const own = r.ex.map(e => e.id)
        expect(new Set(own).size, `${id}/${r.name}`).toBe(own.length)
        expect(own.length, `${id}/${r.name}`).toBeGreaterThanOrEqual(5)
        expect(own.length, `${id}/${r.name}`).toBeLessThanOrEqual(8)
        for (const e of r.ex) { expect(e.sets).toBeLessThanOrEqual(5); expect(e.reps).toBeGreaterThanOrEqual(5) }
      }
      // A weekday is one routine, once, and a real weekday.
      const days = plan.schedule.map(s => s.day)
      expect(new Set(days).size).toBe(days.length)
      for (const d of days) expect(Number.isInteger(d) && d >= 0 && d <= 6).toBe(true)
    }
  })

  it('fit to equipment like every other plan: only what the kit allows, no repeats, schedule intact', () => {
    for (const eq of [ALL_EQUIPMENT, ['dumbbell'], ['barbell', 'dumbbell'], ['band'], []]) {
      for (const id of Object.keys(ONBOARDING)) {
        const fitted = buildStarterPlan(id, eq)
        for (const r of fitted.routines) {
          const own = r.ex.map(e => e.id)
          expect(new Set(own).size).toBe(own.length)
          for (const exId of own) expect(eqAvailable(eq, EXIDX[exId]), `${id} ${exId}`).toBe(true)
        }
        const have = new Set(fitted.routines.map(r => r.id))
        for (const { routineId } of fitted.schedule) expect(have.has(routineId)).toBe(true)
      }
    }
    const full = buildStarterPlan('ppl-6', ALL_EQUIPMENT)
    expect(full.fit).toEqual({ swapped: 0, dropped: 0 })
    expect(full.routines.map(shape)).toEqual(APPROVED['ppl-6'].map(([, , list]) => list))
  })

  it('leave the original four exactly as they were', () => {
    for (const id of CHOOSER) expect(buildStarterPlan(id).routines.map(shape)).toEqual(APPROVED[id].map(([, , list]) => list))
  })
})

describe('starterRoutines (the demo build entry point)', () => {
  it('still returns push, pull and legs unchanged', () => {
    const routines = starterRoutines()
    expect(routines.map(r => r.name)).toEqual(['Push Day', 'Pull Day', 'Leg Day'])
    routines.forEach((r, i) => expect(shape(r)).toEqual(APPROVED.ppl[i][2]))
    expect(routines.map(r => r.emoji)).toEqual(['barbell', 'pullup', 'legs'])
  })

  it('mints fresh ids on every invocation', () => {
    const first = starterRoutines().map(r => r.id)
    const second = starterRoutines().map(r => r.id)
    expect(new Set([...first, ...second]).size).toBe(6)
  })
})

describe('fitting a starter plan to equipment', () => {
  const ids = plan => plan.routines.flatMap(r => r.ex.map(e => e.id))

  it('changes nothing when the equipment already covers the plan', () => {
    const all = ALL_EQUIPMENT
    const fitted = buildStarterPlan('ppl', all)
    expect(fitted.routines.map(shape)).toEqual(APPROVED.ppl.map(([, , list]) => list))
    expect(fitted.fit).toEqual({ swapped: 0, dropped: 0 })
  })

  it('has no fit report when no equipment is given', () => {
    expect(buildStarterPlan('ppl').fit).toBeUndefined()
  })

  it('swaps only what the equipment cannot do, keeping sets and reps', () => {
    const fitted = buildStarterPlan('ppl', ['dumbbell'])
    const push = fitted.routines[0]
    // dumbbell exercises stay put; the barbell bench and the cable pushdown are swapped
    expect(push.ex.map(e => e.id)).toContain('0426')
    expect(push.ex.map(e => e.id)).toContain('0334')
    expect(push.ex[0].id).not.toBe('0025')
    expect(push.ex[0].sets).toBe(4)
    expect(push.ex[0].reps).toBe(8)
    expect(fitted.fit.swapped).toBeGreaterThan(0)
  })

  it('only ever uses exercises the equipment allows (body weight is always allowed)', () => {
    for (const eq of [['dumbbell'], ['barbell', 'dumbbell'], ['band'], []]) {
      for (const { id } of starterPlanOptions()) {
        const fitted = buildStarterPlan(id, eq)
        for (const exId of ids(fitted)) expect(eqAvailable(eq, EXIDX[exId])).toBe(true)
      }
    }
  })

  it('never repeats an exercise inside one routine', () => {
    for (const eq of [['dumbbell'], ['band'], []]) {
      for (const { id } of starterPlanOptions()) {
        for (const r of buildStarterPlan(id, eq).routines) {
          const own = r.ex.map(e => e.id)
          expect(new Set(own).size).toBe(own.length)
        }
      }
    }
  })

  it('never stands in with a stretch, a hold or a drill that needs a ball nobody ticked', () => {
    const bad = /stretch|isometric|squeeze|yoga|toe touch|exercise ball|bosu/i
    for (const eq of [['dumbbell'], ['dumbbell'], ['band'], []]) {
      for (const { id } of starterPlanOptions()) {
        for (const exId of ids(buildStarterPlan(id, eq))) expect(EXIDX[exId].n).not.toMatch(bad)
      }
    }
  })

  it('prefers a loaded exercise over a body-weight drill for a loaded lift', () => {
    // leg extension has no dumbbell twin, so the nearest same-muscle options include plain
    // body-weight drills; a loaded leg exercise still wins
    const legs = buildStarterPlan('ppl', ['dumbbell']).routines.find(r => r.name === 'Leg Day')
    const swappedIn = legs.ex[3]
    expect(swappedIn.id).not.toBe('0585')
    expect(EXIDX[swappedIn.id].eq).toBe('dumbbell')
    expect(EXIDX[swappedIn.id].bp).toBe('upper legs')
  })

  it('swaps a barbell bench press for chest work with the same kit, not a push-up', () => {
    const push = buildStarterPlan('ppl', ['dumbbell']).routines[0]
    expect(EXIDX[push.ex[0].id].eq).toBe('dumbbell')
    expect(EXIDX[push.ex[0].id].bp).toBe('chest')
  })

  it('is deterministic', () => {
    const a = buildStarterPlan('upper-lower', ['dumbbell']).routines.map(shape)
    const b = buildStarterPlan('upper-lower', ['dumbbell']).routines.map(shape)
    expect(a).toEqual(b)
  })

  it('keeps every scheduled day pointing at a routine that exists', () => {
    const fitted = buildStarterPlan('5x5', [])
    const have = new Set(fitted.routines.map(r => r.id))
    for (const { routineId } of fitted.schedule) expect(have.has(routineId)).toBe(true)
  })
})
