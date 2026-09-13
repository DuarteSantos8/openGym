// @vitest-environment happy-dom
// The plate-loading editor (barWeightSheet) and the plate inventory sheet write S.loadKind,
// S.barWeights and S.plates the way lib/plates.js reads them.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore, DEF } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { barWeightSheet, plateInventorySheet } from './sheets.jsx'
import { EXIDX } from './lib/exercises.js'

const SQUAT = '0043'      // barbell
const COCOONS = '0260'    // body weight
const LEG_PRESS = EXIDX['0585'] ? '0585' : Object.values(EXIDX).find(e => e.eq === 'leverage machine').id

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
const segButton = (host, text) => [...host.querySelectorAll('.seg button')].find(b => b.textContent.trim() === text)
const button = (host, text) => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)
// A labelled Stepper is .stp-w > .stp-l (label) + .stp (Decrease, value input, Increase).
const stepperOf = (host, label) => [...host.querySelectorAll('.stp-w')].find(el => el.querySelector('.stp-l')?.textContent.trim() === label)
const valueOf = st => st.querySelector('input').value
const dec = st => st.querySelector('[aria-label="Decrease"]')
const inc = st => st.querySelector('[aria-label="Increase"]')

describe('plate loading editor', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [], toasts: [] })
    useStore.setState({ S: { ...JSON.parse(JSON.stringify(DEF)), unit: 'lb' }, user: null })
    document.body.innerHTML = ''
  })
  afterEach(() => { act(() => { mounted.splice(0).forEach(root => root.unmount()) }) })

  it('the exercises used here are what the test assumes', () => {
    expect(EXIDX[SQUAT].eq).toBe('barbell')
    expect(EXIDX[LEG_PRESS].eq).toBe('leverage machine')
    expect(EXIDX[COCOONS].eq).toBe('body weight')
  })

  it('the editor derives its default from the same config the workout rows use', () => {
    // A body-weight exercise a routine runs as a weighted lift (bodyweight: false): the rows
    // show no line, so the editor must show Off — and picking Single stack must stick.
    act(() => barWeightSheet(COCOONS, { id: COCOONS, bodyweight: false }))
    const host = mountTopSheet()
    expect(segButton(host, 'Off').classList.contains('on')).toBe(true)
    act(() => segButton(host, 'Single stack').click())
    expect(S().loadKind[COCOONS]).toBe('single')
    // Without a config the equipment decides: body weight → single stack by default.
    useStore.setState(s => ({ S: { ...s.S, loadKind: {} } }))
    act(() => barWeightSheet(COCOONS))
    const host2 = mountTopSheet()
    expect(segButton(host2, 'Single stack').classList.contains('on')).toBe(true)
  })

  it('a barbell defaults to per side and stores nothing until you pick something else', () => {
    act(() => barWeightSheet(SQUAT))
    const host = mountTopSheet()
    expect(host.querySelector('h3').textContent).toBe('Plate loading')
    expect(segButton(host, 'Per side').classList.contains('on')).toBe(true)
    expect(S().loadKind).toEqual({})
    act(() => segButton(host, 'Single stack').click())
    expect(S().loadKind[SQUAT]).toBe('single')
    act(() => segButton(host, 'Per side').click())
    expect(S().loadKind[SQUAT]).toBeUndefined()   // back to what the equipment implies → key dropped
    act(() => segButton(host, 'Off').click())
    expect(S().loadKind[SQUAT]).toBe('none')
    expect(host.textContent).toContain('No plate line under the sets.')
  })

  it('"No bar" is an explicit 0 in barWeights; off again deletes it', () => {
    act(() => barWeightSheet(SQUAT))
    const host = mountTopSheet()
    const sw = host.querySelector('.switch, [role="switch"], input[type="checkbox"]')
    expect(sw).toBeTruthy()
    act(() => sw.click())
    expect(S().barWeights[SQUAT]).toBe(0)
    expect(host.textContent).toContain('The whole weight is plates.')
    expect(host.textContent).not.toContain('Bar (lb)')   // the stepper is gone while there is no bar
    act(() => host.querySelector('.switch, [role="switch"], input[type="checkbox"]').click())
    expect(S().barWeights[SQUAT]).toBeUndefined()
  })

  it('the bar stepper writes the override; stepping to 0 falls back to the default', () => {
    act(() => barWeightSheet(SQUAT))
    const host = mountTopSheet()
    const st = stepperOf(host, 'Bar (lb)')
    expect(st).toBeTruthy()
    expect(valueOf(st)).toBe('45')
    act(() => inc(st).click())
    expect(S().barWeights[SQUAT]).toBe(47.5)
    for (let i = 0; i < 19; i++) act(() => dec(stepperOf(host, 'Bar (lb)')).click())
    expect(S().barWeights[SQUAT]).toBeUndefined()
    expect(valueOf(stepperOf(host, 'Bar (lb)'))).toBe('45')
    expect(host.textContent).toContain('Default for this bar type.')
  })

  it('a machine can be made a single stack with its own base weight', () => {
    act(() => barWeightSheet(LEG_PRESS))
    const host = mountTopSheet()
    expect(segButton(host, 'Off').classList.contains('on')).toBe(true)
    act(() => segButton(host, 'Single stack').click())
    expect(S().loadKind[LEG_PRESS]).toBe('single')
    const st = stepperOf(host, 'Base weight (lb)')
    expect(st).toBeTruthy()
    expect(host.textContent).not.toContain('No bar')
    expect(valueOf(st)).toBe('0')
    act(() => inc(st).click())
    expect(S().barWeights[LEG_PRESS]).toBe(2.5)
  })
})

