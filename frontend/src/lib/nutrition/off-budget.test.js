// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { AUTO_PER_MIN, CAP_PER_MIN, canSearch, noteAnswer, noteSearch, pausedFor, resetOffBudget, TAP_RESERVE, waitFor } from './off-budget.js'
import { autoOnline } from '../../components/search/use-online-results.js'
import { useStore } from '../../store/useStore.js'

const MINUTE_MS = 60_000
const res = (status, headers = {}) => ({ status, headers: new Headers(headers) })

beforeEach(() => resetOffBudget())

describe('the Open Food Facts budget (ux-search.md §5)', () => {
  it('without the hub\'s count: 20 automatic searches a minute, and 10 more kept for taps', () => {
    const now = 1_000_000
    for (let i = 0; i < AUTO_PER_MIN; i++) { expect(canSearch('auto', now)).toBe(true); noteSearch('auto', now) }
    expect(canSearch('auto', now)).toBe(false)
    for (let i = 0; i < TAP_RESERVE; i++) { expect(canSearch('tap', now)).toBe(true); noteSearch('tap', now) }
    expect(canSearch('tap', now)).toBe(false)
    expect(canSearch('auto', now + 60_001)).toBe(true)
  })

  it('with RateLimit-Remaining: automatic only above 10, taps down to the last one', () => {
    const now = 2_000_000
    noteAnswer(res(200, { 'RateLimit-Remaining': '11' }), now)
    expect(canSearch('auto', now)).toBe(true)
    noteSearch('auto', now)
    expect(canSearch('auto', now)).toBe(false)
    expect(canSearch('tap', now)).toBe(true)
    noteAnswer(res(200, { 'RateLimit-Remaining': '0' }), now)
    expect(canSearch('tap', now)).toBe(false)
  })

  it('a 429 pauses everything for its Retry-After (15 s when it says nothing, 60 s at most)', () => {
    const now = 3_000_000
    noteAnswer(res(429, { 'Retry-After': '12' }), now)
    expect(canSearch('tap', now)).toBe(false)
    expect(pausedFor(now)).toBe(12)
    expect(canSearch('tap', now + 11_999)).toBe(false)
    expect(canSearch('auto', now + 12_001)).toBe(true) // the hub's window is over: the pause was the wait
    resetOffBudget()
    noteAnswer(res(429), now)
    expect(pausedFor(now)).toBe(15)
    resetOffBudget()
    noteAnswer(res(429, { 'Retry-After': '600' }), now)
    expect(pausedFor(now)).toBe(60)
  })

  // The hub's bucket (fitness-hub src/rate-limit.ts): 30 tokens, one back every two seconds. Its
  // 429 carries RateLimit-Remaining: 0 and a Retry-After for ONE token, about two seconds.
  describe('after a 429 from the hub\'s bucket', () => {
    const refusal = now => noteAnswer(res(429, { 'Retry-After': '2', 'RateLimit-Remaining': '0' }), now)

    it('allows only taps once the pause is over, never the automatic searches', () => {
      const now = 4_000_000
      refusal(now)
      expect(canSearch('tap', now + 1_999)).toBe(false)
      expect(canSearch('tap', now + 2_000)).toBe(true)
      for (const later of [2_000, 10_000, 60_000, 600_000]) expect(canSearch('auto', now + later)).toBe(false)
    })

    it('does not credit tokens back before an answer says where the bucket is', () => {
      const now = 5_000_000
      refusal(now)
      noteSearch('tap', now + 2_000)
      expect(canSearch('auto', now + 120_000)).toBe(false)
      expect(waitFor('auto', now + 2_000)).toBe(Infinity)
      expect(waitFor('tap', now + 500)).toBe(1_500)
    })

    it('then credits them at the bucket\'s rate from that answer: automatic only above the ten kept for taps', () => {
      const now = 6_000_000
      refusal(now)
      noteAnswer(res(200, { 'RateLimit-Remaining': '3' }), now + 2_100)
      const at = now + 2_100
      expect(canSearch('auto', at)).toBe(false)
      expect(canSearch('tap', at)).toBe(true)
      // 3 tokens, one more every 2 s: 11 of them (more than ten) 16 s later, not before.
      expect(canSearch('auto', at + 15_999)).toBe(false)
      expect(canSearch('auto', at + 16_000)).toBe(true)
      expect(waitFor('auto', at)).toBe(16_000)
      // The bucket never holds more than its 30, however long it has been since.
      const later = at + 3_600_000
      for (let i = 0; i < CAP_PER_MIN; i++) noteSearch('tap', later)
      expect(canSearch('tap', later)).toBe(false)
    })

    it('typing right after a burst never spends the ten kept for taps', () => {
      const now = 7_000_000
      for (let i = 0; i < AUTO_PER_MIN; i++) noteSearch('auto', now)
      refusal(now)
      let sent = 0
      // A minute of typing: a query every second, each asking if it may go.
      for (let s = 3; s < 63; s++) if (canSearch('auto', now + s * 1000)) { noteSearch('auto', now + s * 1000); sent += 1 }
      expect(sent).toBe(0)
      expect(canSearch('tap', now + 64_000)).toBe(true)
    })

    it('an answer that lands during the pause was asked before it and does not lift it', () => {
      const now = 8_000_000
      refusal(now)
      noteAnswer(res(200, { 'RateLimit-Remaining': '25' }), now + 500)
      expect(canSearch('auto', now + 2_500)).toBe(false)
    })
  })

  it('waits for the local count to age out when there is no count from the hub', () => {
    const now = 9_500_000
    for (let i = 0; i < AUTO_PER_MIN; i++) noteSearch('auto', now + i)
    expect(waitFor('auto', now + 100)).toBe(MINUTE_MS - 100)
    expect(waitFor('tap', now + 100)).toBe(0)
  })

  it('signing out, or another account, forgets the count and the pause', () => {
    useStore.setState({ user: { id: 1, name: 'A' } })
    const now = Date.now()
    noteAnswer(res(429, { 'Retry-After': '30' }), now)
    expect(pausedFor(now)).toBe(30)
    useStore.setState({ user: null })
    expect(pausedFor(now)).toBe(0)
    expect(canSearch('tap', now)).toBe(true)
    useStore.setState({ user: { id: 1, name: 'A' } })
    for (let i = 0; i < AUTO_PER_MIN; i++) noteSearch('auto', now)
    expect(canSearch('auto', now)).toBe(false)
    useStore.setState({ user: { id: 2, name: 'B' } })
    expect(canSearch('auto', now)).toBe(true)
  })

  it('searches by itself only from three letters, from Home or Nutrition or scoped to foods, with under five of your foods', () => {
    expect(autoOnline({ query: 'nut', tab: 'home', group: null, ownCount: 0 })).toBe(true)
    expect(autoOnline({ query: 'nu', tab: 'home', group: null, ownCount: 0 })).toBe(false)
    expect(autoOnline({ query: 'nutella', tab: 'train', group: null, ownCount: 0 })).toBe(false)
    expect(autoOnline({ query: 'nutella', tab: 'train', group: 'foods', ownCount: 0 })).toBe(true)
    expect(autoOnline({ query: 'nutella', tab: 'food', group: null, ownCount: 5 })).toBe(false)
  })
})
