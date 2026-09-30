// @vitest-environment happy-dom
// #282: a single routine goes to paper from its editor — the browser's print dialog on the web,
// the native print flow in the app.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const env = vi.hoisted(() => ({ mobile: false, printHtml: null }))
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})) }))
vi.mock('../sheets.jsx', () => ({ exConfigSheet: vi.fn(), exercisePicker: vi.fn(), glyphPicker: vi.fn(), confirmSheet: vi.fn(), occurrenceSummary: vi.fn(() => ''), quickOccurrence: vi.fn() }))
vi.mock('../components/Media.jsx', () => ({ Thumb: () => null }))
vi.mock('../components/BodyMap.jsx', () => ({ default: () => null }))
vi.mock('../lib/plan-share.js', async importOriginal => ({ ...await importOriginal(), printPlan: vi.fn() }))
vi.mock('../lib/mobile.js', async importOriginal => {
  const real = await importOriginal()
  env.printHtml = vi.fn(() => Promise.resolve())
  return { ...real, get MOBILE() { return env.mobile }, printHtml: env.printHtml }
})

import RoutineEdit from './RoutineEdit.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { printPlan } from '../lib/plan-share.js'
import { ruleOccurrence } from '../lib/test-fixtures.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let root, host

function mount(ex, name = 'Push day') {
  const S = JSON.parse(JSON.stringify(DEF))
  S.routines = [{ id: 'r1', name, emoji: 'dumbbell', ex }]
  useStore.setState({ S, user: { id: 'u1', name: 'Ana' } })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(<MemoryRouter initialEntries={['/plan/r/r1']}><Routes><Route path="/plan/r/:id" element={<RoutineEdit />} /></Routes></MemoryRouter>))
}
const printButton = () => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === 'Print / Save as PDF')

beforeEach(() => {
  vi.clearAllMocks()
  env.mobile = false
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('RoutineEdit — print this routine (#282)', () => {
  it('opens the print dialog with this routine alone on the web', () => {
    mount([ruleOccurrence('0025')])
    act(() => printButton().click())
    expect(printPlan).toHaveBeenCalledOnce()
    const [S, owner, opts] = printPlan.mock.calls[0]
    expect(S.routines[0].id).toBe('r1')
    expect(owner).toBe('Ana')
    expect(opts).toEqual({ routineId: 'r1' })
    expect(env.printHtml).not.toHaveBeenCalled()
  })

  it('hands the page to the native print flow in the app, named after the routine', () => {
    env.mobile = true
    mount([ruleOccurrence('0025')])
    act(() => printButton().click())
    expect(printPlan).not.toHaveBeenCalled()
    expect(env.printHtml).toHaveBeenCalledOnce()
    const [html, name] = env.printHtml.mock.calls[0]
    expect(name).toBe('Push day')
    expect(html).toContain('<title>Push day</title>')
    expect(html).not.toContain('Week schedule')
  })

  it('names the print job even when the routine has no name, which Android refuses', () => {
    env.mobile = true
    mount([ruleOccurrence('0025')], '')
    act(() => printButton().click())
    expect(env.printHtml.mock.calls[0][1]).toBe('Routine')
  })

  it('has nothing to print for an empty routine', () => {
    mount([])
    expect(printButton().disabled).toBe(true)
  })
})
