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

  it('preserves the review-corrected meanings and UI terminology', () => {
    expect(ja['How did my last workout go?']).toBe('前回のトレーニングを振り返って')
    expect(ja['How did my {0} session go?']).toBe('{0}のトレーニングを振り返って')
    expect(ja['Missed reps last time. Same weight again ({0} of {1} to go).']).toContain('ディロードまであと{0}回／{1}回')
    expect(ja['Your {0} best on {1}']).toBe('{0}年の{1}のベスト')
    expect(ja['Progression']).toBe('プログレッション')
    expect(ja['Load']).toBe('重量')
    expect(ja['Max']).toBe('MAX')
    expect(ja['Rest day']).toBe('休養日')
  })

  it('keeps review-verified numeric meanings and effort thresholds', () => {
    expect(ja['{0} sets · {1} work']).toBe('{0}セット（メイン{1}セット）')
    expect(ja['at {0} {1} or harder']).toContain('限界に近い')
    expect(ja['Nothing set, progression as usual']).toContain('プログレッション')
    expect(ja['Bodyweight: same target again until every set is clean.']).not.toContain('フォーム')
    expect(ja['Drop {0}']).toBe('ドロップ{0}')
    expect(ja['In {0}']).toBe('{0}のメモ')
    expect(ja['average effort']).toBe('平均のきつさ')
    expect(ja['Work set']).toBe(ja['Work sets'])
    expect(ja['{0}: {1}']).toBe('{0}：{1}')
  })

  it('corrects exercise labels against the movement instructions', () => {
    expect(jaExerciseNames['0410']).toBe('ダンベル・ブルガリアンスクワット')
    expect(jaExerciseNames['0977']).toBe('バンド・フロントレイズ')
    expect(jaExerciseNames['1321']).toContain('高いシート')
    expect(jaExerciseNames['0574']).toBe('バーベル・ベントオーバーローイング')
    expect(jaExerciseNames['0316']).toContain('インクラインダンベルプレス')
  })

  it('translates common lifts using catalogue exercise IDs', () => {
    expect(jaExerciseNames['0025']).toContain('ベンチプレス')
    expect(jaExerciseNames['0031']).toContain('カール')
  })
})
