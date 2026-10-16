// @vitest-environment happy-dom
// The overlay's Open Food Facts group against the budget (ux-search.md §5): a tap is spent from
// the taps' reserve, and the retry a 429's countdown makes on its own is spent as automatic.
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const kinds = []
let failNext = false
vi.mock('../../lib/nutrition/use-online-search.js', () => ({
  cachedOnline: () => undefined,
  fetchOnline: async (q, { kind }) => {
    kinds.push(kind)
    if (failNext) {
      failNext = false
      const { useOffBudget } = await import('../../lib/nutrition/off-budget.js')
      useOffBudget.setState({ pausedUntil: Date.now() + 2000 })
      throw Object.assign(new Error('limit'), { status: 429 })
    }
    return [{ name: 'Nutella', barcode: '3017620422003', nutrition: { calories: 539 } }]
  },
}))

const { resetOffBudget } = await import('../../lib/nutrition/off-budget.js')
const { useOnlineResults } = await import('./use-online-results.js')

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let root, seen
function Probe() {
  seen = useOnlineResults({ query: 'nutella', words: [], tab: 'train', group: null, ownCount: 0, nutrition: true, open: true })
  return null
}
const wait = ms => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

beforeEach(() => {
  vi.useFakeTimers()
  resetOffBudget()
  kinds.length = 0
  root = createRoot(document.createElement('div'))
})
afterEach(() => {
  act(() => root.unmount())
  vi.useRealTimers()
})

describe('useOnlineResults and the budget', () => {
  it('a tap is a tap; the retry at the end of a 429\'s countdown is automatic', async () => {
    act(() => root.render(<Probe />))
    // From Training it would cost a search nobody asked for: a row to tap.
    expect(seen.status).toBe('tap')
    failNext = true
    await act(async () => seen.ask())
    await wait(0)
    expect(kinds).toEqual(['tap'])
    expect(seen.status).toBe('paused')
    await wait(2000)
    await wait(10)
    expect(kinds).toEqual(['tap', 'auto'])
    expect(seen.status).toBe('ready')
    expect(seen.rows.map(r => r.title)).toEqual(['Nutella'])
  })
})
