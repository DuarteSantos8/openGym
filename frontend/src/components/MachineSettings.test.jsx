// @vitest-environment happy-dom
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { MachineSettingTags, machineSettingsSheet } from './MachineSettings.jsx'

const BENCH = '0025'
const mounted = []
let original

function render(node) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(node))
  return host
}
function openSheet() {
  act(() => machineSettingsSheet(BENCH))
  const sheet = useUI.getState().sheets.at(-1)
  return render(sheet.render(() => useUI.getState().closeSheet(sheet.id)))
}
const setValue = (el, v) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v)
  act(() => el.dispatchEvent(new Event('input', { bubbles: true })))
}
const buttonOf = (host, label) => [...host.querySelectorAll('button')].find(b => b.textContent === label)
const rowsOf = host => [...host.querySelectorAll('.mset-row')].map(r => [...r.querySelectorAll('input')].map(i => i.value))
const saved = () => useStore.getState().S.exNotes

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  original = useStore.getState().S
  useUI.setState({ sheets: [] })
  useStore.setState({ S: { ...original, exNotes: {} } })
})
afterEach(() => {
  act(() => { mounted.splice(0).forEach(r => r.unmount()) })
  document.body.innerHTML = ''
  useStore.setState({ S: original })
})

describe('the machine settings sheet', () => {
  it('starts with one empty row; a suggested name fills it, the next one adds a row, Save keeps them in order', () => {
    const host = openSheet()
    expect(rowsOf(host)).toEqual([['', '']])
    act(() => buttonOf(host, 'Seat').click())
    expect(rowsOf(host)).toEqual([['Seat', '']])
    // the name taken is no longer offered
    expect(buttonOf(host, 'Seat')).toBeUndefined()
    setValue(host.querySelectorAll('.mset-row input')[1], '5')
    act(() => buttonOf(host, 'Leg position').click())
    setValue(host.querySelectorAll('.mset-row input')[3], 'M')
    act(() => buttonOf(host, 'Save').click())
    expect(saved()).toEqual({ [BENCH]: 'Seat: 5 · Leg position: M' })
  })

  it('opens with what is saved; removing a row and saving keeps the rest, removing all leaves none', () => {
    useStore.setState({ S: { ...useStore.getState().S, exNotes: { [BENCH]: 'Seat: 5 · Pad: 2\nKeep the bar low' } } })
    let host = openSheet()
    expect(rowsOf(host)).toEqual([['Seat', '5'], ['Pad', '2']])
    act(() => host.querySelector('.mset-row button[aria-label="Remove"]').click())
    act(() => buttonOf(host, 'Save').click())
    // the note under the line stays
    expect(saved()).toEqual({ [BENCH]: 'Pad: 2\nKeep the bar low' })

    host = openSheet()
    act(() => host.querySelector('.mset-row button[aria-label="Remove"]').click())
    expect(rowsOf(host)).toEqual([['', '']])
    act(() => buttonOf(host, 'Save').click())
    expect(saved()).toEqual({ [BENCH]: 'Keep the bar low' })
  })

  it('offers the names used on other machines first', () => {
    useStore.setState({ S: { ...useStore.getState().S, exNotes: { '0043': 'Pin: 7' } } })
    const host = openSheet()
    expect([...host.querySelectorAll('.chips .chip')].map(b => b.textContent)[0]).toBe('Pin')
  })

  it('leaves a half-filled row out', () => {
    const host = openSheet()
    setValue(host.querySelectorAll('.mset-row input')[0], 'Seat')
    act(() => buttonOf(host, 'Save').click())
    expect(saved()).toEqual({})
  })
})

describe('the machine setting tags', () => {
  it('read "Name: value", and a tap edits them', () => {
    let edits = 0
    const host = render(<div><MachineSettingTags pairs={[{ k: 'Seat', v: '5' }, { k: 'Leg position', v: 'M' }]} onEdit={() => edits++} /></div>)
    const tags = [...host.querySelectorAll('.tag')]
    expect(tags.map(tg => tg.textContent)).toEqual(['Seat: 5', 'Leg position: M'])
    act(() => tags[1].click())
    expect(edits).toBe(1)
  })

  it('show nothing without settings', () => {
    const host = render(<div><MachineSettingTags pairs={[]} /></div>)
    expect(host.innerHTML).toBe('<div></div>')
  })
})
