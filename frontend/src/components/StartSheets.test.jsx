// @vitest-environment happy-dom
// #930: Start can pick which workout, today's first; #976: a planned session can open on a preview
// with Start at its foot. Neither starts anything on its own.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { bindUI } from './ui.jsx'
import { todayISO } from '../lib/format.js'

const started = vi.hoisted(() => [])
vi.mock('../sheets.jsx', () => ({ startFlow: ids => started.push(ids) }))
import { startPickerSheet, startOrPreview, previewSheet } from './StartSheets.jsx'
import TabBar, { START_HOLD_MS } from './TabBar.jsx'

vi.mock('react-router-dom', () => ({ useNavigate: () => () => {}, useLocation: () => ({ pathname: '/home' }) }))

bindUI(useUI)
globalThis.IS_REACT_ACT_ENVIRONMENT = true
let host, root
const wd = new Date(todayISO() + 'T12:00:00').getDay()
beforeEach(() => {
  started.length = 0
  const S = structuredClone(DEF)
  S.routines = [
    { id: 'push', name: 'Push', emoji: null, ex: [{ id: '0025', sets: 3, reps: 8, w: 60 }] },
    { id: 'pull', name: 'Pull', emoji: null, ex: [{ id: '0027', sets: 3, reps: 10 }] },
    { id: 'mob', name: 'Morning mobility', emoji: null, ex: [{ id: '1162', sets: 2, reps: 12 }] },
  ]
  S.week = { [wd]: ['push'], [(wd + 1) % 7]: ['pull'] }
  S.weighIn = false
  useStore.setState({ S, user: { id: 1, name: 'x' } })
  useUI.setState({ sheets: [], toastMsg: '' })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })
const renderTop = () => { const sh = useUI.getState().sheets.at(-1); act(() => root.render(sh.render(() => useUI.getState().closeSheet(sh.id)))) }
const rowTitles = sel => [...host.querySelectorAll(sel + ' .lrow-t')].map(e => e.textContent)
const click = text => act(() => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text || b.querySelector('.lrow-t')?.textContent === text).click())

describe('the start picker (#930)', () => {
  it('has today first, then every other routine (unscheduled ones too), then freestyle', () => {
    startPickerSheet(); renderTop()
    expect(rowTitles('.start-today')).toEqual(['Push'])
    const all = rowTitles('.menu-list')
    expect(all).toEqual(['Push', 'Pull', 'Morning mobility', 'Freestyle workout (pick as you go)'])
    click('Morning mobility')
    expect(started).toEqual([['mob']])
    expect(useUI.getState().sheets).toHaveLength(0)
  })
  it('the Start tab: a tap starts today, a long press opens the picker, "Let me pick" asks every time', () => {
    vi.useFakeTimers()
    try {
      const onStart = vi.fn(), onPick = vi.fn()
      const btn = () => host.querySelector('[data-tour="start"]')
      act(() => root.render(<TabBar onStart={onStart} onPick={onPick} />))
      act(() => btn().click())
      expect(onStart).toHaveBeenCalledWith(['push'])
      act(() => btn().dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })))
      act(() => vi.advanceTimersByTime(START_HOLD_MS + 10))
      expect(onPick).toHaveBeenCalledTimes(1)
      act(() => btn().dispatchEvent(new PointerEvent('pointerup', { bubbles: true })))
      act(() => btn().click())   // the release of the hold starts nothing
      expect(onStart).toHaveBeenCalledTimes(1)
      act(() => useStore.getState().update(s => { s.startPick = 'ask' }))
      act(() => btn().click())
      expect(onPick).toHaveBeenCalledTimes(2)
      expect(onStart).toHaveBeenCalledTimes(1)
    } finally { vi.useRealTimers() }
  })
})

describe('the preview (#976)', () => {
  it('starts at once with the setting off, and previews with it on', () => {
    startOrPreview(['push'])
    expect(started).toEqual([['push']])
    act(() => useStore.getState().update(s => { s.previewStart = true }))
    startOrPreview(['push'])
    expect(started).toHaveLength(1)
    renderTop()
    expect(host.querySelector('h3').textContent).toBe('Push')
    const items = [...host.querySelectorAll('.preview-list li')]
    expect(items).toHaveLength(1)
    expect(items[0].querySelector('.lrow-s').textContent).toMatch(/^3 sets · /)
    click('Start Push')
    expect(started).toEqual([['push'], ['push']])
  })
  it('can swap to another workout from the preview', () => {
    previewSheet(['pull']); renderTop()
    click('Choose a different workout')
    renderTop()
    expect(host.querySelector('h3').textContent).toBe('What are we training?')
  })
})
