// @vitest-environment happy-dom
// NFC stickers: the setup sheet writes what you chose (the plugin mocked), and a tapped sticker
// does the right thing in the app (start, open, check in, jump, offer to add, details).
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const m = vi.hoisted(() => {
  const state = { S: null, sheets: [], toasts: [], navs: [], write: null, onLink: null }
  state.store = () => ({
    S: state.S,
    update: mut => { const next = structuredClone(state.S); mut(next); state.S = next },
  })
  return state
})

vi.mock('../store/useStore.js', () => {
  const useStore = sel => (sel ? sel(m.store()) : m.store())
  useStore.getState = m.store
  return { useStore }
})
vi.mock('../store/useUI.js', () => {
  const ui = { openSheet: render => { m.sheets.push(render); return { close: vi.fn() } }, toast: msg => m.toasts.push(msg), shiftRestOwner: vi.fn() }
  const useUI = sel => (sel ? sel(ui) : ui)
  useUI.getState = () => ui
  return { useUI }
})
vi.mock('../lib/nav.js', () => ({ nav: (...a) => m.navs.push(a[0]), navToWorkout: () => m.navs.push('/workout') }))
vi.mock('../lib/nfc.js', () => ({
  nfcSupport: vi.fn(() => Promise.resolve({ supported: true, enabled: true })),
  writeTag: vi.fn((url, opts) => m.write(url, opts)),
  cancelWrite: vi.fn(() => Promise.resolve()),
  onTagLink: vi.fn(cb => { m.onLink = cb; return () => { m.onLink = null } }),
}))
vi.mock('../sheets.jsx', () => ({
  startFlow: vi.fn(), confirmSheet: vi.fn(), exerciseDetailSheet: vi.fn(),
}))

import { nfcStickerSheet, nfcExerciseSheet, handleTagLink, useNfcTagLinks, addExerciseToSession, _resetNfcRunForTests } from './Nfc.jsx'
import { startFlow, confirmSheet, exerciseDetailSheet } from '../sheets.jsx'
import { writeTag } from '../lib/nfc.js'
import { EXIDX } from '../lib/exercises.js'

let host, root
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve() })
const render = async el => { await act(async () => { root.render(el) }); await flush() }
const openSheet = async () => { const r = m.sheets.at(-1); await render(<>{r(vi.fn())}</>) }
const click = async el => { await act(async () => { el.click() }); await flush() }
const button = text => [...host.querySelectorAll('button')].find(b => b.textContent.includes(text))
const today = () => new Date().getDay()
const EX_A = Object.keys(EXIDX)[0]
const EX_B = Object.keys(EXIDX)[1]

