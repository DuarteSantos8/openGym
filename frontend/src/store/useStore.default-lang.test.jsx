// @vitest-environment happy-dom
// #303: DEFAULT_LANG from /api/config sets the language of a fresh copy — the sign-in screen,
// and a profile created from it — and nothing else. A copy saved before the mark existed keeps
// its language even when that is the old default, 'en': it may well have been chosen.
//
// The language worked out for such a copy is the device's own and is never written into the
// synced state: two devices with browsers in different languages would otherwise push their
// answers over each other on every sync round.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ api: vi.fn() }))
vi.mock('./useUI.js', () => ({ useUI: { getState: () => ({ toast: vi.fn() }) } }))

import { api } from '../lib/api.js'
import { effectiveLang } from '../lib/default-lang.js'
import { useStore, freshState, DEF } from './useStore.js'

const clone = v => JSON.parse(JSON.stringify(v))
const nav = langs => Object.defineProperty(navigator, 'languages', { value: langs, configurable: true })
const shown = () => { const { S, config } = useStore.getState(); return effectiveLang(S, config) }
const puts = () => api.mock.calls.filter(([, o]) => o?.method === 'PUT')

beforeEach(() => { localStorage.clear(); api.mockReset(); nav(['en-US']); useStore.setState({ config: null }) })
afterEach(() => { localStorage.clear(); useStore.setState({ S: clone(DEF), user: null, ready: false, config: null }) })

describe('instance default language', () => {
  it('a fresh copy is marked as not having picked a language; DEF is not', () => {
    expect(freshState().langAuto).toBe(true)
    expect(DEF.langAuto).toBeUndefined()
  })

  it('a fresh copy is shown in DEFAULT_LANG once the config is in, and its state is left alone', async () => {
    useStore.setState({ S: freshState() })
    expect(shown()).toBe('en')   // nothing to go on before the config
    const before = clone(useStore.getState().S)

    api.mockResolvedValueOnce({ invite_only: false, allow_guest: true, default_lang: 'pt-BR' })
    await useStore.getState().refreshConfig()
    expect(shown()).toBe('pt-BR')
    expect(useStore.getState().S).toEqual(before)
  })

  it('the next boot uses the default this device last saw, before the config answers', async () => {
    nav(['de-DE'])
    api.mockResolvedValueOnce({ invite_only: false, default_lang: 'pt-BR' })
    await useStore.getState().refreshConfig()
    useStore.setState({ S: freshState(), config: null })
    expect(shown()).toBe('pt-BR')   // not the browser's German first
    // An instance known to have none: the browser's language at once.
    api.mockResolvedValueOnce({ invite_only: false })
    await useStore.getState().refreshConfig()
    useStore.setState({ config: null })
    expect(shown()).toBe('de')
  })

  it('without DEFAULT_LANG a fresh copy follows the browser when the app speaks it', () => {
    nav(['de-DE', 'en'])
    useStore.setState({ S: freshState(), config: { invite_only: false, allow_guest: true } })
    expect(shown()).toBe('de')
  })

  it('an existing copy with lang "en" and no mark is left in English', () => {
    nav(['de-DE'])
    useStore.setState({ S: { ...clone(DEF), lang: 'en' }, config: { default_lang: 'pt-BR' } })
    expect(shown()).toBe('en')
  })

  it('a language picked in Settings wins over DEFAULT_LANG from then on', () => {
    useStore.setState({ S: freshState(), config: { default_lang: 'pt-BR' } })
    expect(shown()).toBe('pt-BR')
    // What the Settings picker does.
    useStore.getState().update(s => { s.lang = 'en'; s.langAuto = false })
    expect(shown()).toBe('en')
  })

  it('two devices with browsers in different languages do not push the profile back and forth', async () => {
    // Device B's browser is English; the server copy was last written from device A (German).
    nav(['en-US'])
    const server = { ...clone(DEF), _ts: 100, lang: 'de', langAuto: true, workouts: [{ id: 'w1', d: '2026-09-01', start: 1, entries: [] }] }
    useStore.setState({ S: clone(server), user: { id: 'u1' }, ready: true, config: { invite_only: false } })
    localStorage.setItem('gym_sync', JSON.stringify({ rev: 5, ts: 100 }))
    expect(shown()).toBe('en')
    expect(useStore.getState().S.lang).toBe('de')

    // The next poll: the server has not moved, and this device owes it nothing.
    api.mockResolvedValue({ state: { ...server, _rev: 5 }, rev: 5 })
    await useStore.getState().pullState()
    await useStore.getState().pullState()
    expect(puts()).toHaveLength(0)
    expect(useStore.getState().S.lang).toBe('de')
    expect(shown()).toBe('en')
  })
})
