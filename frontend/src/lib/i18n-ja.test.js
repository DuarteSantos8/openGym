import { describe, expect, it } from 'vitest'
import ja from '../locales/ja.js'
import jaExerciseNames from '../exercise-names/ja.js'
import { DATE_LOCALES, LANGS } from './i18n-core.js'
import { matchLocale } from './default-lang.js'

describe('Japanese localization', () => {
  it('offers Japanese and recognizes device language tags', () => {
    expect(LANGS.ja).toBe('日本語')
    expect(DATE_LOCALES.ja).toBe('ja-JP')
    expect(matchLocale('ja-JP')).toBe('ja')
  })

  it('provides Japanese actions and keeps numbered placeholders', () => {
    expect(ja.Confirm).toBe('確定')
    expect(ja.Cancel).toBe('キャンセル')
    expect(ja['Replacing {0}']).toContain('{0}')
  })

  it('translates common lifts using catalogue exercise IDs', () => {
    expect(jaExerciseNames['0025']).toContain('ベンチプレス')
    expect(jaExerciseNames['0031']).toContain('カール')
  })
})
