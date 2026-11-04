// @vitest-environment happy-dom
// "Share with a friend": the sheet builds the link and hands it to the share sheet (weights and
// name only when switched on), a routine too big for a link goes as a plan file, and a link that
// comes in opens a preview whose Add puts a new routine next to the ones already there.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const m = vi.hoisted(() => {
  const state = { S: null, sheets: [], toasts: [], navs: [], user: null }
  state.store = () => ({
    S: state.S, user: state.user,
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
  const ui = { openSheet: render => { m.sheets.push(render); return { close: vi.fn() } }, toast: msg => m.toasts.push(msg) }
  const useUI = sel => (sel ? sel(ui) : ui)
  useUI.getState = () => ui
  return { useUI }
})
vi.mock('../lib/nav.js', () => ({ nav: to => m.navs.push(to) }))

import { shareRoutineSheet, openRoutinePayload, _resetRoutineLinksForTests } from './RoutineShare.jsx'
import { routinePayloadFromUrl, decodePayload, encodePayload, routineLinkBundle } from '../lib/routine-link.js'
import { canonicalProfile, ruleOccurrence } from '../lib/test-fixtures.js'
import { planPhase } from '../lib/prescription/index.js'
import { EXIDX } from '../lib/exercises.js'

const BENCH = '0025'
let host, root
const flush = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise(r => setTimeout(r, 0)) })
const render = async el => { await act(async () => { root.render(el) }); await flush() }
const openSheet = async () => { const r = m.sheets.at(-1); await render(<>{r(vi.fn())}</>) }
const click = async el => { await act(async () => { el.click() }); await flush() }
const button = text => [...host.querySelectorAll('button')].find(b => b.textContent.includes(text))
const push = { id: 'r1', name: 'Push Day', ex: [ruleOccurrence(BENCH, { options: { sets: { min: 3, max: 3 }, reps: { min: 8, max: 8 }, load: { mode: 'absolute', value: 80, unit: 'kg' } } })] }

beforeEach(() => {
  m.S = canonicalProfile({ routines: [push], workouts: [] })
  m.sheets = []; m.toasts = []; m.navs = []; m.user = { name: 'Alex' }
  _resetRoutineLinksForTests()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  delete navigator.share
})

describe('Share with a friend', () => {
  it('shares an opengym.ch/r link with a short text, without weights or name by default', async () => {
    const share = vi.fn(() => Promise.resolve())
    navigator.share = share
    shareRoutineSheet(push)
    await openSheet()
    await click(button('Share link'))
    // The link is compressed (CompressionStream), which can outlast a few ticks on a busy CI
    // runner: wait for the share sheet. A late one would land in the next test's share mock.
    await vi.waitFor(() => expect(share).toHaveBeenCalledTimes(1), { timeout: 5000 })
    const { url, text } = share.mock.calls[0][0]
    expect(text).toBe('Here’s my Push Day on openGym 💪')
    expect(url.startsWith('https://opengym.ch/r#1.')).toBe(true)
    const data = await decodePayload(routinePayloadFromUrl(url))
    expect(planPhase(data.routines[0].ex[0].rule).parameters.load.value).toBe(0)
    expect(data.from).toBeUndefined()
  })

  it('takes the weights and the name along when switched on', async () => {
    const share = vi.fn(() => Promise.resolve())
    navigator.share = share
    shareRoutineSheet(push)
    await openSheet()
    const [weights, name] = host.querySelectorAll('[role="switch"]')
    await click(weights)
    await click(name)
    expect(host.querySelector('input').value).toBe('Alex')
    await click(button('Share link'))
    await vi.waitFor(() => expect(share).toHaveBeenCalledTimes(1), { timeout: 5000 })
    const data = await decodePayload(routinePayloadFromUrl(share.mock.calls[0][0].url))
    expect(planPhase(data.routines[0].ex[0].rule).parameters.load.value).toBe(80)
    expect(data.from).toBe('Alex')
  })

  it('a routine too big for a link goes as a plan file', async () => {
    const big = { id: 'b', name: 'Everything', ex: Object.keys(EXIDX).slice(0, 120).map(id => ({ ...ruleOccurrence(id, { routineId: 'b', options: { sets: { min: 3, max: 3 }, reps: { min: 8, max: 8 } } }), note: 'a note to make it long ' + id })) }
    const share = vi.fn()
    navigator.share = share
    URL.createObjectURL = vi.fn(() => 'blob:x'); URL.revokeObjectURL = vi.fn()
    const clicks = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    shareRoutineSheet(big)
    await openSheet()
    await click(button('Share link'))
    // Compressing 120 exercises can outlast a few ticks on a slow CI runner: wait for the result.
    await vi.waitFor(() => expect(clicks).toHaveBeenCalled(), { timeout: 5000 })
    expect(share).not.toHaveBeenCalled()
    expect(m.toasts.at(-1)).toMatch(/plan file/)
    clicks.mockRestore()
  })
})

describe('an incoming routine link', () => {
  it('opens a preview, and Add puts a new routine next to yours', async () => {
    const payload = await encodePayload(routineLinkBundle(m.S, push, { weights: true, from: 'Sam' }))
    expect(await openRoutinePayload(payload)).toBe(true)
    await openSheet()
    expect(host.textContent).toContain('Push Day')
    expect(host.textContent).toContain('From Sam')
    await click(button('Add to my routines'))
    expect(m.S.routines).toHaveLength(2)
    expect(m.S.routines[0]).toEqual(push)
    expect(m.S.routines[1].name).toBe('Push Day (from Sam)')
    expect(m.navs.at(-1)).toBe('/plan/r/' + m.S.routines[1].id)
  })

  it('says why a broken or newer link does not open', async () => {
    expect(await openRoutinePayload('1.j.bm9wZQ')).toBe(false)
    expect(m.toasts.at(-1)).toBe('This routine link is broken or cut off.')
    expect(await openRoutinePayload('9.d.abc')).toBe(false)
    expect(m.toasts.at(-1)).toMatch(/newer openGym/)
    expect(m.sheets).toHaveLength(0)
  })
})
