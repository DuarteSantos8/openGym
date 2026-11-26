import { describe, expect, it } from 'vitest'
import zh from '../locales/zh.js'
import th from '../locales/th.js'
import { helpMatches } from './app-help.js'

const ctx = { offline: true, mod: () => false }
describe('local app help', () => {
  it('finds the actual Rest timer row from a natural question', () => {
    expect(helpMatches('Where can I change how long my rest countdown lasts?', ctx)[0])
      .toMatchObject({ title: 'Rest timer', route: '/settings/workout', state: { find: 'Rest timer' } })
  })
  it('keeps Settings option matches and finds labels inside unspaced questions', () => {
    expect(helpMatches('System', ctx).map(h => h.title)).toContain('Theme')
    const tr = text => text === 'Text size' ? '文字大小' : text
    expect(helpMatches('如何调整文字大小？', ctx, tr)[0].title).toBe('文字大小')
  })
  it.each([
    [zh, '我刚开始用这个应用，不太清楚在哪里可以找到设置里的 文字大小', 'Text size'],
    [th, 'ต้องการทราบวิธีการเปลี่ยน ธีม', 'Theme'],
  ])('ranks the named setting first in a full localized question', (pack, question, title) => {
    expect(helpMatches(question, ctx, text => pack[text] || text)[0].title).toBe(pack[title])
  })
  it('resolves the Learn guide and the tour destination', () => {
    expect(helpMatches('Your first week', ctx).map(hit => hit.route)).toContain('/learn?g=first-week')
    expect(helpMatches('Off to Plan', ctx).map(hit => hit.route)).toContain('/plan')
  })
  it('matches translated guide titles and leaves unavailable or unknown entries out', () => {
    const tr = text => text === 'Your first week' ? 'Votre première semaine' : text
    expect(helpMatches('Votre première semaine', ctx, tr)[0].route).toBe('/learn?g=first-week')
    expect(helpMatches('Automatic warm-ups', ctx).some(hit => hit.title === 'Automatic warm-ups')).toBe(false)
    expect(helpMatches('xyzabc', ctx)).toEqual([])
  })
})
