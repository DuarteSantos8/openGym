// @vitest-environment happy-dom
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { EXDB } from './lib/exercises.js'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { exConfigSheet } from './sheets.jsx'

// A block of your own in fixed weights: a leg extension whose stack has 80 and 87.5, where 73% of
// 117.5 lands on 85, a plate the machine does not have.
const ex = EXDB.find(e => e.id === '0585')
const mounted = []

function render(sheet) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push([root, host])
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}
const open = (rows, onSave = () => {}) => {
  useStore.setState(s => ({ S: { ...s.S, unit: 'kg' } }))
  exConfigSheet(ex, { id: ex.id, sets: 2, reps: 12, weight: 117.5, mode: 'reps', warmup: 'own', warmupRows: rows }, onSave)
  return render(useUI.getState().sheets.at(-1))
}
const unitButton = host => host.querySelector('.warmup-load .btn')
const load = host => host.querySelector('.warmup-load .num').value
const click = el => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
const button = (host, text) => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)

describe('exercise settings: a warm-up in fixed weights', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [] })
    document.body.innerHTML = ''
  })
  afterEach(() => { act(() => { mounted.splice(0).forEach(([root, host]) => { root.unmount(); host.remove() }) }) })

  it('shows the row in kg and builds it at that weight', () => {
    const host = open([{ wf: 80, r: 12 }])
    expect(unitButton(host).textContent).toBe('kg')
    expect(load(host)).toBe('80')
    expect(host.textContent).toContain('With 117.5 kg today: 80 × 12')
  })

  it('the unit button turns the row into a share on the same weight today, and back', () => {
    const host = open([{ wf: 80, r: 12 }])
    expect(unitButton(host).getAttribute('aria-label')).toBe('kg: Switch to %')
    click(unitButton(host))
    expect(unitButton(host).textContent).toBe('%')
    expect(load(host)).toBe('69')
    expect(host.textContent).toContain('With 117.5 kg today: 80 × 12')
    click(unitButton(host))
    expect(unitButton(host).textContent).toBe('kg')
    expect(load(host)).toBe('80')
  })

  it('saves the fixed weight into the slot, with the share an older app reads', () => {
    let saved = null
    const host = open([{ wp: 50, r: 10 }, { wp: 69, r: 12 }], cfg => { saved = cfg })
    click(host.querySelectorAll('.warmup-load .btn')[1])
    click(button(host, 'Save'))
    expect(saved.warmup).toBe('own')
    expect(saved.warmupRows).toEqual([{ wp: 50, r: 10 }, { wf: 80, wp: 69, r: 12 }])
  })

  it('a fixed weight changed on the stepper keeps a share beside it', () => {
    let saved = null
    const host = open([{ wf: 80, r: 12 }], cfg => { saved = cfg })
    click(host.querySelectorAll('.warmup-load .stp button')[1])
    click(button(host, 'Save'))
    expect(saved.warmupRows[0]).toMatchObject({ wf: 82.5, r: 12 })
    expect(saved.warmupRows[0].wp).toBeGreaterThan(0)
  })

  it('a fixed weight over a lighter work weight is not cut by touching its field', () => {
    let saved = null
    useStore.setState(s => ({ S: { ...s.S, unit: 'kg' } }))
    exConfigSheet(ex, { id: ex.id, sets: 2, reps: 12, weight: 75, mode: 'reps', warmup: 'own', warmupRows: [{ wf: 80, r: 12 }] }, cfg => { saved = cfg })
    const host = render(useUI.getState().sheets.at(-1))
    const input = host.querySelector('.warmup-load .num')
    act(() => { input.dispatchEvent(new FocusEvent('focusin', { bubbles: true })); input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })
    click(button(host, 'Save'))
    expect(saved.warmupRows[0]).toMatchObject({ wf: 80, r: 12 })
  })

  it('a new row after a fixed one is fixed too, a step of 10 heavier but short of the work weight', () => {
    const host = open([{ wf: 80, r: 12 }])
    click(button(host, 'Add a warm-up'))
    let rows = [...host.querySelectorAll('.warmup-row')]
    expect(rows[1].querySelector('.warmup-load .btn').textContent).toBe('kg')
    expect(rows[1].querySelector('.warmup-load .num').value).toBe('90')
    const near = open([{ wf: 110, r: 5 }])
    click(button(near, 'Add a warm-up'))
    rows = [...near.querySelectorAll('.warmup-row')]
    expect(rows[1].querySelector('.warmup-load .num').value).toBe('115')
    expect(near.textContent).toContain('With 117.5 kg today: 110 × 5 · 115 × 3')
  })

  it('stepping a fixed row down to the bar makes it the bar', () => {
    const bench = EXDB.find(e => e.id === '0025')
    useStore.setState(s => ({ S: { ...s.S, unit: 'kg' } }))
    exConfigSheet(bench, { id: bench.id, sets: 3, reps: 5, weight: 60, mode: 'reps', warmup: 'own', warmupRows: [{ wf: 22.5, r: 10 }] }, () => {})
    const host = render(useUI.getState().sheets.at(-1))
    click(host.querySelector('.warmup-load .stp button'))
    const row = host.querySelector('.warmup-row')
    expect(row.textContent).toContain('Bar')
    expect(row.querySelector('.warmup-load .btn')).toBeNull()
  })

  it('the bare bar has no unit to switch', () => {
    const bench = EXDB.find(e => e.id === '0025')
    useStore.setState(s => ({ S: { ...s.S, unit: 'kg' } }))
    exConfigSheet(bench, { id: bench.id, sets: 3, reps: 5, weight: 60, mode: 'reps', warmup: 'own', warmupRows: [{ wb: true, r: 10 }, { wf: 40, r: 5 }] }, () => {})
    const host = render(useUI.getState().sheets.at(-1))
    const rows = [...host.querySelectorAll('.warmup-row')]
    expect(rows[0].querySelector('.warmup-load .btn')).toBeNull()
    expect(rows[1].querySelector('.warmup-load .btn').textContent).toBe('kg')
  })
})
