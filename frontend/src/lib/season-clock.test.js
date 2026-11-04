// @vitest-environment happy-dom
// The seasonal QA date hook (lib/season-clock.js) as it works on the dev server: a fake local
// day from ?season-date=, remembered until ?season-date=off. Tests run as DEV.
import { afterEach, describe, expect, it } from 'vitest'
import { seasonNow } from './season-clock.js'

const at = q => window.history.replaceState(null, '', q || '/')
afterEach(() => { at(''); try { localStorage.clear() } catch (e) { /* none */ } })

describe('seasonNow', () => {
  it('is the real clock without the hook', () => {
    expect(Math.abs(seasonNow().getTime() - Date.now())).toBeLessThan(1000)
  })

  it('takes a fake day from the query, keeps it, and lets it go with off', () => {
    at('/?season-date=2026-12-14T09:30')
    const d = seasonNow()
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 11, 14, 9, 30])
    at('/')
    expect(seasonNow().getDate()).toBe(14)
    at('/?season-date=off')
    expect(Math.abs(seasonNow().getTime() - Date.now())).toBeLessThan(1000)
  })

  it('ignores anything that is not a date', () => {
    at('/?season-date=soon')
    expect(Math.abs(seasonNow().getTime() - Date.now())).toBeLessThan(1000)
  })
})
