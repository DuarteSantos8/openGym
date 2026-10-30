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

describe('changing the date of a photo already added (#940)', () => {
  const field = () => host.querySelector('input[type=date]')
  const setDate = value => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    act(() => { set.call(field(), value); field().dispatchEvent(new Event('input', { bubbles: true })) })
  }
  const saveBtn = () => [...host.querySelectorAll('.mviewer-ask button')].find(b => b.textContent === 'Save')

  it('the date in the bar opens a day field with the photo\'s day, and Save moves it', () => {
    const p = progressPhotosOf(useStore.getState().S).find(x => x.w.id === 'w1' && x.m.hash === ref(3).hash)
    let closed = 0
    act(() => root.render(<PhotoView p={p} close={() => { closed++ }} />))
    expect(field()).toBeNull()
    act(() => button('Date').click())
    expect(field().value).toBe('2026-10-01')
    expect(field().max).toBe(todayISO())
    setDate('2026-10-03')
    act(() => saveBtn().click())
    expect(closed).toBe(1)
    expect(media('w1').map(m => m.hash)).toEqual([ref(1).hash, ref(2).hash])
    expect(useStore.getState().S.dayPhotos[ref(3).hash]).toMatchObject({ d: '2026-10-03', m: ref(3) })
    expect(progressPhotosOf(useStore.getState().S).find(x => x.m.hash === ref(3).hash).d).toBe('2026-10-03')
  })

  it('onto the new day\'s workout when it has one', () => {
    const p = progressPhotosOf(useStore.getState().S).find(x => x.w.id === 'w1' && x.m.hash === ref(3).hash)
    act(() => root.render(<PhotoView p={p} close={() => {}} />))
    act(() => button('Date').click())
    setDate('2026-10-05')
    act(() => saveBtn().click())
    expect(media('w1').map(m => m.hash)).toEqual([ref(1).hash, ref(2).hash])
    expect(media('w2').map(m => m.hash)).toEqual([ref(2).hash, ref(3).hash])
  })

  it('a photo filed under a day takes the new day', () => {
    useStore.setState({ S: { ...state(), dayPhotos: { [ref(7).hash]: { d: '2026-10-03', m: ref(7), _ts: 1 } } } })
    const p = progressPhotosOf(useStore.getState().S).find(x => x.day)
    act(() => root.render(<PhotoView p={p} close={() => {}} />))
    act(() => button('Date').click())
    expect(field().value).toBe('2026-10-03')
    setDate('2026-09-20')
    act(() => saveBtn().click())
    expect(useStore.getState().S.dayPhotos[ref(7).hash]).toMatchObject({ d: '2026-09-20', m: ref(7) })
  })

  it('does not save the same day, an empty one or one in the future; Cancel closes the field', () => {
    const p = progressPhotosOf(useStore.getState().S).find(x => x.w.id === 'w1' && x.m.hash === ref(3).hash)
    let closed = 0
    act(() => root.render(<PhotoView p={p} close={() => { closed++ }} />))
    act(() => button('Date').click())
    act(() => saveBtn().click())                                   // unchanged: the field just closes
    expect(field()).toBeNull()
    expect(closed).toBe(0)
    act(() => button('Date').click())
    setDate('')
    expect(saveBtn().disabled).toBe(true)
    setDate('2999-01-01')
    expect(saveBtn().disabled).toBe(true)
    act(() => [...host.querySelectorAll('.mviewer-ask button')].find(b => b.textContent === 'Cancel').click())
    expect(field()).toBeNull()
    expect(media('w1').map(m => m.hash)).toEqual([ref(1).hash, ref(2).hash, ref(3).hash])
  })

  it('shares the bar with Remove: opening one closes the other', () => {
    const p = progressPhotosOf(useStore.getState().S)[0]
    act(() => root.render(<PhotoView p={p} close={() => {}} />))
    act(() => button('Date').click())
    expect(field()).not.toBeNull()
    act(() => button('Remove').click())
    expect(field()).toBeNull()
    expect(host.querySelector('.mviewer-ask-t').textContent).toBe('Remove this photo or video?')
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
  const item = (date, source = date ? 'exif' : undefined) => ({ file: new Blob(['x']), ...(date ? { date, source } : {}) })
  const field = () => host.querySelector('input[type=date]')
  const setDate = value => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    act(() => { set.call(field(), value); field().dispatchEvent(new Event('input', { bubbles: true })) })
  }

  it('one photo: the day it was taken, changeable, with no stepper', async () => {
    const save = vi.fn(async () => {})
    const one = item('2026-09-14')
    act(() => root.render(<AddPhotosSheet items={[one]} close={() => {}} save={save} />))
    expect(host.querySelector('h3').textContent).toBe('Add 1 photo')
    expect(field().value).toBe('2026-09-14')
    expect(field().max).toBe(todayISO())
    expect(host.querySelector('.pp-step')).toBeNull()
    expect(host.querySelector('.pp-add-preview')).not.toBeNull()
    expect(host.textContent).toContain('Date read from the photo.')
    await act(async () => { button('Add').click() })
    expect(save).toHaveBeenCalledWith([one], ['2026-09-14'])
  })

  it('several photos: one at a time, "2 of 3", each with its own day', async () => {
    const save = vi.fn(async () => {})
    const items = [item('2026-09-14'), item(null), item('2026-09-16', 'name')]
    act(() => root.render(<AddPhotosSheet items={items} close={() => {}} save={save} />))
    expect(host.querySelector('h3').textContent).toBe('Add 3 photos')
    expect(host.querySelector('.pp-step-n').textContent).toBe('1 of 3')
    expect(field().value).toBe('2026-09-14')
    expect(button('Previous').disabled).toBe(true)
    act(() => button('Next').click())
    expect(host.querySelector('.pp-step-n').textContent).toBe('2 of 3')
    expect(field().value).toBe(todayISO())                       // nothing said a day: today, and it asks
    expect(host.textContent).toContain('Which day is this photo from?')
    setDate('2026-09-15')
    act(() => button('Next').click())
    expect(host.querySelector('.pp-step-n').textContent).toBe('3 of 3')
    expect(field().value).toBe('2026-09-16')
    expect(button('Next').disabled).toBe(true)
    act(() => button('Previous').click())
    expect(field().value).toBe('2026-09-15')                       // what was typed is kept
    await act(async () => { button('Add').click() })
    expect(save).toHaveBeenCalledWith(items, ['2026-09-14', '2026-09-15', '2026-09-16'])
  })

  it('puts the line about the day on top and the "1 of 3" stepper under the preview', () => {
    act(() => root.render(<AddPhotosSheet items={[item('2026-09-14'), item(null), item(null)]} close={() => {}} save={async () => {}} />))
    const kids = [...host.children].map(el => el.className)
    const at = cls => kids.findIndex(c => String(c).includes(cls))
    expect(at('pp-add-hint')).toBeGreaterThan(-1)
    expect(at('pp-add-hint')).toBeLessThan(at('pp-add-preview'))
    expect(at('pp-add-preview')).toBeLessThan(at('pp-step'))
    expect(at('pp-step')).toBeLessThan(at('measure-date'))
  })

  it('says when the day is only a guess from the file date', () => {
    act(() => root.render(<AddPhotosSheet items={[item('2026-09-14', 'modified')]} close={() => {}} save={async () => {}} />))
    expect(host.textContent).toContain('Guessed from the file date.')
    expect(host.textContent).not.toContain('Date read from the photo.')
  })

  it('does not add until every photo has a day, and jumps to the one that has none', async () => {
    const save = vi.fn(async () => {})
    act(() => root.render(<AddPhotosSheet items={[item('2026-09-14'), item('2026-09-15')]} close={() => {}} save={save} />))
    act(() => button('Next').click())
    setDate('')                                                    // a half-typed date reads as empty
    act(() => button('Previous').click())
    await act(async () => { button('Add').click() })
    expect(save).not.toHaveBeenCalled()
    expect(host.querySelector('.pp-step-n').textContent).toBe('2 of 2')
    setDate('2026-09-17')
    await act(async () => { button('Add').click() })
    expect(save).toHaveBeenCalledWith(expect.any(Array), ['2026-09-14', '2026-09-17'])
  })

  it('refuses a day in the future', async () => {
    const save = vi.fn(async () => {})
    act(() => root.render(<AddPhotosSheet items={[item(null)]} close={() => {}} save={save} />))
    setDate('2999-01-01')
    await act(async () => { button('Add').click() })
    expect(save).not.toHaveBeenCalled()
  })
})
