// @vitest-environment happy-dom
// Archive, Undo and Make current on Plan (motion moments 4 and 5): rows carry flip keys, the data is
// written at once, and the motion is only a visual layer. Reduce Motion: no slide, no transform transition.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import Plan from './Plan.jsx'
import { archiveIdsWithUndo, folderMenu } from '../components/RoutineMenus.jsx'

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
const menu = vi.hoisted(() => ({ last: null }))
vi.mock('../sheets.jsx', () => ({
  dayAssignSheet: vi.fn(), starterPlanSheet: vi.fn(), confirmSheet: vi.fn(), menuSheet: vi.fn(o => { menu.last = o }),
  planHasRoutines: () => true, exportPlanFile: vi.fn(), printWholePlan: vi.fn(), importPlanFile: vi.fn(),
}))
vi.mock('../components/RoutineFolder.jsx', () => ({ folderNameSheet: vi.fn() }))

const routine = (id, name, extra) => ({ id, name, ex: [{ id: '0025' }], ...extra })
let host, root, calls
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  localStorage.clear(); localStorage.setItem('gym_plan_view', 'routines')
  calls = []
  Element.prototype.animate = function (frames, opts) { calls.push({ el: this, frames, opts }); return {} }
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  useStore.setState(s => ({ S: { ...s.S,
    routines: [routine('a', 'Push A', { folder: 'Block 2' }), routine('b', 'Mobility'), routine('c', 'Old legs', { folder: 'Hyper' })],
    routineFolders: [{ name: 'Block 2', current: true }, { name: 'Hyper' }], week: {}, dayPlan: {} }, user: null }))
  act(() => root.render(<Plan />))
})
afterEach(() => { act(() => root.unmount()); host.remove(); document.documentElement.className = ''; delete Element.prototype.animate; useUI.setState({ toasts: [] }) })

const key = k => host.querySelector(`[data-flip-key="${k}"]`)
const run = async fn => { await act(async () => { fn(); await Promise.resolve() }) }

describe('Plan list motion', () => {
  it('routine rows, folder rows and the current block carry a flip key', () => {
    for (const k of ['a', 'b', 'fBlock 2', 'fHyper']) expect(key(k), k).not.toBeNull()
    expect(key('fBlock 2').classList.contains('plan-current')).toBe(true)
  })

  it('archive writes at once; the row trails 16 px as a ghost; the Archive row appears and fades in', async () => {
    await run(() => archiveIdsWithUndo(['b']))
    expect(useStore.getState().S.routines.find(r => r.id === 'b').archived).toBe(true)
    expect(key('b')).toBeNull()
    const out = calls.find(c => c.opts.duration === 100)
    expect(out.frames[1].transform).toBe('translateX(16px)')
    expect(out.el.getAttribute('aria-hidden')).toBe('true')
    expect(calls.some(c => c.el.dataset.flipKey === 'archive' && c.opts.duration === 160)).toBe(true)
  })

  it('Undo brings the row back: it fades in after 100 ms and the Archive row ticks', async () => {
    await run(() => archiveIdsWithUndo(['b']))
    calls.length = 0
    await run(() => useUI.getState().toastAction.run())
    expect(useStore.getState().S.routines.find(r => r.id === 'b').archived).toBeFalsy()
    expect(calls.find(c => c.el.dataset.flipKey === 'b').opts).toMatchObject({ duration: 160, delay: 100 })
  })

  it('Make current: lands the new block, 320 ms FLIP, old rows go', async () => {
    folderMenu('Hyper')
    const item = menu.last.sections[0].items[0]
    expect(item.label).toBe('Make current plan')
    await run(() => item.onClick())
    expect(key('fHyper').classList.contains('plan-current')).toBe(true)
    expect(key('fHyper').classList.contains('cur-land')).toBe(true)
    expect(calls.some(c => c.opts.duration === 100)).toBe(true)   // Push A (old plan) left
  })

  it('html.reduce-motion: no slide, no transform transition, no land class', async () => {
    document.documentElement.classList.add('reduce-motion')
    await run(() => archiveIdsWithUndo(['b']))
    expect(calls.every(c => !JSON.stringify(c.frames).includes('transform'))).toBe(true)
    expect(calls.find(c => c.opts.duration === 120).opts.easing).toBe('linear')
    for (const el of host.querySelectorAll('[data-flip-key]')) expect(el.style.transition).toBe('')
    folderMenu('Hyper')
    await run(() => menu.last.sections[0].items[0].onClick())
    expect(key('fHyper').classList.contains('cur-land')).toBe(false)
  })
})
