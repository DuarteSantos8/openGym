// @vitest-environment happy-dom
/* The English steps and descriptions come in their own chunk the first time an exercise is shown.
   A load that failed (offline, before the worker had the chunk) used to leave them empty and
   never ask again, so every exercise showed no steps until the app was reloaded. Now the next
   reader after a pause, or the browser coming back online, tries again. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const net = { up: false, loads: 0 }
const offline = () => { throw new TypeError('Failed to fetch dynamically imported module') }

const ex = { id: '9999', st: [] }
const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); await new Promise(r => setTimeout(r, 0)) }

let i18n
beforeEach(async () => {
  vi.resetModules()
  net.up = false
  net.loads = 0
  vi.doMock('../instr/en.js', async () => { net.loads++; return net.up ? { default: { 9999: ['Stand tall.', 'Lift.'] } } : offline() })
  vi.doMock('../exercise-desc/en.js', async () => (net.up ? { default: { 9999: 'A lift.' } } : offline()))
  i18n = await import('./i18n.js')
})
afterEach(() => { vi.useRealTimers() })

describe('a failed load of the English steps', () => {
  it('is not mistaken for no steps: tried again on the next ask after a pause', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    expect(i18n.instrFor(ex)).toEqual([])
    await vi.advanceTimersByTimeAsync(0)
    expect(net.loads).toBe(1)
    // asked again at once (every render asks): no new try yet
    i18n.instrFor(ex)
    await vi.advanceTimersByTimeAsync(0)
    expect(net.loads).toBe(1)
    net.up = true
    await vi.advanceTimersByTimeAsync(20000)
    expect(net.loads).toBe(1)          // nothing asked yet: no load on its own
    i18n.instrFor(ex)
    await vi.advanceTimersByTimeAsync(0)
    expect(i18n.instrFor(ex)).toEqual(['Stand tall.', 'Lift.'])
  })

  it('tried again as soon as the browser is back online', async () => {
    i18n.instrFor(ex)
    await settle()
    expect(net.loads).toBe(1)
    net.up = true
    window.dispatchEvent(new Event('online'))
    await settle()
    expect(i18n.instrFor(ex)).toEqual(['Stand tall.', 'Lift.'])
  })
})
