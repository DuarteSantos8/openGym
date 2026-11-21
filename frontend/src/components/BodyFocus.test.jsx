// @vitest-environment happy-dom
// Today's body picker: the drawn body or your photo, tap areas, open the exercises for them.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore.js'
import { FOCUS_KEY } from '../lib/body-focus.js'
import BodyFocus, { __test } from './BodyFocus.jsx'

const mocks = vi.hoisted(() => ({ nav: vi.fn() }))
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.nav }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
beforeAll(() => import('../lib/body-paths.js'))

// A whole body standing front-on in a 600 × 1000 photo (lib/body-focus.test.js has the same one).
const lm = (x, y) => ({ x, y, visibility: 0.99 })
function standing() {
  const p = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.2 }))
  p[7] = lm(0.53, 0.1); p[8] = lm(0.47, 0.1)
  p[11] = lm(0.6, 0.22); p[12] = lm(0.4, 0.22); p[13] = lm(0.64, 0.38); p[14] = lm(0.36, 0.38)
  p[15] = lm(0.66, 0.52); p[16] = lm(0.34, 0.52); p[23] = lm(0.56, 0.52); p[24] = lm(0.44, 0.52)
  p[25] = lm(0.56, 0.72); p[26] = lm(0.44, 0.72); p[27] = lm(0.56, 0.92); p[28] = lm(0.44, 0.92)
  return p
}
const memStore = () => {
  const m = new Map()
  return { m, open: async () => true, get: async v => m.get(v) || null, put: async r => { m.set(r.view, r) }, remove: async v => { m.delete(v) } }
}

let host, root, store, realPrepare, realDetect
beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  mocks.nav.mockClear()
  localStorage.clear()
  store = memStore()
  __test.setStore(store)
  realPrepare = __test.prepare; realDetect = __test.detect
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:photo')
  globalThis.URL.revokeObjectURL = vi.fn()
  useStore.setState(s => ({ S: { ...s.S, modules: {}, body: 'male' } }))
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  __test.prepare = realPrepare; __test.detect = realDetect
})

const mount = async () => { await act(async () => root.render(<BodyFocus />)) }
const chip = name => [...host.querySelectorAll('.bf-chips .chip')].find(b => b.textContent === name)
const button = name => [...host.querySelectorAll('button')].find(b => b.textContent === name)
const tapChip = name => act(() => chip(name).click())

describe('BodyFocus', () => {
  it('shows the drawn body and one chip per area until a photo is added', async () => {
    await mount()
    expect(host.querySelector('.card-head-title').textContent).toBe('Tap where you want to get stronger')
    await vi.waitFor(() => expect(host.querySelectorAll('.bm-v')).toHaveLength(2))
    expect(host.querySelectorAll('.bf-chips .chip')).toHaveLength(13)
    expect(button('Add your photo')).toBeTruthy()
    expect(host.textContent).toContain('Your photo stays on this device.')
    expect(button('Show exercises')).toBeUndefined()
  })

  it('picks areas from the chips and the drawn map, remembers them, and opens their exercises', async () => {
    await mount()
    await tapChip('Shoulders')
    expect(chip('Shoulders').getAttribute('aria-pressed')).toBe('true')
    await vi.waitFor(() => expect(host.querySelector('.bm-m[aria-label="Calves"]')).toBeTruthy())
    await act(() => host.querySelector('.bm-m[aria-label="Calves"]').dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(chip('Calves').getAttribute('aria-pressed')).toBe('true')
    expect(JSON.parse(localStorage.getItem(FOCUS_KEY)).areas).toEqual(['shoulders', 'calves'])

    await act(() => button('Show exercises').click())
    expect(mocks.nav).toHaveBeenCalledWith('/muscles?m=front-delts,side-delts,rear-delts,calves,tibialis', { state: { from: '/' } })

    await act(() => button('Clear selection').click())
    expect(button('Show exercises')).toBeUndefined()
    expect(JSON.parse(localStorage.getItem(FOCUS_KEY)).areas).toEqual([])
  })

  it('opens with the areas picked last time on this device', async () => {
    localStorage.setItem(FOCUS_KEY, JSON.stringify({ areas: ['glutes'], view: 'front' }))
    await mount()
    expect(chip('Glutes').getAttribute('aria-pressed')).toBe('true')
    expect(button('Show exercises')).toBeTruthy()
  })

  it('is not there when the module is off', async () => {
    useStore.setState(s => ({ S: { ...s.S, modules: { bodyfocus: false } } }))
    await mount()
    expect(host.innerHTML).toBe('')
  })

  it('keeps an added photo on the device, draws its areas and takes taps on it', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    __test.prepare = vi.fn(async () => ({ canvas: 'c', w: 600, h: 1000, data: new Uint8Array([1]).buffer, mime: 'image/jpeg' }))
    __test.detect = vi.fn(async () => standing())
    await mount()
    const input = host.querySelector('input[type=file]')
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'me.jpg', { type: 'image/jpeg' })], configurable: true })
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })) })
    await vi.waitFor(() => expect(host.querySelector('.bf-photo img')).toBeTruthy())
    expect(store.m.get('front')).toMatchObject({ view: 'front', w: 600, h: 1000 })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(button('Front view')).toBeTruthy()
    expect(host.querySelectorAll('.bf-photo svg .bf-a, .bf-photo svg .bf-cap').length).toBeGreaterThan(8)

    const svg = host.querySelector('.bf-photo svg')
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 500 })
    await act(() => svg.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0.5 * 300, clientY: 0.45 * 500 })))
    expect(chip('Core').getAttribute('aria-pressed')).toBe('true')
    expect(host.querySelectorAll('.bf-photo .on').length).toBeGreaterThan(0)

    await act(async () => button('Remove photo').click())
    expect(store.m.has('front')).toBe(false)
    expect(host.querySelector('.bf-photo')).toBe(null)
    fetchSpy.mockRestore()
  })

  it('says so when the photo has no whole body in it, and keeps the drawn body', async () => {
    __test.prepare = vi.fn(async () => ({ canvas: 'c', w: 600, h: 1000, data: new Uint8Array([1]).buffer, mime: 'image/jpeg' }))
    __test.detect = vi.fn(async () => null)
    await mount()
    const input = host.querySelector('input[type=file]')
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'me.jpg')], configurable: true })
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })) })
    await vi.waitFor(() => expect(host.querySelector('[role=alert]')).toBeTruthy())
    expect(host.querySelector('[role=alert]').textContent).toContain('Couldn’t find your whole body')
    expect(store.m.size).toBe(0)
    expect(host.querySelector('.bf-photo')).toBe(null)
  })
})
