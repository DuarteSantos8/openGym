// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore, DEF } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { todayISO } from '../lib/format.js'

const picked = { kind: 'image', hash: 'c'.repeat(64), mime: 'image/jpeg', size: 10, width: 3, height: 4, at: 1 }
vi.mock('../components/CustomMediaField.jsx', () => ({
  useMediaPicker: () => ({ pick: async () => picked, busy: false, canAdd: true, showAdd: true }),
}))
vi.mock('../components/PhotoCamera.jsx', () => ({
  default: ({ photos, onTaken, close }) => <button onClick={() => { onTaken(new File(['x'], 'progress.jpg')); close() }}>shoot {photos.length}</button>,
}))
import ProgressPhotos from './ProgressPhotos.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

/* The camera in the gallery (#951): a Take photo button next to Add photos opens it as a full-screen
   viewer with the photos to choose an overlay from, and what it takes is filed for today. */
const ref = n => ({ kind: 'image', hash: String(n).padStart(64, '0'), mime: 'image/jpeg', size: 10, width: 3, height: 4, at: 1 })
let host, root
const mount = S => {
  useStore.setState({ S, user: null, ready: true })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  act(() => root.render(<MemoryRouter><ProgressPhotos /></MemoryRouter>))
}
const button = label => [...host.querySelectorAll('button')].find(b => b.textContent === label)
beforeEach(() => localStorage.clear())
afterEach(() => { act(() => root.unmount()); host.remove(); useUI.getState().closeAll?.() })

describe('Take photo', () => {
  it('sits next to Add photos', () => {
    mount({ ...structuredClone(DEF), workouts: [] })
    const row = button('Take photo').parentElement
    expect([...row.querySelectorAll('button')].map(b => b.textContent)).toEqual(['Add photos', 'Take photo'])
  })
  it('opens the camera as a full-screen viewer with the photos to pick an overlay from', async () => {
    mount({ ...structuredClone(DEF), workouts: [{ id: 'w1', d: '2026-10-01', start: 1, entries: [], media: [ref(1), ref(2)] }] })
    act(() => button('Take photo').click())
    const sheet = useUI.getState().sheets.at(-1)
    expect(sheet.kind).toBe('viewer')
    const view = document.createElement('div'); document.body.appendChild(view)
    const r = createRoot(view)
    act(() => r.render(sheet.render(() => {})))
    expect(view.textContent).toBe('shoot 2')
    act(() => r.unmount()); view.remove()
  })
  it('files what it takes for today', async () => {
    mount({ ...structuredClone(DEF), workouts: [] })
    act(() => button('Take photo').click())
    const view = document.createElement('div'); document.body.appendChild(view)
    const r = createRoot(view)
    act(() => r.render(useUI.getState().sheets.at(-1).render(() => {})))
    await act(async () => { view.querySelector('button').click() })
    const S = useStore.getState().S
    const filed = [...(S.workouts || []).flatMap(w => (w.media || []).map(m => ({ d: w.d, m }))), ...Object.values(S.dayPhotos || {}).filter(p => p.d).map(p => ({ d: p.d, m: p.m }))]
    expect(filed.map(p => p.d)).toEqual([todayISO()])
    expect(filed[0].m.hash).toBe(picked.hash)
    act(() => r.unmount()); view.remove()
  })
})
