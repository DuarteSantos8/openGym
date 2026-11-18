// @vitest-environment happy-dom
import React, { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const mocks = vi.hoisted(() => ({ S: null, toasts: [] }))
vi.mock('../store/useStore.js', async () => {
  const React = await import('react')
  const listeners = new Set()
  const update = mut => { const S = structuredClone(mocks.S); mut(S); mocks.S = S; listeners.forEach(f => f()) }
  const useStore = selector => {
    const [, tick] = React.useReducer(x => x + 1, 0)
    React.useEffect(() => { listeners.add(tick); return () => listeners.delete(tick) }, [])
    return selector({ S: mocks.S, update })
  }
  return { useStore }
})
vi.mock('../store/useUI.js', () => ({ useUI: selector => selector({ toast: (msg, opts) => mocks.toasts.push({ msg, ...opts }) }) }))
vi.mock('../lib/format.js', () => ({ todayISO: () => '2026-11-13' }))
import FoodDiary from './FoodDiary.jsx'

function Harness() { const [day, setDay] = useState('2026-11-13'); return <FoodDiary day={day} setDay={setDay} /> }
let host, root
beforeEach(() => {
  mocks.S = { workouts: [], unit: 'kg' }; mocks.toasts = []
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })
const mount = async () => act(async () => { root.render(<Harness />) })
const $ = sel => host.querySelector(sel)
const type = (el, value) => act(() => {
  const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
  el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
})
const click = async el => act(async () => el.click())

describe('food diary', () => {
  it('starts empty with zero totals and no way to page into the future', async () => {
    await mount()
    expect(host.textContent).toContain('Nothing logged for today')
    expect(host.textContent).toContain('0 kcal')
    expect($('[aria-label="Next day"]').disabled).toBe(true)
  })

  it('logs a food by hand and shows it under its meal with scaled totals', async () => {
    await mount()
    await click($('[data-open-manual]'))
    type($('input[name=name]'), 'Rolled oats')
    type($('input[name=amount]'), '60')
    type($('input[name=kcal]'), '372')
    type($('input[name=proteinG]'), '13.5')
    await click($('[data-log-manual]'))
    const [entry] = Object.values(mocks.S.foodLog)
    expect(entry).toMatchObject({ d: '2026-11-13', meal: 'breakfast', name: 'Rolled oats', amount: 60, basis: 'g', src: { kind: 'manual' } })
    expect(host.querySelector('.diary-meal h3').textContent).toBe('Breakfast')
    expect(host.textContent).toContain('223 kcal')
    expect(host.textContent).toContain('8.1 g')
    // Carbs and fat were left blank: said, not counted as zero.
    expect($('[data-gaps]').textContent).toContain('carbs on 1 entry')
  })

  it('refuses a bad entry with a reason and stores nothing', async () => {
    await mount()
    await click($('[data-open-manual]'))
    type($('input[name=name]'), 'Rice')
    type($('input[name=proteinG]'), '120')
    await click($('[data-log-manual]'))
    expect($('[role=alert]').textContent).toMatch(/Protein per 100 must be between 0 and 100/)
    expect(mocks.S.foodLog).toBeUndefined()
  })

  it('removes with an Undo that brings the entry back', async () => {
    mocks.S.foodLog = { a: { d: '2026-11-13', meal: 'lunch', name: 'Apple', amount: 150, basis: 'g', per100: { kcal: 52, proteinG: 0.3, carbohydrateG: 14, fatG: 0.2 }, src: { kind: 'manual' }, _ts: 1 } }
    await mount()
    await click($('[aria-label="Remove Apple"]'))
    expect(mocks.S.foodLog.a).toEqual({ _ts: expect.any(Number) })
    expect(host.textContent).not.toContain('Apple')
    expect(mocks.toasts[0]).toMatchObject({ msg: 'Removed Apple', action: 'Undo' })
    await act(async () => mocks.toasts[0].onAction())
    expect(host.textContent).toContain('Apple')
  })

  it('pages to yesterday and shows only that day', async () => {
    mocks.S.foodLog = {
      t: { d: '2026-11-13', meal: 'lunch', name: 'Today soup', amount: 300, basis: 'ml', per100: { kcal: 40, proteinG: null, carbohydrateG: null, fatG: null }, _ts: 1 },
      y: { d: '2026-11-12', meal: 'dinner', name: 'Yesterday pasta', amount: 200, basis: 'g', per100: { kcal: 150, proteinG: 5, carbohydrateG: 30, fatG: 1 }, _ts: 1 },
    }
    await mount()
    expect(host.textContent).toContain('Today soup')
    expect(host.textContent).toContain('300 mL')
    await click($('[aria-label="Previous day"]'))
    expect($('[data-day]').textContent).toBe('Yesterday')
    expect(host.textContent).toContain('Yesterday pasta')
    expect(host.textContent).not.toContain('Today soup')
    expect($('[aria-label="Next day"]').disabled).toBe(false)
  })
})
