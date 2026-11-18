// @vitest-environment happy-dom
// The equipment profile sheet shows body weight as a tick (#1159): on for a new profile and for
// one saved before the tick meant anything, off for one saved without it, and it saves the mark.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore, DEF } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { equipmentProfileSheet } from './sheets.jsx'
import { ACC_V, BW_V } from './lib/equipment.js'

const mounted = []
function mountTopSheet() {
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}
const S = () => useStore.getState().S
const chip = (host, text) => [...host.querySelectorAll('.chip')].find(c => c.textContent.trim() === text)
const on = host => chip(host, 'body weight').classList.contains('on')
const save = host => act(() => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === 'Save').click())
const withProfile = p => useStore.setState(s => ({ S: { ...s.S, equipProfiles: [p] } }))

describe('equipment profile sheet: body weight', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [], toasts: [] })
    useStore.setState({ S: JSON.parse(JSON.stringify(DEF)), user: null })
    document.body.innerHTML = ''
  })
  afterEach(() => { act(() => { mounted.splice(0).forEach(root => root.unmount()) }) })

  it('a new profile starts with body weight ticked and saves it with the mark', () => {
    act(() => equipmentProfileSheet())
    const host = mountTopSheet()
    expect(on(host)).toBe(true)
    const name = host.querySelector('input')
    act(() => { name.value = 'Gym' })
    save(host)
    const [p] = S().equipProfiles
    expect(p.equipment).toContain('body weight')
    expect(p.bwV).toBe(BW_V)
  })

  it('a profile saved before shows it ticked, even when its list lacks it', () => {
    withProfile({ id: 'g', name: 'Gym', equipment: ['dumbbell'], accV: ACC_V })
    act(() => equipmentProfileSheet(S().equipProfiles[0]))
    const host = mountTopSheet()
    expect(on(host)).toBe(true)
    save(host)
    expect(S().equipProfiles[0]).toMatchObject({ bwV: BW_V, equipment: expect.arrayContaining(['dumbbell', 'body weight']) })
  })

  it('a profile saved unticked shows it off, and ticking it saves it on', () => {
    withProfile({ id: 'g', name: 'Gym', equipment: ['dumbbell'], accV: ACC_V, bwV: BW_V })
    act(() => equipmentProfileSheet(S().equipProfiles[0]))
    const host = mountTopSheet()
    expect(on(host)).toBe(false)
    act(() => chip(host, 'body weight').click())
    save(host)
    expect(S().equipProfiles[0].equipment).toContain('body weight')
  })

  it('unticking it on a profile saved before saves it off, with the mark', () => {
    withProfile({ id: 'g', name: 'Gym', equipment: ['dumbbell', 'body weight'], accV: ACC_V })
    act(() => equipmentProfileSheet(S().equipProfiles[0]))
    const host = mountTopSheet()
    act(() => chip(host, 'body weight').click())
    save(host)
    expect(S().equipProfiles[0].equipment).not.toContain('body weight')
    expect(S().equipProfiles[0].bwV).toBe(BW_V)
  })
})
