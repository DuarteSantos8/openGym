// @vitest-environment happy-dom
// Scan a machine: a code read from a gym machine's QR or NFC tag goes to its exercise, or is
// linked to one. Own codes keep their own handlers; a gym card or a random tag is refused.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const m = vi.hoisted(() => ({ S: {}, toasts: [], sheets: [], pickers: [], own: [], stops: 0, onTag: null, scanned: null, nfc: { supported: true, enabled: true, mode: 'hold' } }))

vi.mock('../store/useStore.js', () => {
  const useStore = sel => sel({ S: m.S })
  useStore.getState = () => ({ S: m.S, update: fn => fn(m.S) })
  return { useStore }
})
vi.mock('../store/useUI.js', () => {
  const ui = { toast: msg => m.toasts.push(msg), openSheet: r => { m.sheets.push(r); return { close: () => {} } } }
  const useUI = sel => (sel ? sel(ui) : ui)
  useUI.getState = () => ui
  return { useUI }
})
vi.mock('../sheets.jsx', () => ({ exercisePicker: (onPick, o) => m.pickers.push({ onPick, ...o }), confirmSheet: () => {}, planImportSheet: () => {} }))
vi.mock('./RoutineShare.jsx', () => ({ openRoutinePayload: async p => { m.own.push(['routine', p]); return true } }))
vi.mock('./LibraryLink.jsx', () => ({ openLibraryLink: async l => { m.own.push(['library', l]) } }))
vi.mock('./Nfc.jsx', () => ({ handleTagLink: u => { m.own.push(['tag', u]); return true } }))
vi.mock('../lib/scan.js', () => ({ MODULE_MISSING: 'module-missing', webScanner: async () => false, scanCode: async () => m.scanned }))
vi.mock('../lib/routine-library.js', () => ({ indexUrl: () => null }))
vi.mock('../lib/nfc.js', () => ({
  nfcReadSupport: async () => m.nfc,
  readMachineTags: cb => { m.onTag = cb; return () => { m.stops++ } },
  readMachineTagOnce: async () => null,
}))

import { scanMachineSheet, linkMachineSheet } from './ScanMachine.jsx'

let host, root
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })
const mount = async el => { await act(async () => { root.render(el) }); await flush() }
const open = async () => { await mount(m.sheets[m.sheets.length - 1](() => { m.closed = true })) }
const click = async label => {
  const b = [...host.querySelectorAll('button')].find(x => x.textContent.includes(label))
  if (!b) throw new Error('no button ' + label + ' in ' + host.textContent)
  await act(async () => { b.click() }); await flush()
}
const QR = t => ({ uid: 'x', records: [{ type: 'text', value: t }] })

