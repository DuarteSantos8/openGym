// @vitest-environment happy-dom
// Issue #142: routines were stuck in the order they were created. `S.routines` is the single
// order every screen reads — Plan, the Start screen, the day-assignment sheets — so moving one
// here moves it everywhere.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore.js'
import Plan from './Plan.jsx'

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
vi.mock('../sheets.jsx', () => ({
  dayAssignSheet: vi.fn(), dayAddRoutineSheet: vi.fn(), starterPlanSheet: vi.fn(), planToolsSheet: vi.fn(),
}))

const routine = (id, name) => ({ id, name, emoji: null, ex: [{ id: '0025' }] })
let host, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  useStore.setState(s => ({ S: { ...s.S, routines: [routine('a', 'Push A'), routine('b', 'Pull A'), routine('c', 'Legs A')], week: {}, dayPlan: {} }, user: null }))
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const mount = () => act(() => root.render(<Plan />))
// The weekday rows above the routine list share the `.item` class, so the rows are found by the
// thing only a routine has: the move controls' own column.
const rows = () => [...host.querySelectorAll('.item')].filter(e => e.querySelector('button[aria-label="Move up"]'))
const names = () => rows().map(e => e.querySelector('.tt').textContent)
const btn = (row, label) => rows()[row].querySelector(`button[aria-label="${label}"]`)
const click = el => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) })

describe('routine order', () => {
  it('moves a routine down and the stored order follows', () => {
    mount()
    expect(names()).toEqual(['Push A', 'Pull A', 'Legs A'])
    click(btn(0, 'Move down'))
    expect(useStore.getState().S.routines.map(r => r.name)).toEqual(['Pull A', 'Push A', 'Legs A'])
    expect(names()).toEqual(['Pull A', 'Push A', 'Legs A'])
  })

  it('moves one up, and the ends cannot go further', () => {
    mount()
    click(btn(2, 'Move up'))
    expect(useStore.getState().S.routines.map(r => r.name)).toEqual(['Push A', 'Legs A', 'Pull A'])
    expect(btn(0, 'Move up').disabled).toBe(true)
    expect(btn(2, 'Move down').disabled).toBe(true)
  })

  it('leaves the arrows out when there is nothing to reorder', () => {
    useStore.setState(s => ({ S: { ...s.S, routines: [routine('a', 'Only one')] } }))
    mount()
    expect(host.querySelector('button[aria-label="Move up"]')).toBe(null)
  })
})
