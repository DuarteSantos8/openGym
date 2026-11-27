// @vitest-environment happy-dom
// The Customize sheet (1.4.6): only the cards that have something to show today are offered,
// hidden ones stay so they can come back, a card turned on with nothing yet says when it shows
// up, and a card moves by its grip, by a hold on its row and by the (out of sight) arrows.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { Arranged, layoutSheet } from './PageLayout.jsx'
import { orderedCards } from '../lib/page-layout.js'
import { resetLive } from '../lib/card-live.js'
import { HOLD_MS } from '../lib/use-list-reorder.js'

const mounted = []
const render = el => {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(el))
  return host
}
const Card = ({ text }) => <div className="card">{text}</div>
const Nothing = () => null
// Home as the page draws it: Your week has nothing this week, the others something.
function Page() {
  const S = useStore(s => s.S)
  return <Arranged page="home" S={S} items={[
    { id: 'recap', node: <Nothing /> },
    { id: 'deload', node: <Card text="Deload" /> },
    { id: 'challenges', node: <Card text="Challenges" /> },
    { id: 'streak', node: <Card text="Streak" /> },
  ]} />
}
const openSheet = () => {
  act(() => layoutSheet('home'))
  return render(useUI.getState().sheets.at(-1).render(() => {}))
}
const rows = sh => [...sh.querySelectorAll('.lay-row')].map(r => r.dataset.lay)
const order = () => orderedCards(useStore.getState().S, 'home').map(c => c.id)

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  resetLive()
  useUI.setState({ sheets: [] })
  useStore.setState({ S: structuredClone(DEF), user: null })
})
afterEach(() => { act(() => { mounted.splice(0).forEach(r => r.unmount()) }); vi.useRealTimers() })

describe('the Customize sheet', () => {
  it('leaves out a card that has nothing to show today, and keeps a hidden one', () => {
    render(<Page />)
    let sh = openSheet()
    expect(rows(sh)).not.toContain('recap')
    expect(rows(sh)).toEqual(expect.arrayContaining(['deload', 'challenges', 'streak']))
    act(() => { mounted.pop().unmount() })
    // hidden: still offered, so it can be shown again, and then it says it has nothing yet
    act(() => useStore.getState().update(s => { s.layout = { home: { hidden: ['recap'] } } }))
    sh = openSheet()
    expect(rows(sh)).toContain('recap')
    const row = sh.querySelector('[data-lay="recap"]')
    expect(row.querySelector('.lay-hint')).toBeNull()
    act(() => [...row.querySelectorAll('.seg button')].find(b => b.textContent === 'Show').click())
    expect(sh.querySelector('[data-lay="recap"] .lay-hint').textContent).toBe('Shows up when there is something to show')
  })

  it('moves a card by its grip: down two places, the order the page draws follows', () => {
    render(<Page />)
    const sh = openSheet()
    const list = sh.querySelector('.lay-list')
    const all = [...list.querySelectorAll('.lay-row')]
    all.forEach((r, k) => { r.getBoundingClientRect = () => ({ top: k * 60, height: 56, bottom: k * 60 + 56, left: 0, right: 300, width: 300 }) })
    const first = all[0].dataset.lay
    const grip = all[0].querySelector('.lay-grip')
    act(() => grip.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientY: 20, button: 0 })))
    act(() => grip.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, clientY: 150 })))
    act(() => grip.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, clientY: 150 })))
    const ids = order().filter(id => rows(sh).includes(id) || id === first)
    expect(ids.indexOf(first)).toBe(2)
  })

  it('lifts a row after a hold and not when the finger moves first', () => {
    vi.useFakeTimers()
    render(<Page />)
    const sh = openSheet()
    const row = sh.querySelectorAll('.lay-row')[1]
    act(() => row.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 2, clientX: 10, clientY: 70, button: 0 })))
    act(() => row.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 2, clientX: 10, clientY: 95 })))
    act(() => vi.advanceTimersByTime(HOLD_MS + 50))
    expect(sh.querySelector('.lay-row.held')).toBeNull()
    act(() => row.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 2 })))
    act(() => row.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 3, clientX: 10, clientY: 70, button: 0 })))
    act(() => vi.advanceTimersByTime(HOLD_MS + 50))
    expect(sh.querySelector('.lay-row.held')?.dataset.lay).toBe(row.dataset.lay)
    act(() => row.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 3 })))
    expect(sh.querySelector('.lay-row.held')).toBeNull()
  })

  it('keeps the arrows for a keyboard and a screen reader', () => {
    render(<Page />)
    const sh = openSheet()
    const before = order()
    const name = sh.querySelectorAll('.lay-row')[0].querySelector('.lay-name').firstChild.textContent
    act(() => sh.querySelector(`[aria-label="Move ${name} down"]`).click())
    expect(order()).not.toEqual(before)
  })
})
