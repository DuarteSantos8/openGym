// @vitest-environment happy-dom
// #1079: the live workout's Exercise settings keep what you changed however the sheet closes
// (swiped away, Back, the backdrop), not only with its button. Nothing changed, nothing saved.
// Other uses of the sheet (the routine editor, adding an exercise) keep needing the button.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { EXDB } from './lib/exercises.js'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { exConfigSheet } from './sheets.jsx'

const ex = EXDB.find(e => e.id === '0009')
const roots = []
function render(sheet) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  roots.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return { host, root }
}
const restRow = host => [...host.querySelectorAll('.lrow')].find(r => r.querySelector('.lrow-t')?.textContent === 'Rest for this exercise')
const pick = (menu, label) => act(() => [...menu.querySelectorAll('.menu-item')].find(b => b.textContent.includes(label)).click())
const button = (host, label) => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === label)
const cfg = { sets: 3, reps: 10, weight: 40, mode: 'reps', restSec: 75 }
// The sheet goes away the way a swipe takes it: closed in the store, then unmounted.
const swipeAway = ({ root }, sheet) => act(() => { useUI.getState().closeSheet(sheet.id); root.unmount() })

describe('exercise settings in a live workout', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [] })
    useStore.setState(s => ({ S: { ...s.S, unit: 'kg', restSec: 120 } }))
    document.body.innerHTML = ''
  })
  afterEach(() => { act(() => { roots.splice(0).forEach(r => { try { r.unmount() } catch (e) { /* gone */ } }) }) })

  it('saves a change when the sheet is swiped away, once', () => {
    const onSave = vi.fn()
    exConfigSheet(ex, cfg, onSave, null, null, null, null, undefined, { keepOnClose: true })
    const sheet = useUI.getState().sheets.at(-1)
    const view = render(sheet)
    expect(button(view.host, 'Done')).toBeTruthy()
    act(() => restRow(view.host).click())
    pick(render(useUI.getState().sheets.at(-1)).host, 'No timer')
    swipeAway(view, sheet)
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave.mock.calls[0][0]).toMatchObject({ restOff: true })
  })

  it('saves nothing when nothing changed', () => {
    const onSave = vi.fn()
    exConfigSheet(ex, cfg, onSave, null, null, null, null, undefined, { keepOnClose: true })
    const sheet = useUI.getState().sheets.at(-1)
    swipeAway(render(sheet), sheet)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('Done saves once, not again as the sheet goes', () => {
    const onSave = vi.fn()
    exConfigSheet(ex, cfg, onSave, null, null, null, null, undefined, { keepOnClose: true })
    const sheet = useUI.getState().sheets.at(-1)
    const view = render(sheet)
    act(() => restRow(view.host).click())
    pick(render(useUI.getState().sheets.at(-1)).host, 'No timer')
    act(() => button(view.host, 'Done').click())
    act(() => view.root.unmount())
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('elsewhere, closing without the button still leaves the slot as it was', () => {
    const onSave = vi.fn()
    exConfigSheet(ex, cfg, onSave)
    const sheet = useUI.getState().sheets.at(-1)
    const view = render(sheet)
    act(() => restRow(view.host).click())
    pick(render(useUI.getState().sheets.at(-1)).host, 'No timer')
    swipeAway(view, sheet)
    expect(onSave).not.toHaveBeenCalled()
  })
})