beforeEach(() => {
  Object.assign(m, { S: { machineCodes: { '0150': ['t:https://gym.example/m/leg-press'] }, gymCards: [{ id: 'g', value: 'CARD1' }] }, toasts: [], sheets: [], pickers: [], own: [], stops: 0, onTag: null, scanned: null, closed: false, nfc: { supported: true, enabled: true, mode: 'hold' } })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('scan a machine, route mode', () => {
  it('a linked QR opens its exercise', async () => {
    const got = []
    scanMachineSheet({ onExercise: id => got.push(id) })
    await open()
    expect(host.textContent).toContain('Scan a machine')
    expect(host.textContent).toContain('Hold your phone to the machine’s NFC tag, or scan its QR code.')
    m.scanned = { value: 'https://gym.example/m/leg-press' }
    await click('Scan QR code')
    expect(got).toEqual(['0150'])
  })

  it('a code on two exercises goes to the one open in the workout, with no chooser', async () => {
    m.S.machineCodes['0151'] = ['t:https://gym.example/m/leg-press']
    const live = { entries: [{ id: '0151', sets: [{ done: false }] }, { id: '0150', sets: [{ done: true }] }] }
    const got = []
    scanMachineSheet({ onExercise: id => got.push(id), live })
    await open()
    m.scanned = { value: 'https://gym.example/m/leg-press' }
    await click('Scan QR code')
    expect(got).toEqual(['0151'])
    expect(m.sheets).toHaveLength(1)
  })

  it('an unknown code offers the picker, started on a search from the code; picking links it', async () => {
    const got = []
    scanMachineSheet({ onExercise: id => got.push(id) })
    await open()
    m.scanned = { value: 'https://gym.example/product/hack-squat' }
    await click('Scan QR code')
    await open()
    expect(host.textContent).toContain('This code isn’t linked yet.')
    await click('Link to an exercise…')
    expect(m.pickers[0].query).toBe('hack squat')
    m.pickers[0].onPick('0160')
    expect(m.S.machineCodes['0160']).toEqual(['t:https://gym.example/product/hack-squat'])
    expect(got).toEqual(['0160'])
  })

  it('a gym membership code is refused and links nothing', async () => {
    scanMachineSheet({ onExercise: () => { throw new Error('no') } })
    await open()
    m.scanned = { value: 'CARD1' }
    await click('Scan QR code')
    expect(m.toasts).toEqual(['That’s your gym membership code. It can’t be linked to an exercise.'])
    expect(m.S.machineCodes['0150']).toHaveLength(1)
    expect(Object.keys(m.S.machineCodes)).toEqual(['0150'])
  })

  it('an openGym routine link keeps its own handler; a sticker link opens its exercise', async () => {
    const got = []
    scanMachineSheet({ onExercise: id => got.push(id) })
    await open()
    m.scanned = { value: 'https://opengym.ch/r#1.j.e30' }
    await click('Scan QR code')
    expect(m.own).toEqual([['routine', '1.j.e30']])
    m.scanned = { value: 'https://opengym.ch/nfc?ex=0025' }
    await click('Scan QR code')
    expect(got).toEqual(['0025'])
  })

  it('a held NFC tag is read, and the reader stops when the sheet closes', async () => {
    const got = []
    scanMachineSheet({ onExercise: id => got.push(id) })
    await open()
    expect(m.onTag).toBeTypeOf('function')
    await act(async () => { m.onTag(QR('https://gym.example/m/leg-press')) }); await flush()
    expect(got).toEqual(['0150'])
    act(() => root.unmount())
    expect(m.stops).toBe(1)
    root = createRoot(host)
  })

  it('a tag with a changing ID is refused', async () => {
    scanMachineSheet({ onExercise: () => {} })
    await open()
    await act(async () => { m.onTag({ uid: '08aabbcc', records: [] }) }); await flush()
    expect(m.toasts).toEqual(['This tag changes its ID every time, so it can’t be linked.'])
  })

  it('without NFC the camera opens at once', async () => {
    m.nfc = { supported: false, enabled: false, mode: null }
    m.scanned = { value: 'https://gym.example/m/leg-press' }
    const got = []
    scanMachineSheet({ onExercise: id => got.push(id) })
    await open()
    expect(host.textContent).not.toContain('Hold your phone')
    expect(got).toEqual(['0150'])
  })
})

describe('scan a machine, link mode', () => {
  it('a code already on another exercise asks, and Open both keeps both', async () => {
    linkMachineSheet({ id: '0151', name: 'Hack squat' })
    await open()
    m.scanned = { value: 'https://gym.example/m/leg-press' }
    await click('Scan QR code')
    await open()
    expect(host.textContent).toContain('This code also opens')
    await click('Open both')
    expect(m.S.machineCodes['0150']).toEqual(['t:https://gym.example/m/leg-press'])
    expect(m.S.machineCodes['0151']).toEqual(['t:https://gym.example/m/leg-press'])
    expect(m.toasts[0]).toMatch(/^Linked to /)
  })

  it('Only keeps the code on this exercise', async () => {
    linkMachineSheet({ id: '0151', name: 'Hack squat' })
    await open()
    m.scanned = { value: 'https://gym.example/m/leg-press' }
    await click('Scan QR code')
    await open()
    await click('Only ')
    expect(m.S.machineCodes['0150']).toBeUndefined()
    expect(m.S.machineCodes['0151']).toEqual(['t:https://gym.example/m/leg-press'])
  })

  it('a free code links straight away and offers another', async () => {
    linkMachineSheet({ id: '0151', name: 'Hack squat' })
    await open()
    m.scanned = { value: 'https://gym.example/m/new' }
    await click('Scan QR code')
    expect(m.S.machineCodes['0151']).toEqual(['t:https://gym.example/m/new'])
    await open()
    expect(host.textContent).toContain('Scan another code on this machine')
  })

  it('an openGym code is refused', async () => {
    linkMachineSheet({ id: '0151', name: 'Hack squat' })
    await open()
    m.scanned = { value: 'https://opengym.ch/r#1.j.e30' }
    await click('Scan QR code')
    expect(m.toasts).toEqual(['This is an openGym code. It already has a job.'])
    expect(m.own).toEqual([])
  })
})
