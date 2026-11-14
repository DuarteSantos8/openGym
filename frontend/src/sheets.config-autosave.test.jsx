// @vitest-environment happy-dom
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { EXDB } from './lib/exercises.js'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { exConfigSheet } from './sheets.jsx'
import { withExUnit } from './lib/ex-unit.js'
import { bindUI } from './components/ui.jsx'

// #1079: the live workout's Exercise settings keep their changes however the sheet closes (a tap
// outside, a swipe down, back), and only when something really changed. The other sheets discard.
const ex = EXDB.find(e => e.id === '0009')
const config = { sets: 3, reps: 10, weight: 40, mode: 'reps', prog: 'linear', inc: 2.5 }
let root, host

// Closing unmounts the sheet, as Modals does; unmounting by hand is closing it any other way.
function open(onSave, { label, opts = { autosave: true }, cfg = config } = {}) {
  exConfigSheet(ex, cfg, onSave, null, null, null, null, label, opts)
  const sheet = useUI.getState().sheets.at(-1)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  const close = () => { useUI.getState().closeSheet(sheet.id); root.unmount() }
  act(() => root.render(sheet.render(close)))
}
function type(el, value) {
  Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}
const note = text => act(() => type(host.querySelector('textarea'), text))
const step = value => act(() => type([...host.querySelectorAll('.stp-w')].find(w => w.querySelector('.stp-l')?.textContent === 'Step (kg)').querySelector('input.num'), value))
const button = label => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === label)
const swipeAway = () => act(() => root.unmount())

describe('exercise settings in a live workout keep their changes on close (#1079)', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    bindUI(useUI)
    useUI.setState({ sheets: [] })
    useStore.setState(s => ({ S: { ...s.S, unit: 'kg', restSec: 120, exUnit: {} } }))
  })
  afterEach(() => { host?.remove() })

  it('saves a change when the sheet closes without its button', () => {
    const onSave = vi.fn()
    open(onSave)
    note('seat on 4')
    swipeAway()
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave.mock.calls[0][0]).toMatchObject({ note: 'seat on 4', sets: 3, reps: 10, weight: 40 })
  })

  it('reads Done, and Done saves once, exactly what Save saves', () => {
    const onSave = vi.fn()
    open(onSave)
    expect(button('Save')).toBeUndefined()
    note('seat on 4')
    act(() => button('Done').click())
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(useUI.getState().sheets).toHaveLength(0)
    const viaSave = vi.fn()
    open(viaSave, { opts: {} })
    note('seat on 4')
    act(() => button('Save').click())
    expect(onSave.mock.calls[0][0]).toEqual(viaSave.mock.calls[0][0])
  })

  it('saves nothing when nothing changed, by Done or by closing', () => {
    const onSave = vi.fn()
    open(onSave)
    act(() => button('Done').click())
    open(onSave)
    swipeAway()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('saves nothing when a change was undone before closing', () => {
    const onSave = vi.fn()
    open(onSave)
    note('seat on 4')
    note('')
    swipeAway()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('disables Done on a refused value, and closing then drops the changes', () => {
    const onSave = vi.fn()
    open(onSave)
    note('seat on 4')
    step('0')
    expect(button('Done').disabled).toBe(true)
    swipeAway()
    expect(onSave).not.toHaveBeenCalled()
  })

  // A sync (or another sheet) pins the exercise to lb while this one is open.
  const pinLb = () => act(() => useStore.setState(s => ({ S: { ...s.S, exUnit: withExUnit(s.S.exUnit, ex.id, 'lb') } })))

  it('saves nothing when only the exercise unit changed elsewhere while it was open', () => {
    const onSave = vi.fn()
    open(onSave)
    pinLb()
    swipeAway()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('still saves an edit made after such a unit change', () => {
    const onSave = vi.fn()
    open(onSave)
    pinLb()
    note('seat on 4')
    swipeAway()
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave.mock.calls[0][0]).toMatchObject({ note: 'seat on 4' })
  })

  // The Weight unit row opens a picker sheet of its own; pick `label` in it.
  const pickUnit = label => {
    act(() => [...host.querySelectorAll('.lrow')].find(r => r.querySelector('.lrow-t')?.textContent === 'Weight unit').click())
    const sheet = useUI.getState().sheets.at(-1)
    const pickerHost = document.body.appendChild(document.createElement('div'))
    const picker = createRoot(pickerHost)
    act(() => picker.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
    act(() => [...pickerHost.querySelectorAll('button, .lrow')].find(b => b.textContent.trim() === label).click())
    act(() => picker.unmount())
    pickerHost.remove()
  }

  it('saves nothing when only the unit was switched in the sheet', () => {
    const onSave = vi.fn()
    open(onSave)
    pickUnit('lb')
    expect(useStore.getState().S.exUnit[ex.id].unit).toBe('lb')
    swipeAway()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('saves nothing after a unit switch on a pyramid with a weight per set', () => {
    const onSave = vi.fn()
    open(onSave, { cfg: { ...config, pyramid: [10, 8, 6], pyramidWeight: [40, 45, 50] } })
    pickUnit('lb')
    swipeAway()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('still saves an edit made before or after a unit switch in the sheet', () => {
    const onSave = vi.fn()
    open(onSave)
    note('seat on 4')
    pickUnit('lb')
    swipeAway()
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave.mock.calls[0][0]).toMatchObject({ note: 'seat on 4', weight: 40 })
  })

  it('adding an exercise keeps its own button and discards on close', () => {
    const onSave = vi.fn()
    open(onSave, { label: 'Add to this workout', opts: { freestyle: 'add' } })
    expect(button('Add to this workout')).toBeTruthy()
    expect(button('Done')).toBeUndefined()
    note('seat on 4')
    swipeAway()
    expect(onSave).not.toHaveBeenCalled()
  })
})
