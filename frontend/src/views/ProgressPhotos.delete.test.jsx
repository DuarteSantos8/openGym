// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore, DEF } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { PhotoView, progressPhotosOf, AddPhotosSheet } from './ProgressPhotos.jsx'
import { todayISO } from '../lib/format.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

/* #558: a progress photo can be removed from the gallery's full-size view. It comes off the workout
   it belongs to and nothing else (the same photo on another workout stays), and Undo puts it back
   where it was. */
const ref = (n, extra = {}) => ({ kind: 'image', hash: String(n).padStart(64, '0'), mime: 'image/jpeg', size: 10, width: 4, height: 3, at: 1, ...extra })
const state = () => ({
  ...structuredClone(DEF),
  workouts: [
    { id: 'w1', d: '2026-10-01', start: 1, entries: [], media: [ref(1), ref(2), ref(3)] },
    { id: 'w2', d: '2026-10-05', start: 2, entries: [], media: [ref(2)] },
  ],
})

let host, root
beforeEach(() => {
  localStorage.clear()
  useStore.setState({ S: state(), user: null, ready: true })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); useUI.getState().closeAll?.() })

const button = label => [...host.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === label || b.textContent === label)
const media = id => useStore.getState().S.workouts.find(w => w.id === id).media

describe('removing a progress photo', () => {
  it('asks first, takes it off that workout only, and Undo puts it back in its place', () => {
    const p = progressPhotosOf(useStore.getState().S).find(x => x.w.id === 'w1' && x.m.hash === ref(2).hash)
    let closed = 0
    act(() => root.render(<PhotoView p={p} close={() => { closed++ }} />))
    act(() => button('Remove').click())          // the trash in the bar
    expect(host.textContent).toContain('Remove this photo or video?')
    act(() => [...host.querySelectorAll('.mviewer-ask button')].find(b => b.textContent === 'Remove').click())
    expect(closed).toBe(1)
    expect(media('w1').map(m => m.hash)).toEqual([ref(1).hash, ref(3).hash])
    expect(media('w2').map(m => m.hash)).toEqual([ref(2).hash])
    const ui = useUI.getState()
    expect(ui.toastMsg).toBe('Photo removed')
    expect(ui.toastAction?.label).toBe('Undo')
    act(() => ui.runToastAction())
    expect(media('w1')).toEqual([ref(1), ref(2), ref(3)])
  })

  it('Cancel leaves it as it was', () => {
    const before = structuredClone(useStore.getState().S.workouts)
    const p = progressPhotosOf(useStore.getState().S)[0]
    act(() => root.render(<PhotoView p={p} close={() => {}} />))
    act(() => button('Remove').click())
    act(() => button('Cancel').click())
    expect(useStore.getState().S.workouts).toEqual(before)
  })
})

describe('photos filed under a day (#557)', () => {
  it('show in the gallery with the workout photos, and come off with Undo the same way', () => {
    useStore.setState({ S: { ...state(), dayPhotos: { [ref(7).hash]: { d: '2026-10-03', m: ref(7), _ts: 1 } } } })
    const photos = progressPhotosOf(useStore.getState().S)
    expect(photos.map(p => p.d)).toEqual(['2026-10-05', '2026-10-03', '2026-10-01', '2026-10-01', '2026-10-01'])
    const p = photos.find(x => x.day)
    act(() => root.render(<PhotoView p={p} close={() => {}} />))
    act(() => button('Remove').click())
    act(() => [...host.querySelectorAll('.mviewer-ask button')].find(b => b.textContent === 'Remove').click())
    expect(useStore.getState().S.dayPhotos[ref(7).hash]).toEqual({ _ts: expect.any(Number) })
    act(() => useUI.getState().runToastAction())
    expect(useStore.getState().S.dayPhotos[ref(7).hash]).toMatchObject({ d: '2026-10-03', m: ref(7) })
    expect(useStore.getState().S.workouts.map(w => w.media.length)).toEqual([3, 1])
  })
})

describe('adding photos for a day', () => {
  const item = exif => ({ file: new Blob(['x']), exif })
  it('one photo: the day it was taken, changeable; several: their own days, the rest on the picked one', async () => {
    const save = vi.fn(async () => {})
    act(() => root.render(<AddPhotosSheet items={[item('2026-09-14')]} close={() => {}} save={save} />))
    expect(host.querySelector('h3').textContent).toBe('Add 1 photo')
    expect(host.querySelector('input[type=date]').value).toBe('2026-09-14')
    expect(host.querySelector('input[type=date]').max).toBe(todayISO())
    await act(async () => { button('Add').click() })
    expect(save).toHaveBeenCalledWith([item('2026-09-14')], '2026-09-14')

    act(() => root.render(null))
    act(() => root.render(<AddPhotosSheet items={[item('2026-09-14'), item(null), item(null)]} close={() => {}} save={save} />))
    expect(host.textContent).toContain('1 photo knows its day and goes there. The others go on the day below.')
    expect(host.querySelector('input[type=date]').value).toBe(todayISO())
    act(() => root.render(null))
    act(() => root.render(<AddPhotosSheet items={[item('2026-09-14'), item('2026-09-15')]} close={() => {}} save={save} />))
    expect(host.querySelector('input[type=date]')).toBeNull()
    expect(host.textContent).toContain('Each photo goes on the day it was taken.')
  })
})

