import { describe, it, expect } from 'vitest'
import { accessoriesOf, exAvailable, activeProfile, benchKindOf, benchIn, withBench, profileEquipment, ACC_V, ALL_EQUIPMENT, ACCESSORIES } from './equipment.js'
import { EXDB } from './exercises-data.js'
import { benchKind, benchAllows, benchNeedOf } from '../../../api/coach/core/library.js'

// Flat vs adjustable bench (1.4.5): incline and decline work needs a bench that tilts.
const ex = n => EXDB.find(e => e.n === n)
const incline = ex('dumbbell incline bench press')
const flat = ex('dumbbell bench press')
const declineSitUp = ex('decline sit-up')
const inclinePushUp = ex('incline push-up')

describe('what an exercise needs', () => {
  it('incline and decline bench work needs an adjustable bench, flat work any bench', () => {
    expect(accessoriesOf(incline)).toEqual(['bench', 'adjustable bench'])
    expect(accessoriesOf(declineSitUp)).toEqual(['bench', 'adjustable bench'])
    expect(accessoriesOf(flat)).toEqual(['bench'])
    expect(ACCESSORIES).toContain('adjustable bench')
    expect(ALL_EQUIPMENT).toContain('adjustable bench')
  })

  it('an incline push-up, a wall push-up or a pushdown needs no bench at all (they did before)', () => {
    expect(accessoriesOf(inclinePushUp)).toEqual([])
    for (const e of EXDB.filter(x => /incline|decline/.test(x.n) && /push[- ]?up|pushdown|plank|wall|box/.test(x.n) && !/\bbench\b/.test(x.n))) {
      expect(accessoriesOf(e)).not.toContain('adjustable bench')
    }
  })

  it('a machine with its own seat needs nothing', () => {
    const lever = EXDB.find(e => e.eq === 'leverage machine' && /incline/.test(e.n))
    expect(accessoriesOf(lever)).toEqual([])
  })
})

describe('the Bench switch without a profile', () => {
  it('is adjustable unless said otherwise, so nothing changes for anyone', () => {
    expect(benchKindOf({})).toBe('adjustable')
    expect(activeProfile({})).toBe(null)
    expect(exAvailable({}, incline)).toBe(true)
  })

  it('flat only keeps incline work out and flat work in', () => {
    const S = { bench: 'flat' }
    expect(benchKindOf(S)).toBe('flat')
    expect(exAvailable(S, incline)).toBe(false)
    expect(exAvailable(S, declineSitUp)).toBe(false)
    expect(exAvailable(S, flat)).toBe(true)
    expect(exAvailable(S, inclinePushUp)).toBe(true)
    expect(activeProfile(S).id).toBe('')
  })

  it('no bench keeps every bench exercise out', () => {
    const S = { bench: 'none' }
    expect(exAvailable(S, flat)).toBe(false)
    expect(exAvailable(S, incline)).toBe(false)
    expect(exAvailable(S, inclinePushUp)).toBe(true)
  })

  it('works together with "I own no dumbbells"', () => {
    const S = { bench: 'flat', dumbbells: { none: { on: true, _ts: 1 } } }
    expect(exAvailable(S, flat)).toBe(false)
    expect(exAvailable(S, ex('barbell bench press'))).toBe(true)
    expect(exAvailable(S, ex('barbell incline bench press'))).toBe(false)
  })
})

describe('a gym profile says it with its own ticks', () => {
  const prof = equipment => ({ id: 'g', name: 'Home', equipment, accV: ACC_V })
  it('reads and writes the bench in its equipment list', () => {
    expect(benchIn(['dumbbell'])).toBe('none')
    expect(benchIn(['bench'])).toBe('flat')
    expect(benchIn(['bench', 'adjustable bench'])).toBe('adjustable')
    expect(withBench(['dumbbell', 'bench', 'adjustable bench'], 'flat')).toEqual(['dumbbell', 'bench'])
    expect(withBench(['dumbbell'], 'adjustable')).toEqual(['dumbbell', 'bench', 'adjustable bench'])
    expect(withBench(['dumbbell', 'bench'], 'none')).toEqual(['dumbbell'])
  })

  it('a profile saved before keeps its incline work until it is saved again', () => {
    expect(profileEquipment({ equipment: ['dumbbell', 'bench'], accV: 2 })).toContain('adjustable bench')
    expect(profileEquipment({ equipment: ['dumbbell'], accV: 2 })).not.toContain('adjustable bench')
    expect(profileEquipment({ equipment: ['dumbbell'] })).toContain('adjustable bench')
  })

  it('the filtering profile decides, over the switch', () => {
    const S = { equipFilterOn: true, activeEquipId: 'g', equipProfiles: [prof(['dumbbell', 'bench'])], bench: 'adjustable' }
    expect(benchKindOf(S)).toBe('flat')
    expect(exAvailable(S, incline)).toBe(false)
    expect(exAvailable(S, flat)).toBe(true)
  })
})

describe('the Coach reads the same bench', () => {
  it('from the switch and from the filtering profile', () => {
    expect(benchKind({})).toBe('adjustable')
    expect(benchKind({ bench: 'flat' })).toBe('flat')
    expect(benchKind({ equipFilterOn: true, activeEquipId: 'g', equipProfiles: [{ id: 'g', equipment: ['bench'], accV: 3 }] })).toBe('flat')
    expect(benchKind({ equipFilterOn: true, activeEquipId: 'g', equipProfiles: [{ id: 'g', equipment: ['bench'], accV: 2 }] })).toBe('adjustable')
  })

  it('agrees with the app on what needs a tilting bench', () => {
    for (const e of EXDB.filter(x => /incline|decline|bench/.test(x.n))) {
      const app = accessoriesOf(e)
      const coach = benchNeedOf(e.id)
      if (coach === null && !app.includes('bench')) continue
      expect(coach === 'adjustable').toBe(app.includes('adjustable bench'))
    }
    expect(benchAllows('flat', incline.id)).toBe(false)
    expect(benchAllows('flat', flat.id)).toBe(true)
    expect(benchAllows('none', flat.id)).toBe(false)
  })
})
