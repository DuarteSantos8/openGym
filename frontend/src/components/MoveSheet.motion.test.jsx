// @vitest-environment happy-dom
// Move to folder, from the sheet: the check shows at once, the sheet goes 120 ms after the pick through
// its normal close, and the data is written at once. Reduce Motion: the sheet goes at once.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { moveSheet } from './RoutineMenus.jsx'

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
const moves = []
vi.mock('../lib/list-motion.js', async orig => {
  const m = await orig()
  return { ...m, listMove: (change, o) => { moves.push(o); return m.listMove(change, o) } }
})

function Sheets() {
  const sheets = useUI(s => s.sheets)
  return <>{sheets.map(s => <div key={s.id} className="sheet">{s.render(() => useUI.getState().closeSheet(s.id))}</div>)}</>
}
let host, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers()
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  useUI.setState({ sheets: [] })
  useStore.setState(s => ({ S: { ...s.S, routines: [{ id: 'a', name: 'Push', ex: [{ id: '0025' }] }],
    routineFolders: [{ name: 'Block' }, { name: 'Travel' }], week: {}, dayPlan: {} } }))
  act(() => root.render(<Sheets />))
})
afterEach(() => { act(() => root.unmount()); host.remove(); document.documentElement.className = ''; vi.useRealTimers() })

const pick = name => [...host.querySelectorAll('.menu-item')].find(e => e.textContent.includes(name))
const open = () => { act(() => moveSheet(['a'])); return pick('Travel') }

describe('Move sheet motion', () => {
  it('checks at once, writes at once, and closes 120 ms later', () => {
    const item = open()
    act(() => { item.click() })
    expect(useStore.getState().S.routines[0].folder).toBe('Travel')
    expect(host.querySelector('.sheet')).not.toBeNull()
    expect(pick('Travel').querySelector('.menu-on').classList.contains('is-on')).toBe(true)
    expect(pick('Block').querySelector('.menu-on').classList.contains('is-on')).toBe(false)
    act(() => { vi.advanceTimersByTime(119) }); expect(host.querySelector('.sheet')).not.toBeNull()
    act(() => { vi.advanceTimersByTime(2) }); expect(host.querySelector('.sheet')).toBeNull()
  })

  it('a new folder has no sheet dismissing, so the row leaves with no hold', () => {
    moves.length = 0
    act(() => moveSheet(['a']))
    act(() => { pick('New folder').click() })
    const input = document.querySelector('input')
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Fresh')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const ok = [...document.querySelectorAll('button')].find(b => /^(Create|Save|Done|Add)/.test(b.textContent.trim()))
    act(() => { ok.click() })
    expect(useStore.getState().S.routines[0].folder).toBe('Fresh')
    expect(moves.at(-1).hold).toBe(0)
  })

  it('a second tap during the wait does nothing', () => {
    const item = open()
    act(() => { item.click() })
    act(() => { pick('Block').click() })
    expect(useStore.getState().S.routines[0].folder).toBe('Travel')
  })

  it('html.reduce-motion: the sheet goes at once', () => {
    document.documentElement.classList.add('reduce-motion')
    const item = open()
    act(() => { item.click() })
    expect(host.querySelector('.sheet')).toBeNull()
    expect(useStore.getState().S.routines[0].folder).toBe('Travel')
  })

  it('toasts "Moved to X" with an Undo once the sheet has gone; Undo puts the routines back', () => {
    useUI.setState({ toastMsg: '', toastAction: null })
    useStore.setState(s => ({ S: { ...s.S, routines: [{ id: 'a', name: 'Push', folder: 'Block', ex: [] }, { id: 'b', name: 'Pull', ex: [] }] } }))
    const item = open()
    act(() => { item.click() })
    expect(useUI.getState().toastMsg).toBe('')
    act(() => { vi.advanceTimersByTime(300) })
    expect(useUI.getState().toastMsg).toBe('Moved to Travel')
    act(() => { useUI.getState().runToastAction() })
    const r = useStore.getState().S.routines
    expect(r.map(x => x.id)).toEqual(['a', 'b'])
    expect(r[0].folder).toBe('Block')
  })

  it('a move to No folder says so and Undo restores the folder; Reduce Motion toasts at once', () => {
    document.documentElement.classList.add('reduce-motion')
    useUI.setState({ toastMsg: '', toastAction: null })
    useStore.setState(s => ({ S: { ...s.S, routines: [{ id: 'a', name: 'Push', folder: 'Block', ex: [] }] } }))
    act(() => moveSheet(['a']))
    act(() => { pick('No folder').click() })
    expect(useUI.getState().toastMsg).toBe('Moved to No folder')
    expect(useStore.getState().S.routines[0].folder).toBeUndefined()
    act(() => { useUI.getState().runToastAction() })
    expect(useStore.getState().S.routines[0].folder).toBe('Block')
  })
})

