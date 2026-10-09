import { afterEach, describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import zh from '../exercise-names/zh.js'
import { EXDB } from './exercises-data.js'
import {
  CASED_NAME_LANGS, EXERCISE_NAME_LANGS, _setLangState, exerciseNameFor, exerciseNameSearchText
} from './i18n-core.js'

describe('Chinese exercise names', () => {
  const source = JSON.parse(readFileSync(new URL('../../../scripts/exercise-name-sources/zh.json', import.meta.url), 'utf8'))
  afterEach(() => _setLangState('en', {}, null, null))

  test('matches the curated source and covers the complete built-in catalogue', () => {
    expect(Object.keys(zh)).toHaveLength(EXDB.length)
    expect(zh).toEqual(source)
    expect(EXERCISE_NAME_LANGS).toContain('zh')
    // Chinese has no letter case, so it is stored like the lower-case packs, not like German.
    expect(CASED_NAME_LANGS).not.toContain('zh')
  })

  test('contains a non-empty Chinese translation for every known exercise', () => {
    for (const exercise of EXDB) {
      const name = zh[exercise.id]
      expect(name?.trim(), exercise.id).toBeTruthy()
      // Han characters somewhere in the title: a name left in English would otherwise pass
      // every other check in this file while showing "barbell bench press (barbell bench press)".
      expect(name, exercise.id).toMatch(/\p{Script=Han}/u)
      // Chinese exercise names are written without spaces between words: 杠铃卧推, not 杠铃 卧推.
      // Raised by a native speaker on issue #419.
      expect(name, `${exercise.id}: space between Chinese characters`).not.toMatch(/[一-鿿]\s+[一-鿿]/)
      // A leading Latin capital (EZ…, L…, V…) would make i18n-core.test.js read the pack as cased.
      expect(name, exercise.id).not.toMatch(/^[A-Z]/)
      // Simplified characters only: this is the zh-CN pack. A few traditional forms that would
      // slip in from a Traditional Chinese source.
      expect(name, `${exercise.id}: traditional character`).not.toMatch(/[啞鈴槓臥舉彎練側單雙轉飛]/u)
    }
  })

  test('preserves identity-changing qualifiers and equipment', () => {
    const rules = [
      // "ez bar"/"ez barbell" is the EZ bar, and an olympic barbell is named for the bar too,
      // so a plain "barbell" is the only one that has to say 杠铃.
      [/ez[\s-]?bar/iu, /曲杆/u],
      [/(?<!ez[\s-])(?<!olympic )barbell/iu, /杠铃/u],
      [/olympic barbell/iu, /奥杆/u],
      [/dumbbell/iu, /哑铃/u],
      [/kettlebell/iu, /壶铃/u],
      [/smith/iu, /史密斯/u],
      [/trap bar/iu, /六角杠/u],
      [/stability ball|exercise ball/iu, /健身球/u],
      [/medicine ball/iu, /药球/u],
      [/bosu/iu, /波速球/u],
      [/resistance band/iu, /阻力带/u],
      [/^band /iu, /弹力带/u],
      [/^cable /iu, /绳索/u],
      [/^lever /iu, /器械|杠杆/u],
      // "self assisted" is its own qualifier (自我辅助), which still contains 辅助.
      [/assisted/iu, /辅助/u],
      [/weighted/iu, /负重/u],
      [/(?:^|[^\p{L}])male(?=$|[^\p{L}])/iu, /（男）/u],
      [/(?:^|[^\p{L}])female(?=$|[^\p{L}])/iu, /（女）/u],
      [/v\. ?\d/iu, /（第\d版）/u],
    ]
    for (const exercise of EXDB) {
      for (const [english, chinese] of rules) {
        if (english.test(exercise.n)) expect(zh[exercise.id], `${exercise.id}: ${exercise.n}`).toMatch(chinese)
      }
    }
  })

  test('shows Chinese first and preserves the canonical English title', () => {
    const exercise = EXDB.find(e => e.id === '0025')
    _setLangState('zh', {}, null, zh)
    expect(exerciseNameFor(exercise)).toBe('杠铃卧推 (barbell bench press)')
    expect(exerciseNameSearchText(exercise)).toContain('杠铃卧推')
    expect(exerciseNameSearchText(exercise)).toContain('barbell bench press')
  })

  test('never translates custom exercises or changes other languages', () => {
    const custom = { id: 'custom-1', n: '我的动作' }
    _setLangState('zh', {}, null, zh)
    expect(exerciseNameFor(custom)).toBe('我的动作')
    _setLangState('en', {}, null, null)
    expect(exerciseNameFor(EXDB[0])).toBe(EXDB[0].n)
  })
})
