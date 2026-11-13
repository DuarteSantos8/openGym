// @vitest-environment happy-dom
// The QR codes on an exercise's detail page (lib/exercise-qr.js): scanned onto it, moved from
// another exercise or shared with it, printed fresh on a page about the exercise, and
// unassociated again — a code another exercise still has stays findable, the last one deletes it.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { exOr } from './lib/exercises.js'
import { DEF, useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'

const mocks = vi.hoisted(() => ({ scanOnce: vi.fn(), printHtmlInFrame: vi.fn() }))
vi.mock('./components/CameraScan.jsx', () => ({ default: () => null, scanOnce: (...a) => mocks.scanOnce(...a) }))
vi.mock('./lib/plan-share.js', async importOriginal => ({ ...(await importOriginal()), printHtmlInFrame: (...a) => mocks.printHtmlInFrame(...a) }))
vi.mock('./lib/qr.js', async importOriginal => ({ ...(await importOriginal()), renderQrToCanvas: vi.fn(async () => 25) }))

const { exerciseDetailSheet } = await import('./sheets.jsx')

const BENCH = exOr('0025'), SQUAT = exOr('0043')
const mounted = []
const S = () => useStore.getState().S
const setQr = exQr => useStore.setState(s => ({ S: { ...s.S, exQr } }))

function renderTop() {
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
  return host
}
const button = (host, text) => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)
const row = (host, text) => [...host.querySelectorAll('.item')].find(el => el.querySelector('.tt')?.textContent === text)
const qrRows = host => [...host.querySelectorAll('.item')].filter(el => el.querySelector('.lrow-i')).map(el => el.querySelector('.tt').textContent)
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)) })

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [], toastMsg: '' })
  useStore.setState({ S: structuredClone(DEF), user: null })
  document.body.innerHTML = ''
  mocks.scanOnce.mockReset()
  mocks.printHtmlInFrame.mockReset()
  HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,UVI='
  globalThis.fetch = vi.fn(() => Promise.reject(new Error('offline')))
})
afterEach(() => {
  act(() => { mounted.splice(0).forEach(root => root.unmount()) })
  delete navigator.standalone
  delete navigator.share
  delete navigator.canShare
})