beforeEach(() => {
  m.S = { routines: [{ id: 'r1', name: 'Push', ex: [{ id: EX_A }] }], week: { [today()]: ['r1'] }, dayPlan: {}, workouts: [], queue: { ids: [] }, gymCards: [], customEx: [] }
  m.sheets = []; m.toasts = []; m.navs = []
  m.write = () => Promise.resolve(true)
  _resetNfcRunForTests()
  vi.clearAllMocks()
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  globalThis.location.hash = '#/home'
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('setting up a sticker', () => {
  it('writes a start sticker by default, then says it is ready', async () => {
    nfcStickerSheet()
    await openSheet()
    expect(host.textContent).toContain('Set up an NFC sticker')
    // Without a membership code there is nothing to check in with: only the start choice shows.
    expect(host.textContent).not.toContain('Just check in')
    await click(button('Write sticker'))
    expect(writeTag).toHaveBeenCalledWith('https://opengym.ch/nfc?do=start', expect.objectContaining({ alert: expect.any(String) }))
    expect(host.textContent).toContain('Sticker ready')
  })

  it('a check-in sticker carries the chosen code when there are several', async () => {
    m.S.gymCards = [{ id: 'c1', label: 'City' }, { id: 'c2', label: 'Uni' }]
    m.S.lastGymCardId = 'c2'
    nfcStickerSheet()
    await openSheet()
    await click(button('Just check in'))
    expect(host.textContent).toContain('Which code')
    await click(button('City'))
    await click(button('Write sticker'))
    expect(writeTag).toHaveBeenCalledWith('https://opengym.ch/nfc?do=checkin&card=c1', expect.anything())
  })

  it('a failed write says why and offers to try again; a cancel goes quietly back', async () => {
    m.write = () => Promise.reject(Object.assign(new Error('x'), { code: 'too-small' }))
    nfcStickerSheet()
    await openSheet()
    await click(button('Write sticker'))
    expect(host.querySelector('[role=alert]').textContent).toContain('too small')
    m.write = () => Promise.reject(Object.assign(new Error('x'), { code: 'cancelled' }))
    await click(button('Try again'))
    expect(host.querySelector('[role=alert]')).toBeNull()
    expect(button('Write sticker')).toBeTruthy()
  })

  it('an exercise sticker points at that exercise', async () => {
    nfcExerciseSheet(EXIDX[EX_B])
    await openSheet()
    await click(button('Write sticker'))
    expect(writeTag).toHaveBeenCalledWith('https://opengym.ch/nfc?ex=' + EX_B, expect.anything())
  })
})

describe('a tapped sticker', () => {
  it('starts today’s workout through the usual Start', () => {
    expect(handleTagLink('https://opengym.ch/nfc?do=start', 1000)).toBe(true)
    expect(startFlow).toHaveBeenCalledWith(['r1'])
  })

  it('opens the running workout instead of starting another', () => {
    m.S.active = { start: 1, cur: 0, entries: [{ id: EX_A }] }
    handleTagLink('opengym://nfc?do=start', 1000)
    expect(startFlow).not.toHaveBeenCalled()
    expect(m.navs).toEqual(['/workout'])
  })

  it('the same tap twice does it once', () => {
    handleTagLink('https://opengym.ch/nfc?do=start', 1000)
    handleTagLink('https://opengym.ch/nfc?do=start', 1300)
    expect(startFlow).toHaveBeenCalledTimes(1)
  })

  it('the sticker just written is not acted on while the phone is still on it', async () => {
    nfcStickerSheet()
    await openSheet()
    await click(button('Write sticker'))
    handleTagLink('https://opengym.ch/nfc?do=start')
    expect(startFlow).not.toHaveBeenCalled()
    handleTagLink('https://opengym.ch/nfc?do=start', Date.now() + 5000)
    expect(startFlow).toHaveBeenCalledTimes(1)
  })

  it('a check-in sticker opens the code screen on its card', () => {
    m.S.gymCards = [{ id: 'c1' }, { id: 'c2' }]
    handleTagLink('https://opengym.ch/nfc?do=checkin&card=c2', 1000)
    expect(m.S.lastGymCardId).toBe('c2')
    expect(m.navs).toEqual(['/checkin'])
  })

  it('a machine sticker jumps to its exercise in the session', () => {
    m.S.active = { start: 1, cur: 0, entries: [{ id: EX_A, sets: [] }, { id: EX_B, sets: [] }] }
    handleTagLink('https://opengym.ch/nfc?ex=' + EX_B, 1000)
    expect(m.S.active.cur).toBe(1)
    expect(m.navs).toEqual(['/workout'])
    expect(m.toasts).toHaveLength(1)
  })

  it('asks before adding an exercise the session does not have', () => {
    m.S.active = { start: 1, cur: 0, routineIds: [], entries: [{ id: EX_A, sets: [{ w: 20, r: 5 }] }] }
    handleTagLink('https://opengym.ch/nfc?ex=' + EX_B, 1000)
    expect(confirmSheet).toHaveBeenCalledTimes(1)
    expect(m.S.active.entries).toHaveLength(1)
    confirmSheet.mock.calls[0][0].onConfirm()
    expect(m.S.active.entries.map(e => e.id)).toEqual([EX_A, EX_B])
    expect(m.S.active.cur).toBe(1)
  })

  it('outside a workout a machine sticker opens the exercise', () => {
    handleTagLink('opengym://exercise/' + EX_B, 1000)
    expect(exerciseDetailSheet).toHaveBeenCalledWith(EXIDX[EX_B])
  })

  it('an exercise this profile does not have just says so', () => {
    handleTagLink('https://opengym.ch/nfc?ex=nosuchexercise', 1000)
    expect(exerciseDetailSheet).not.toHaveBeenCalled()
    expect(m.toasts).toHaveLength(1)
  })

  it('leaves links that are not ours alone', () => {
    expect(handleTagLink('https://example.com/nfc?do=start', 1000)).toBe(false)
    expect(startFlow).not.toHaveBeenCalled()
  })

  it('one that opened the app waits until the app is set up', async () => {
    function Probe({ ready }) { useNfcTagLinks(ready); return null }
    vi.useFakeTimers()
    try {
      await render(<Probe ready={false} />)
      m.onLink('https://opengym.ch/nfc?do=start')
      expect(startFlow).not.toHaveBeenCalled()
      await render(<Probe ready={true} />)
      await act(async () => { vi.runAllTimers() })
      expect(startFlow).toHaveBeenCalledWith(['r1'])
    } finally { vi.useRealTimers() }
  })
})

describe('addExerciseToSession', () => {
  it('does nothing without a session', () => {
    m.S.active = null
    expect(addExerciseToSession(EX_B)).toBe(-1)
  })
})
