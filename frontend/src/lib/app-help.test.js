import { describe, expect, it } from 'vitest'
import { helpMatches } from './app-help.js'

const ctx = { offline: true, mod: () => false }
describe('local app help', () => {
  it('finds the actual Rest timer row from a natural question', () => {
    expect(helpMatches('Where can I change how long my rest countdown lasts?', ctx)[0])
      .toMatchObject({ title: 'Rest timer', route: '/settings/workout', state: { find: 'Rest timer' } })
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
