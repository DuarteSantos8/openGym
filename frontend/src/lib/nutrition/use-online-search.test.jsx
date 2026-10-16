// @vitest-environment happy-dom
// The online search's timing: one request once typing pauses, the one in flight aborted by the
// next, an answer to an old query never shown, and an answered query not asked again.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useNutrition } from './store.js'
import { CACHE_MAX, cachedOnline, fetchOnline, resetOnlineSearch, useOnlineSearch } from './use-online-search.js'
import { AUTO_PER_MIN, noteAnswer, noteSearch, resetOffBudget } from './off-budget.js'
import { useStore } from '../../store/useStore.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let calls
let root
let seen

// Each call waits for the test to answer it.
function stubSearch() {
  calls = []
  useNutrition.setState({
    searchOnline: (q, lang, { signal }) => new Promise((resolve, reject) => {
      const call = { q, lang, signal, answer: list => resolve(list), fail: e => reject(e) }
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { code: 'aborted' })))
      calls.push(call)
    }),
  })
}

function Probe({ q, active = true, lang = 'en' }) {
  seen = useOnlineSearch(q, { active, lang })
  return null
}
const show = props => act(() => root.render(<Probe {...props} />))
const wait = ms => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
const flush = () => act(async () => { await Promise.resolve() })

beforeEach(() => {
  vi.useFakeTimers()
  resetOffBudget()
  resetOnlineSearch()
  stubSearch()
  root = createRoot(document.createElement('div'))
})
afterEach(() => {
  act(() => root.unmount())
  vi.useRealTimers()
})

