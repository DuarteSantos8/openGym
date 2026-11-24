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
