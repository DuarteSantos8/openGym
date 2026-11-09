import { describe, expect, it } from 'vitest'
import { searchSettings } from './settings-pages.js'

// Night QA 146: "subscription" found nothing, though the row sits on the Settings root.
describe('settings search finds Use your subscription', () => {
  it('by its name and by the assistants it is about, as a route of its own', () => {
    for (const q of ['subscription', 'chatgpt', 'claude']) {
      const hit = searchSettings(q, {}).find(h => h.title === 'Use your subscription')
      expect(hit, q).toBeTruthy()
      expect(hit.route).toBe('/assistants')
    }
  })
  it('not in openGym Offline or the demo, where the row is not there either', () => {
    expect(searchSettings('subscription', { offline: true }).some(h => h.route)).toBe(false)
    expect(searchSettings('subscription', { demo: true }).some(h => h.route)).toBe(false)
  })
})