describe('useOnlineSearch', () => {
  it('asks once, for what is typed when typing pauses', async () => {
    show({ q: 'nu' })
    await wait(200)
    show({ q: 'nut' })
    await wait(200)
    show({ q: 'nutella' })
    await wait(499)
    expect(calls).toHaveLength(0)
    await wait(1)
    expect(calls.map(c => c.q)).toEqual(['nutella'])
    expect(seen.status).toBe('loading')
  })

  it('aborts the search in flight when the query changes, and never shows its answer', async () => {
    show({ q: 'milk' })
    await wait(500)
    show({ q: 'cheese' })
    expect(calls[0].signal.aborted).toBe(true)
    await wait(500)
    calls[1].answer([{ name: 'Cheddar' }])
    await flush()
    expect(seen).toMatchObject({ status: 'ready', query: 'cheese', results: [{ name: 'Cheddar' }] })
    // The old answer arriving late changes nothing, and is no error.
    calls[0].answer([{ name: 'Milk' }])
    await flush()
    expect(seen.results).toEqual([{ name: 'Cheddar' }])
    expect(seen.status).toBe('ready')
  })

  it('says nothing for a query under two characters, or while it is off', async () => {
    show({ q: 'n' })
    await wait(600)
    show({ q: 'nutella', active: false })
    await wait(600)
    expect(calls).toHaveLength(0)
    expect(seen.status).toBe('idle')
  })

  it('shows an answered query again without asking, per language', async () => {
    show({ q: 'Nutella' })
    await wait(500)
    calls[0].answer([{ name: 'Nutella' }])
    await flush()
    show({ q: 'nutella', active: false })
    show({ q: 'nutella ' })
    expect(seen).toMatchObject({ status: 'ready', results: [{ name: 'Nutella' }] })
    await wait(600)
    expect(calls).toHaveLength(1)
    show({ q: 'nutella', lang: 'de' })
    await wait(500)
    expect(calls.map(c => c.lang)).toEqual(['en', 'de'])
  })

  it('asks nothing while the hub has paused every search, counts down, and asks once the pause is over', async () => {
    noteAnswer({ status: 429, headers: new Headers({ 'Retry-After': '3' }) })
    show({ q: 'oats' })
    await wait(600)
    expect(calls).toHaveLength(0)
    expect(seen).toMatchObject({ status: 'paused', seconds: 3 })
    await wait(1000)
    expect(seen.seconds).toBe(2)
    await wait(2000)
    await wait(500)
    expect(calls.map(c => c.q)).toEqual(['oats'])
    expect(seen.status).toBe('loading')
  })

  it('a food picker stays inside the client budget too: spent, it asks nothing and says paused, with the countdown', async () => {
    for (let i = 0; i < AUTO_PER_MIN; i++) noteSearch('auto')
    show({ q: 'oats' })
    await wait(600)
    expect(calls).toHaveLength(0)
    expect(seen.status).toBe('paused')
    expect(seen.seconds).toBeGreaterThan(50)
    // The count ages out, and the query is asked once it has.
    await wait(60_000)
    expect(seen.status).toBe('loading')
    await wait(500)
    expect(calls.map(c => c.q)).toEqual(['oats'])
  })

  it('the picker\'s search action is a tap: it spends the ten kept for taps when typing may not', async () => {
    for (let i = 0; i < AUTO_PER_MIN; i++) noteSearch('auto')
    show({ q: 'oats' })
    await wait(600)
    expect(seen.status).toBe('paused')
    act(() => seen.ask())
    await wait(0)
    expect(calls.map(c => c.q)).toEqual(['oats'])
    expect(seen.status).toBe('loading')
  })

  it('a burst that ends in a 429, then typing: counted down, then waiting for a tap, which the picker\'s search action is', async () => {
    noteAnswer({ status: 429, headers: new Headers({ 'Retry-After': '2', 'RateLimit-Remaining': '0' }) })
    show({ q: 'oats' })
    await wait(600)
    expect(seen).toMatchObject({ status: 'paused', seconds: 2 })
    // The pause is over, and the bucket is not: typing asks nothing, whatever is typed.
    await wait(2000)
    expect(seen.status).toBe('tap')
    show({ q: 'oatmeal' })
    await wait(2000)
    show({ q: 'oatmeal bar' })
    await wait(600)
    expect(calls).toHaveLength(0)
    expect(seen.status).toBe('tap')
    // The search key: a search the person asked for, which goes at once.
    act(() => seen.ask())
    await wait(0)
    expect(calls.map(c => c.q)).toEqual(['oatmeal bar'])
    expect(seen.status).toBe('loading')
    calls[0].answer([{ name: 'Oatmeal bar' }])
    await flush()
    expect(seen).toMatchObject({ status: 'ready', results: [{ name: 'Oatmeal bar' }] })
  })

  it('shows paused, not an error, when the budget runs out while the search waits its turn', async () => {
    show({ q: 'oats' })
    await wait(300)
    for (let i = 0; i < AUTO_PER_MIN; i++) noteSearch('auto')
    await wait(200)
    expect(calls).toHaveLength(0)
    expect(seen.status).toBe('paused')
    expect(seen.error).toBeNull()
  })

  it('does not keep a failed search, so the next try asks again', async () => {
    show({ q: 'oats' })
    await wait(500)
    calls[0].fail(Object.assign(new Error('x'), { status: 429 }))
    await flush()
    expect(seen.status).toBe('error')
    show({ q: 'oats', active: false })
    show({ q: 'oats' })
    await wait(500)
    expect(calls).toHaveLength(2)
  })
})

