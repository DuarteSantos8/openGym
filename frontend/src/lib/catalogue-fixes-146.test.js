// Catalogue fixes from the 1.4.6 review, checked against the generated data the app reads.
import { describe, expect, it } from 'vitest'
import { EXIDX } from './exercises.js'
import instrEn from '../instr/en.js'

const names = import.meta.glob('../exercise-names/*.js', { eager: true, import: 'default' })

describe('0316 is an incline fly with the palms forward (#1302)', () => {
  it('says fly, in English and in every language, never press or curl', () => {
    expect(EXIDX['0316'].n).toBe('dumbbell incline fly (palms forward)')
    expect(EXIDX['0316'].sm).toEqual(['front delts'])
    expect(instrEn['0316'].join(' ')).toMatch(/arc/)
    expect(instrEn['0316'].join(' ')).not.toMatch(/90-degree|sides of your chest/)
    for (const [file, map] of Object.entries(names)) {
      const n = map['0316']
      if (!n) continue
      expect(n, file).not.toMatch(/breeding|press|drücken|pres\b|tlak|curl|supino|ブレス|プレス/i)
    }
  })
})

describe('static stretches start as timed holds (#1537)', () => {
  it('a held stretch opens as time, a moving one stays reps', async () => {
    const { defaultConfig } = await import('./history.js')
    const { isHold } = await import('./exercises.js')
    for (const id of ['1909', '0945', '0789', '1059', '4557']) {
      expect(isHold(id), id).toBe(true)
      expect(defaultConfig(id).mode, id).toBe('time')
    }
    // dynamic drills are done for reps: toy soldiers, neck circles, a moving child pose, cat cow
    for (const id of ['5978', '3994', '8130', '11095', '5404']) {
      expect(isHold(id), id).toBe(false)
      expect(defaultConfig(id).mode, id).not.toBe('time')
    }
  })
})

describe('leg presses and hack squats do not list the calves (#1034)', () => {
  // The body map has weighed them at 0 since v1.4.5 (7b890962); the list of secondary muscles,
  // which screens print, still said calves.
  it('in the secondary muscles, matching the body map\'s weight of 0', async () => {
    const map = (await import('./exercise-muscle-map.json')).default
    for (const id of ['0046', '0739', '0743', '0760', '2267', '2951']) {
      expect(EXIDX[id].sm, id).not.toContain('calves')
      expect(map[id].muscleWeights.calves, id).toBe(0)
    }
  })
})
