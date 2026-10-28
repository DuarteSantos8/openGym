// @vitest-environment happy-dom
// A body scale's QR code: the sheet shows what the scale measured before anything is saved,
// Save keeps it on today's check-in (and the weight as today's weigh-in unless switched off),
// Cancel keeps nothing, and a code that is not a scale's says so.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { todayISO } from '../lib/format.js'
import { parseScaleQr } from '../lib/bodyscan.js'

const scanned = vi.hoisted(() => ({ value: null }))
vi.mock('../components/CameraScan.jsx', () => ({ default: () => null, scanOnce: async () => scanned.value }))
const { bodyScanImportSheet, scanBodyScale, BodyScanCard, BodyData } = await import('./BodyScan.jsx')

const SAMPLE_64 = '[78.4,60.5,17.9,22.8,33.1,44.6,81.0,1.2,1.1,1.2,0.0,0.1,1.6,1.7,1.6,1.4,1.3,2.0,2.1,3.4,3.3,27.4,8.6,8.5,0.9,1.0,10.6,2.4,2.3,39.0,7.0,3.6,26.9,15.8,12.4,1690.0,25.3,69.2,131.0,228.0,117.0,-9.8,-9.8,0.0,63.1,0.91,176.0,7.9,15.8,2.6,4.5,10.2,14.1,12.6,15.4,20.5,25.0,18.3,31.6,4.3,14.0,34.0,4.0,4.0]'
const values = parseScaleQr(SAMPLE_64)

const roots = []
function mount(el) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  roots.push(root)
  act(() => root.render(el))
  return host
}
const renderTop = () => {
  const sheet = useUI.getState().sheets.at(-1)
  return mount(sheet.render(() => useUI.getState().closeSheet(sheet.id)))
}
const button = (host, text) => [...host.querySelectorAll('button')].find(b => b.textContent === text)

describe('body scan import', () => {
  let original
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    original = useStore.getState().S
    useUI.setState({ sheets: [] })
    document.body.innerHTML = ''
    useStore.setState({ S: { ...original, unit: 'kg', bodyweight: [], measurements: [], customMeasurements: [] } })
  })
  afterEach(() => {
    act(() => { roots.splice(0).forEach(r => r.unmount()) })
    useStore.setState({ S: original })
  })

  it('shows the numbers and the segments, and Save keeps them with today’s weigh-in', () => {
    bodyScanImportSheet(values)
    const host = renderTop()
    expect(host.textContent).toContain('Skeletal muscle mass')
    expect(host.textContent).toContain('33.1')
    expect(host.querySelectorAll('.bodyscan-seg tbody tr')).toHaveLength(5)
    act(() => button(host, 'Save').click())
    const S = useStore.getState().S
    expect(S.measurements).toHaveLength(1)
    expect(S.measurements[0]).toMatchObject({ d: todayISO(), bodyFat: 22.8, scan: { len: 64 } })
    expect(S.bodyweight.map(b => [b.d, b.w])).toEqual([[todayISO(), 78.4]])
  })

  it('the weigh-in can be left out; Cancel keeps nothing', () => {
    bodyScanImportSheet(values)
    let host = renderTop()
    act(() => host.querySelector('[role=switch]').click())
    act(() => button(host, 'Save').click())
    expect(useStore.getState().S.bodyweight).toEqual([])
    expect(useStore.getState().S.measurements).toHaveLength(1)

    useStore.setState({ S: { ...useStore.getState().S, measurements: [] } })
    bodyScanImportSheet(values)
    host = renderTop()
    act(() => button(host, 'Cancel').click())
    expect(useStore.getState().S.measurements).toEqual([])
  })

  it('says what it replaces', () => {
    useStore.setState({ S: { ...useStore.getState().S, bodyweight: [{ d: todayISO(), w: 86, t: 1 }] } })
    bodyScanImportSheet(values)
    const host = renderTop()
    expect(host.textContent).toContain('Replaces today’s 86 kg')
  })

  it('a code that is not a scale’s is turned away', async () => {
    const toast = vi.spyOn(useUI.getState(), 'toast')
    scanned.value = { value: 'opengym:ex:abc' }
    await act(async () => { await scanBodyScale() })
    expect(useUI.getState().sheets).toHaveLength(0)
    expect(toast).toHaveBeenCalledWith('That isn’t a body scan code')
    scanned.value = { value: SAMPLE_64 }
    await act(async () => { await scanBodyScale() })
    expect(useUI.getState().sheets).toHaveLength(1)
  })

  it('a scale whose layout is not known yet: kept, and the card says why it shows no numbers', () => {
    const host = mount(<BodyScanCard entry={{ d: '2026-01-03', scan: { len: 95, v: Array(95).fill(1) } }} unit="kg" />)
    expect(host.textContent).toContain('95 values')
    expect(host.querySelector('.tile')).toBeNull()
  })
})

// Stats' Body data tab: the latest scan, what moved since the one before, and the segment
// analysis with a lean/fat toggle. Without a scan it says how to get one.
describe('Body data tab', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    document.body.innerHTML = ''
  })
  afterEach(() => { act(() => { roots.splice(0).forEach(r => r.unmount()) }) })

  const older = values.slice(); older[0] = 79.4; older[19] = 3.2; older[24] = 1.1
  const S = { unit: 'kg', measurements: [
    { d: '2025-12-01', t: 1, scan: { len: 64, v: older } },
    { d: '2026-01-03', t: 2, scan: { len: 64, v: values } },
  ] }
  const box = (host, seg) => host.querySelector('.bodyseg-' + seg)

  it('without a scan: what to do, and the scan button', () => {
    const host = mount(<BodyData S={{ unit: 'kg', measurements: [{ d: '2026-01-03', waist: 90 }] }} />)
    expect(host.textContent).toContain('Scan the QR code')
    expect(button(host, 'Scan body scan code')).toBeTruthy()
    expect(host.querySelector('.bodyseg')).toBeNull()
  })

  it('the latest scan, with how it moved since the one before', () => {
    const host = mount(<BodyData S={S} />)
    expect(host.textContent).toContain('Changes since')
    const weight = [...host.querySelectorAll('.tile')].find(el => el.querySelector('.l').textContent === 'Weight')
    expect(weight.querySelector('.v').textContent).toContain('78.4')
    expect(weight.querySelector('.bodyscan-delta').textContent).toBe('−1')
  })

  it('the segments around the figure, lean mass first, fat on the toggle', () => {
    const host = mount(<BodyData S={S} />)
    expect(['trunk', 'armR', 'armL', 'legR', 'legL'].every(seg => box(host, seg))).toBe(true)
    expect(box(host, 'armR').textContent).toContain('Right arm')
    expect(box(host, 'armR').querySelector('.bodyseg-v').textContent).toBe('3.4 kg')
    expect(box(host, 'armR').querySelector('.bodyscan-delta').textContent).toBe('+0.2')
    act(() => button(host, 'Fat').click())
    expect(box(host, 'trunk').querySelector('.bodyseg-v').textContent).toBe('10.6 kg')
    expect(box(host, 'armR').querySelector('.bodyscan-delta').textContent).toBe('−0.2')
  })

  it('a lone scan has nothing to compare with', () => {
    const host = mount(<BodyData S={{ unit: 'lb', measurements: [S.measurements[1]] }} />)
    expect(host.textContent).not.toContain('Changes since')
    expect(host.querySelector('.bodyscan-delta')).toBeNull()
    expect(box(host, 'trunk').querySelector('.bodyseg-v').textContent).toBe('60.4 lb')
  })
})
