// A starter plan fitted to a profile with body weight unticked (#1159) gets no exercise that
// needs only your body; left out, the argument changes nothing.
import { describe, expect, it } from 'vitest'
import { EXIDX, registerCustom } from './exercises.js'
import { ALL_EQUIPMENT, accessoriesOf } from './equipment.js'
import { buildStarterPlan, fitRoutines, starterPlanOptions } from './starter.js'

const ids = plan => plan.routines.flatMap(r => r.ex.map(e => e.id))
const pureBw = id => EXIDX[id].eq === 'body weight' && !accessoriesOf(EXIDX[id]).length
const KIT = ALL_EQUIPMENT.filter(e => e !== 'body weight')

describe('starter plans and the body-weight tick', () => {
  it('unticked: no pure body-weight exercise in any plan', () => {
    for (const { id } of starterPlanOptions()) {
      for (const eq of [KIT, ['dumbbell', 'bench']]) {
        const plan = buildStarterPlan(id, eq, undefined, false)
        expect(ids(plan).filter(pureBw), id).toEqual([])
      }
    }
  })

  it('the default is as today, and a pull-up still follows the bar', () => {
    const today = ids(buildStarterPlan('home-bw', ['dumbbell', 'bench']))
    expect(today.some(pureBw)).toBe(true)
    expect(ids(buildStarterPlan('home-bw', ['dumbbell', 'bench'], undefined, true))).toEqual(today)
    // a pull-up needs the bar, not the tick; the push-up beside it is swapped or dropped
    const [[, , , list]] = fitRoutines([['k', 'K', 'x', [['0652', 3, 8], ['0662', 3, 10]]]], ['pull-up bar', 'dumbbell'], undefined, false).routines
    expect(list[0][0]).toBe('0652')
    expect(list.map(([id]) => id).filter(pureBw)).toEqual([])
  })

  it('unticked: one of your own exercises with kit stays, as in the library', () => {
    const rings = { ...EXIDX['0662'], id: 'c-ring', n: 'ring push-up', kit: ['Rings'], custom: true }
    const bare = { ...EXIDX['0662'], id: 'c-bare', n: 'my push-up', custom: true }
    registerCustom([rings, bare])
    try {
      const [[, , , list]] = fitRoutines([['k', 'K', 'x', [['c-ring', 3, 8]]]], ['dumbbell'], undefined, false).routines
      expect(list.map(([id]) => id)).toEqual(['c-ring'])
      const [[, , , other]] = fitRoutines([['k', 'K', 'x', [['c-bare', 3, 8]]]], ['dumbbell'], undefined, false).routines
      expect(other.map(([id]) => id)).not.toContain('c-bare')
    } finally { registerCustom([]) }
  })
})
