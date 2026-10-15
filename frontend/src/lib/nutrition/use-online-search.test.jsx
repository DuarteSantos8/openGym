// @vitest-environment happy-dom
// The online search's timing: one request once typing pauses, the one in flight aborted by the
// next, an answer to an old query never shown, and an answered query not asked again.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useNutrition } from './store.js'
import { clearOnlineSearchCache, useOnlineSearch } from './use-online-search.js'

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
  clearOnlineSearchCache()
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