describe('fetchOnline', () => {
  it('refuses a search the budget has no room for, for every caller, and still lets a tap through', async () => {
    for (let i = 0; i < AUTO_PER_MIN; i++) noteSearch('auto')
    await expect(fetchOnline('oats')).rejects.toMatchObject({ status: 429 })
    expect(calls).toHaveLength(0)
    const tapped = fetchOnline('oats', { kind: 'tap' })
    expect(calls).toHaveLength(1)
    calls[0].answer([{ name: 'Oats' }])
    await expect(tapped).resolves.toEqual([{ name: 'Oats' }])
  })

  it('sends one request for the same query asked twice at once, and a caller leaving does not cancel the other', async () => {
    const first = new AbortController()
    const a = fetchOnline('Oats', { signal: first.signal })
    const b = fetchOnline(' oats')
    expect(calls).toHaveLength(1)
    first.abort()
    await expect(a).rejects.toMatchObject({ code: 'aborted' })
    expect(calls[0].signal.aborted).toBe(false)
    calls[0].answer([{ name: 'Oats' }])
    await expect(b).resolves.toEqual([{ name: 'Oats' }])
    expect(cachedOnline('oats')).toEqual([{ name: 'Oats' }])
  })

  it('a caller asking for the query after the last one left starts a search of its own, not the abandoned one', async () => {
    const gone = new AbortController()
    const a = fetchOnline('rice', { signal: gone.signal })
    gone.abort()
    // At once: a search that is aborted only settles later, which must not be a window to join it.
    const b = fetchOnline('rice')
    await expect(a).rejects.toMatchObject({ code: 'aborted' })
    expect(calls[0].signal.aborted).toBe(true)
    expect(calls).toHaveLength(2)
    expect(calls[1].signal.aborted).toBe(false)
    calls[1].answer([{ name: 'Rice' }])
    await expect(b).resolves.toEqual([{ name: 'Rice' }])
    expect(cachedOnline('rice')).toEqual([{ name: 'Rice' }])
  })

  it('abandons the request when the last caller waiting on it leaves', async () => {
    const one = new AbortController()
    const two = new AbortController()
    const a = fetchOnline('rice', { signal: one.signal })
    const b = fetchOnline('rice', { signal: two.signal })
    one.abort()
    expect(calls[0].signal.aborted).toBe(false)
    two.abort()
    expect(calls[0].signal.aborted).toBe(true)
    await expect(a).rejects.toMatchObject({ code: 'aborted' })
    await expect(b).rejects.toMatchObject({ code: 'aborted' })
    expect(cachedOnline('rice')).toBeUndefined()
  })

  it('keeps the most recently used answers and drops the oldest past its size', async () => {
    for (let i = 0; i < CACHE_MAX; i++) {
      resetOffBudget()
      const p = fetchOnline('q' + i)
      calls[i].answer([{ name: 'r' + i }])
      await p
    }
    // q0 is read again, so q1 is now the oldest.
    expect(cachedOnline('q0')).toEqual([{ name: 'r0' }])
    resetOffBudget()
    const p = fetchOnline('q' + CACHE_MAX)
    calls[CACHE_MAX].answer([{ name: 'new' }])
    await p
    expect(cachedOnline('q1')).toBeUndefined()
    expect(cachedOnline('q0')).toEqual([{ name: 'r0' }])
    expect(cachedOnline('q' + CACHE_MAX)).toEqual([{ name: 'new' }])
  })

  it('forgets everything on sign-out and on a switch of profile, in flight or answered', async () => {
    useStore.setState({ user: { id: 1, name: 'A' } })
    const done = fetchOnline('milk')
    calls[0].answer([{ name: 'Milk' }])
    await done
    expect(cachedOnline('milk')).toEqual([{ name: 'Milk' }])
    useStore.setState({ user: { id: 2, name: 'B' } })
    expect(cachedOnline('milk')).toBeUndefined()

    const late = fetchOnline('cheese')
    late.catch(() => {})
    useStore.setState({ user: null })
    expect(calls[1].signal.aborted).toBe(true)
    await expect(late).rejects.toMatchObject({ code: 'aborted' })
    expect(cachedOnline('cheese')).toBeUndefined()

    useStore.setState({ user: { id: 2, name: 'B' } })
    const again = fetchOnline('milk')
    calls[2].answer([{ name: 'Milk' }])
    await again
    useStore.setState({ user: { id: 3, name: 'C' } })
    expect(cachedOnline('milk')).toBeUndefined()
  })
})
