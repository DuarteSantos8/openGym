import { describe, expect, test } from 'vitest'
import zhTW from '../instr/zh-TW.js'
import { EXDB } from './exercises-data.js'
import { INSTR_LANGS } from './i18n-core.js'
import V13_IDS from './catalogue-v13-ids.json' with { type: 'json' }
// English steps live in their own pack since the catalogue moved to catalogue/ (v1.4.0)
import EN from '../instr/en.js'

describe('Traditional Chinese (zh-TW) exercise instructions', () => {
  const exercises = new Map(EXDB.map(exercise => [exercise.id, exercise]))

  // The v1.3 catalogue was translated in full; the v1.4 additions fall back to English.
  test('covers the 1324 exercises of the v1.3 catalogue', () => {
    for (const id of V13_IDS) expect(zhTW, id).toHaveProperty(id)
  })

  test('enables zh-TW in INSTR_LANGS when there is a pack', () => {
    expect(INSTR_LANGS.includes('zh-TW')).toBe(Object.keys(zhTW).length > 0)
  })

  test('contains only known exercises with complete, non-empty step lists', () => {
    for (const [id, steps] of Object.entries(zhTW)) {
      const exercise = exercises.get(id)
      expect(exercise, `unknown exercise ${id}`).toBeDefined()
      expect(steps.length, `${id} steps empty`).toBeGreaterThan(0)
      steps.forEach((step, index) => {
        expect(step.trim(), `${id} step ${index + 1}`).not.toBe('')
        expect(step, `${id} step ${index + 1}`).not.toBe(EN[id][index])
      })
    }
  })
})
