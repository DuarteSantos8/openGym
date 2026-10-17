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

const SAMPLE_64 = '[87.0,64.3,22.7,26.1,36.2,46.9,76.5,1.4,1.3,1.3,0.0,0.1,1.8,1.8,1.8,1.5,1.5,2.2,2.4,3.9,4.0,29.6,9.2,9.0,1.1,1.1,13.5,2.9,2.8,43.0,8.0,4.1,29.7,17.2,13.3,1758.0,30.1,73.8,138.4,240.0,121.0,-13.2,-13.2,0.0,67.4,0.95,170.0,8.7,17.4,2.8,4.9,11.0,15.2,13.6,16.6,22.2,27.1,19.8,34.1,4.7,15.2,40.0,4.0,4.0]'
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
    expect(host.textContent).toContain('36.2')
    expect(host.querySelectorAll('.bodyscan-seg tbody tr')).toHaveLength(5)
    act(() => button(host, 'Save').click())
    const S = useStore.getState().S
    expect(S.measurements).toHaveLength(1)
    expect(S.measurements[0]).toMatchObject({ d: todayISO(), bodyFat: 26.1, scan: { len: 64 } })
    expect(S.bodyweight.map(b => [b.d, b.w])).toEqual([[todayISO(), 87]])
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

  const older = values.slice(); older[0] = 88.0; older[19] = 3.7; older[24] = 1.3
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
    expect(weight.querySelector('.v').textContent).toContain('87')
    expect(weight.querySelector('.bodyscan-delta').textContent).toBe('−1')
  })

  it('the segments around the figure, lean mass first, fat on the toggle', () => {
    const host = mount(<BodyData S={S} />)
    expect(['trunk', 'armR', 'armL', 'legR', 'legL'].every(seg => box(host, seg))).toBe(true)
    expect(box(host, 'armR').textContent).toContain('Right arm')
    expect(box(host, 'armR').querySelector('.bodyseg-v').textContent).toBe('3.9 kg')
    expect(box(host, 'armR').querySelector('.bodyscan-delta').textContent).toBe('+0.2')
    act(() => button(host, 'Fat').click())
    expect(box(host, 'trunk').querySelector('.bodyseg-v').textContent).toBe('13.5 kg')
    expect(box(host, 'armR').querySelector('.bodyscan-delta').textContent).toBe('−0.2')
  })

  it('a lone scan has nothing to compare with', () => {
    const host = mount(<BodyData S={{ unit: 'lb', measurements: [S.measurements[1]] }} />)
    expect(host.textContent).not.toContain('Changes since')
    expect(host.querySelector('.bodyscan-delta')).toBeNull()
    expect(box(host, 'trunk').querySelector('.bodyseg-v').textContent).toBe('65.3 lb')
  })
})