describe('exercise detail: QR codes', () => {
  it('scans a code onto the exercise and lists it', async () => {
    exerciseDetailSheet(BENCH)
    const host = renderTop()
    expect(host.textContent).toContain('QR codes')
    mocks.scanOnce.mockResolvedValueOnce({ value: '  MACHINE-7 ', fmt: 'qrcode' })
    await act(async () => { button(host, 'Scan code').click() })
    await flush()
    expect(S().exQr).toEqual({ '0025': ['MACHINE-7'] })
    expect(useUI.getState().toastMsg).toBe('Code added')
    expect(qrRows(host)).toEqual(['MACHINE-7'])
  })

  it('takes a second and a third code, and says it can', async () => {
    exerciseDetailSheet(BENCH)
    const host = renderTop()
    for (const value of ['RACK-A', 'RACK-B']) {
      mocks.scanOnce.mockResolvedValueOnce({ value, fmt: 'qrcode' })
      await act(async () => { button(host, value === 'RACK-A' ? 'Scan code' : 'Add another code').click() })
      await flush()
    }
    expect(S().exQr).toEqual({ '0025': ['RACK-A', 'RACK-B'] })
    expect(qrRows(host)).toEqual(['RACK-A', 'RACK-B'])
    expect([...host.querySelectorAll('h4.sec')].map(h => h.textContent)).toContain('QR codes · 2')
    expect(button(host, 'Print another code')).toBeTruthy()
    expect(host.textContent).toContain('An exercise can have several codes')
    await act(async () => { button(host, 'Print another code').click() })
    await flush()
    expect(S().exQr['0025']).toHaveLength(3)
  })

  it('moves a code another exercise has, or shares it, as you choose', async () => {
    setQr({ '0043': ['TOWER'] })
    exerciseDetailSheet(BENCH)
    const host = renderTop()
    mocks.scanOnce.mockResolvedValueOnce({ value: 'TOWER', fmt: 'qrcode' })
    await act(async () => { button(host, 'Scan code').click() })
    await flush()
    const menu = renderTop()
    expect(menu.querySelector('h3').textContent).toBe('This code is already on Barbell Full Squat')
    act(() => row(menu, 'Move it to this exercise').click())
    expect(S().exQr).toEqual({ '0025': ['TOWER'] })

    act(() => setQr({ '0043': ['TOWER'] }))
    mocks.scanOnce.mockResolvedValueOnce({ value: 'TOWER', fmt: 'qrcode' })
    await act(async () => { button(host, 'Scan code').click() })
    await flush()
    { const top = renderTop(); act(() => row(top, 'Use it for both').click()) }
    expect(S().exQr).toEqual({ '0043': ['TOWER'], '0025': ['TOWER'] })
    expect(host.textContent).toContain('Also on Barbell Full Squat')
  })

  it('prints a fresh code on a page about the exercise, and the exercise has it at once', async () => {
    exerciseDetailSheet(BENCH)
    const host = renderTop()
    await act(async () => { button(host, 'Print new code').click() })
    await flush()
    const codes = S().exQr['0025']
    expect(codes).toHaveLength(1)
    expect(codes[0]).toMatch(/^opengym:ex:/)
    expect(mocks.printHtmlInFrame).toHaveBeenCalledTimes(1)
    const html = mocks.printHtmlInFrame.mock.calls[0][0]
    expect(html).toContain('<h1>Barbell Bench Press</h1>')
    expect(html).toContain('width: 30mm; height: 30mm')
    expect(html).toContain('src="data:image/png;base64,UVI="')
    // The dataset's still could not be read in: its address stands in.
    expect(html).toMatch(/class="pic"><img src="http/)
  })

  // On an iPhone's home screen window.print() does nothing: the sheet goes out as a PDF.
  describe('in the home-screen app on an iPhone', () => {
    const fakeCtx = () => new Proxy({ measureText: s => ({ width: s.length * 20 }) }, {
      get: (o, k) => (k in o ? o[k] : () => {}), set: () => true,
    })
    beforeEach(() => {
      Object.defineProperty(navigator, 'standalone', { value: true, configurable: true })
      HTMLCanvasElement.prototype.getContext = function () { return fakeCtx() }
      HTMLCanvasElement.prototype.toBlob = function (cb) { cb(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' })) }
    })

    it('shares the sheet as an A4 PDF instead of printing a page', async () => {
      const share = vi.fn(() => Promise.resolve())
      Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true })
      Object.defineProperty(navigator, 'share', { value: share, configurable: true })
      exerciseDetailSheet(BENCH)
      const host = renderTop()
      await act(async () => { button(host, 'Print new code').click() })
      await flush()
      expect(mocks.printHtmlInFrame).not.toHaveBeenCalled()
      const ready = renderTop()
      expect(ready.textContent).toContain('Your sheet is ready')
      await act(async () => { button(ready, 'Print or share').click() })
      expect(share).toHaveBeenCalledTimes(1)
      const { files: [file], title } = share.mock.calls[0][0]
      expect(title).toBe('Barbell Bench Press')
      expect(file.name).toBe('Barbell Bench Press – QR.pdf')
      expect(file.type).toBe('application/pdf')
      const head = new TextDecoder().decode(new Uint8Array(await file.arrayBuffer()).slice(0, 8))
      expect(head).toBe('%PDF-1.4')
      expect(S().exQr['0025']).toHaveLength(1)
    })

    it('saves the PDF where there is no share sheet', async () => {
      const made = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x')
      const clicked = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
      exerciseDetailSheet(BENCH)
      const host = renderTop()
      await act(async () => { button(host, 'Print new code').click() })
      await flush()
      const ready = renderTop()
      await act(async () => { button(ready, 'Print or share').click() })
      expect(made).toHaveBeenCalledTimes(1)
      expect(clicked).toHaveBeenCalledTimes(1)
      made.mockRestore(); clicked.mockRestore()
    })
  })

  it('unassociates a shared code from this exercise only: the other one keeps it', async () => {
    setQr({ '0025': ['TOWER', 'OWN'], '0043': ['TOWER'] })
    exerciseDetailSheet(BENCH)
    const host = renderTop()
    act(() => row(host, 'TOWER').click())
    { const top = renderTop(); act(() => row(top, 'Unassociate').click()) }
    const confirm = renderTop()
    expect(confirm.textContent).toContain('It stays on Barbell Full Squat and still finds it when scanned.')
    act(() => button(confirm, 'Unassociate').click())
    expect(S().exQr).toEqual({ '0025': ['OWN'], '0043': ['TOWER'] })
    expect(useUI.getState().toastMsg).toBe('Code unassociated')
  })

  it('deletes a code no other exercise has', async () => {
    setQr({ '0025': ['LONE'], '0043': ['OTHER'] })
    exerciseDetailSheet(BENCH)
    const host = renderTop()
    act(() => row(host, 'LONE').click())
    { const top = renderTop(); act(() => row(top, 'Unassociate').click()) }
    const confirm = renderTop()
    expect(confirm.textContent).toContain('the code is deleted')
    act(() => button(confirm, 'Unassociate').click())
    expect(S().exQr).toEqual({ '0043': ['OTHER'] })
    expect(useUI.getState().toastMsg).toBe('Code deleted')
    expect(qrRows(host)).toEqual([])
  })

  it('prints an existing code again', async () => {
    setQr({ '0043': ['RACK'] })
    exerciseDetailSheet(SQUAT)
    const host = renderTop()
    act(() => row(host, 'RACK').click())
    { const top = renderTop(); await act(async () => { row(top, 'Print again').click() }) }
    await flush()
    expect(mocks.printHtmlInFrame).toHaveBeenCalledTimes(1)
    expect(mocks.printHtmlInFrame.mock.calls[0][0]).toContain('<h1>Barbell Full Squat</h1>')
    expect(S().exQr).toEqual({ '0043': ['RACK'] })
  })
})
