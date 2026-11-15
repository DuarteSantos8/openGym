// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { reminderKeys } from './CheckinReminder.jsx'

// Settings → Modules: a Body part that is off offers no reminder row, unless one is already set.
describe('reminderKeys and the Body parts', () => {
  it('leaves out photos and measurements while their part is off', () => {
    const keys = reminderKeys({ modules: { 'body.photos': false, 'body.measurements': false } })
    expect(keys).toEqual(['weight'])
  })
  it('keeps a reminder already set, so it can be switched off', () => {
    const S = { modules: { 'body.photos': false }, checkinReminder: { on: true, items: { photos: { every: 28 } } } }
    expect(reminderKeys(S)).toContain('photos')
  })
})