describe('plate inventory sheet', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    useUI.setState({ sheets: [], toasts: [] })
    useStore.setState({ S: { ...JSON.parse(JSON.stringify(DEF)), unit: 'lb' }, user: null })
    document.body.innerHTML = ''
  })
  afterEach(() => { act(() => { mounted.splice(0).forEach(root => root.unmount()) }) })

  it('lists every lb size with the standard count; the first edit copies the set and changes one count', () => {
    act(() => plateInventorySheet())
    const host = mountTopSheet()
    expect(host.querySelector('h3').textContent).toBe('Plates')
    for (const w of ['45 lb', '35 lb', '25 lb', '15 lb', '10 lb', '5 lb', '2.5 lb', '1.25 lb']) expect(stepperOf(host, w), w).toBeTruthy()
    expect(valueOf(stepperOf(host, '45 lb'))).toBe('6')
    expect(valueOf(stepperOf(host, '15 lb'))).toBe('0')   // not in the standard set
    expect(stepperOf(host, '45 lb').textContent).toContain('pairs')
    expect(S().plates).toEqual({})
    for (let i = 0; i < 5; i++) act(() => dec(stepperOf(host, '45 lb')).click())
    expect(S().plates.lb[45]).toBe(1)
    expect(S().plates.lb[35]).toBe(6)     // the rest of the standard set came along
    expect(S().plates.lb[15]).toBeUndefined()
    act(() => inc(stepperOf(host, '15 lb')).click())
    expect(S().plates.lb[15]).toBe(1)
    expect(valueOf(stepperOf(host, '45 lb'))).toBe('1')
    expect(S().plates.kg).toBeUndefined()   // the other unit is untouched
    expect(host.textContent).toContain('Your own list for lb.')
  })

  it('"Back to the standard set" drops the unit\'s own list', () => {
    useStore.setState(s => ({ S: { ...s.S, plates: { lb: { 45: 1 }, kg: { 20: 2 } } } }))
    act(() => plateInventorySheet())
    const host = mountTopSheet()
    act(() => button(host, 'Back to the standard set').click())
    expect(S().plates).toEqual({ kg: { 20: 2 } })
    expect(button(host, 'Back to the standard set')).toBeUndefined()
  })
})
