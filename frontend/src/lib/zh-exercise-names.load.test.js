// @vitest-environment happy-dom
import { afterEach, describe, expect, test } from 'vitest'
import { setLang, exerciseNameFor, exerciseNameSearchText } from './i18n.js'
import { EXDB } from './exercises-data.js'

afterEach(() => setLang('en'))

describe('Chinese exercise-name lazy loading', () => {
  for (const lang of ['zh', 'zh-TW']) {
    test(`${lang}: selecting Chinese loads names for the full catalogue`, async () => {
      await setLang(lang, false)
      for (const ex of EXDB) expect(exerciseNameFor(ex), ex.id).toMatch(/\p{Script=Han}/u)
      const ex = EXDB.find(e => e.id === '3214')
      expect(exerciseNameSearchText(ex)).toContain(ex.n)
      await setLang(lang, true, true)
      expect(exerciseNameFor(ex)).toBe(ex.n)
      await setLang(lang, false, false)
      expect(exerciseNameFor(ex)).toMatch(/男性/u)
    })
  }
})
