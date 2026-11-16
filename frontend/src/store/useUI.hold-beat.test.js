// @vitest-environment happy-dom
// Discord "Problem With Timed holds" (1.4.4): a 7 s front lever lasted about 9 s, the numbers froze
// and the voice lagged. The hold ticked every 1000 ms from when its clock started, so its end came
// up to half a second off by design (the seconds round) and a busy moment on the page pushed every
// later tick back too. Now each tick aims at the next whole second counted back from the end.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUI, nextBeatMs } from './useUI.js'

const T0 = 1_800_000_000_000

describe('a timed hold ends on time', () => {
  beforeEach(() => { vi.useFakeTimers({ now: T0 }); useUI.setState({ timer: null, work: null, countIn: null }) })
  afterEach(() => { useUI.getState().stopWork(); vi.useRealTimers() })

  it('the next beat is the next whole second before the end', () => {
    expect(nextBeatMs(T0 + 7000, T0)).toBe(1000)
    expect(nextBeatMs(T0 + 6400, T0)).toBe(400)
    expect(nextBeatMs(T0 + 7000, T0 + 7300)).toBe(700)   // overtime: on the second past the end
  })

  it('a hold whose clock started 0.6 s ago (the count-in, a locked phone) ends at its end, not up to half a second off', () => {
    const done = vi.fn()
    const startedAt = T0 - 600
    useUI.getState().startWork(7, 'Front lever', done, null, { startedAt })
    const lefts = []
    for (let t = 0; t < 7000; t += 10) {
      vi.advanceTimersByTime(10)
      const wk = useUI.getState().work
      if (wk && lefts.at(-1)?.left !== wk.left) lefts.push({ left: wk.left, at: Date.now() - startedAt })
      if (done.mock.calls.length) break
    }
    expect(done).toHaveBeenCalledTimes(1)
    const endedAt = Date.now() - startedAt
    expect(Math.abs(endedAt - 7000)).toBeLessThanOrEqual(20)
    expect(done.mock.calls[0][0]).toBe(7)
    // the 3, 2 and 1 change on their second
    for (const n of [3, 2, 1]) {
      const at = lefts.find(x => x.left === n)?.at
      expect(Math.abs(at - (7 - n) * 1000)).toBeLessThanOrEqual(20)
    }
  })

  it('a tick that comes late (the page was busy) does not make the end late', () => {
    const done = vi.fn()
    useUI.getState().startWork(7, 'Plank', done)
    vi.advanceTimersByTime(2000)
    // the page stalls for 1.3 s: the clock moves, no timer runs
    vi.setSystemTime(Date.now() + 1300)
    vi.advanceTimersByTime(1)
    // from here the beats are on the second again
    let t = 0
    while (!done.mock.calls.length && t < 6000) { vi.advanceTimersByTime(10); t += 10 }
    expect(done).toHaveBeenCalledTimes(1)
    expect(Math.abs(Date.now() - (T0 + 7000))).toBeLessThanOrEqual(20)
  })
})
