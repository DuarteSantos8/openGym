import { afterEach, describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import zh from '../exercise-names/zh.js'
import zhTW from '../exercise-names/zh-TW.js'
import { EXDB } from './exercises-data.js'
import { searchExercises } from './exercises.js'
import { EXERCISE_NAME_LANGS, _setLangState, exerciseNameFor, exerciseNameSearchText } from './i18n-core.js'

afterEach(() => _setLangState('en', {}, null, null))

for (const [lang, names] of [['zh', zh], ['zh-TW', zhTW]]) {
  describe(`${lang} exercise names`, () => {
    const source = JSON.parse(readFileSync(new URL(`../../../scripts/exercise-name-sources/${lang}.json`, import.meta.url), 'utf8'))

    test('covers every built-in exercise and matches the editable source', () => {
      expect(EXERCISE_NAME_LANGS).toContain(lang)
      expect(Object.keys(names).sort()).toEqual(EXDB.map(e => e.id).sort())
      expect(names).toEqual(source)
      for (const ex of EXDB) {
        expect(names[ex.id], `${ex.id}: ${ex.n}`).toMatch(/\p{Script=Han}/u)
        expect(names[ex.id].trim(), ex.id).not.toBe(ex.n)
      }
    })

    test('preserves equipment and identity-changing qualifiers', () => {
      const rules = [
        [/\bbarbell\b/i, /[杠槓][铃鈴]/u],
        [/\bdumbbell\b/i, /[哑啞][铃鈴]/u],
        [/\bkettlebell\b/i, /[壶壺][铃鈴]/u],
        [/\bcable\b/i, /[绳繩]索/u],
        [/\bsmith\b/i, /史密斯/u],
        [/\bband\b/i, /[弹彈]力[带帶]/u],
        [/\bassisted\b/i, /[辅輔]助/u],
        [/\bweighted\b/i, /[负負]重/u],
        [/\bmale\b/i, /男性/u],
        [/\bfemale\b/i, /女性/u],
        [/\bone[ -]arm\b/i, /[单單]臂/u],
        [/\b(?:one|single)[ -]leg\b/i, /[单單]腿/u],
      ]
      for (const ex of EXDB) {
        for (const [original, translated] of rules) {
          if (original.test(ex.n)) expect(names[ex.id], `${ex.id}: ${ex.n}`).toMatch(translated)
        }
      }
    })

    test('translates the reported exercise and searches Chinese and English', () => {
      const ex = EXDB.find(e => e.id === '3214')
      _setLangState(lang, {}, null, names)
      expect(exerciseNameFor(ex)).toBe(`${names[ex.id]} (${ex.n})`)
      expect(names[ex.id]).toMatch(/男性/u)
      expect(exerciseNameSearchText(ex)).toContain(names[ex.id])
      expect(exerciseNameSearchText(ex)).toContain(ex.n)
      expect(searchExercises(EXDB, names[ex.id])).toContain(ex)
      expect(searchExercises(EXDB, 'arms apart')).toContain(ex)
    })

    test('respects both English-name preferences and keeps custom names unchanged', () => {
      const ex = EXDB[0]
      _setLangState(lang, {}, null, names, false)
      expect(exerciseNameFor(ex)).toBe(names[ex.id])
      const custom = { id: 'custom-zh', n: '我的自定义动作' }
      expect(exerciseNameFor(custom)).toBe(custom.n)
      _setLangState(lang, {}, null, names, true, true)
      expect(exerciseNameFor(ex)).toBe(ex.n)
      _setLangState('en', {}, null, null)
      expect(exerciseNameFor(ex)).toBe(ex.n)
    })
  })
}
