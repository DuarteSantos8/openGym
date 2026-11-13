// @vitest-environment happy-dom
// The workout share sheet (1.4.5): templates, the element switches kept with the profile, and
// the photo picker that only ever offers the workout's own pictures.
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { DEF, useStore } from '../store/useStore.js'
import ShareWorkout, { hiddenOf, workoutPhotos, readSharePref } from './ShareWorkout.jsx'

const clone = v => JSON.parse(JSON.stringify(v))
let root, host
const hash = c => c.repeat(64)
const w = {
  id: 'w1', d: '2026-11-05', start: 0, end: 3600e3, name: 'Legs',
  entries: [{ id: 'c-squat', n: 'Squat', target: { mode: 'reps' }, sets: [{ w: 100, r: 5, done: true }] }],
  media: [
    { hash: hash('a'), kind: 'image', mime: 'image/jpeg', size: 1000, width: 10, height: 10, at: 1 },
    { hash: hash('b'), kind: 'video', mime: 'video/mp4', size: 2000, width: 10, height: 10, at: 2, poster: { hash: hash('c'), mime: 'image/webp', size: 100, width: 10, height: 10 } },
  ],
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  try { localStorage.clear() } catch (e) { /* none */ }
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  const S = clone(DEF)
  Object.assign(S, { unit: 'kg', workouts: [w], routines: [] })
  useStore.setState({ S, user: null })
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const render = () => { act(() => root.render(<ShareWorkout w={w} close={() => {}} />)); return host }
const button = (el, text) => [...el.querySelectorAll('button')].find(b => b.textContent.trim() === text)

describe('ShareWorkout', () => {
  it('offers the four templates and remembers the one picked', () => {
    const el = render()
    for (const name of ['Classic', 'Photo', 'Lifts', 'Sticker']) expect(button(el, name)).toBeTruthy()
    act(() => button(el, 'Sticker').click())
    expect(readSharePref().template).toBe('sticker')
    // A sticker has no size and no page: those controls go.
    expect(button(el, 'Story 9:16')).toBeFalsy()
  })

  it('keeps the element switches with the profile', () => {
    const el = render()
    act(() => button(el, 'Volume').click())
    expect(useStore.getState().S.shareHide).toEqual(['volume'])
    act(() => button(el, 'Volume').click())
    expect(useStore.getState().S.shareHide).toEqual([])
    expect(button(el, 'Heart rate')).toBeFalsy()   // nothing measured, nothing to switch
  })

  it('offers the workout photos and the gallery, nothing else', () => {
    const el = render()
    act(() => button(el, 'Photo').click())
    expect(el.querySelectorAll('.sharew-thumb')).toHaveLength(2)
    expect(button(el, 'Choose photo')).toBeTruthy()
    expect(button(el, 'Take photo')).toBeTruthy()
    expect(el.querySelector('input[capture="environment"]')).toBeTruthy()
  })
})

describe('helpers', () => {
  it('reads the old muscle map switch as a hidden element', () => {
    expect(hiddenOf({ shareMap: false })).toEqual(['map'])
    expect(hiddenOf({ shareHide: ['hr', 3] })).toEqual(['hr'])
  })
  it('takes a photo itself, or the poster of a video, and only from the workout record', () => {
    expect(workoutPhotos(w).map(p => p.key)).toEqual([hash('a'), hash('c')])
    expect(workoutPhotos({ entries: [{ id: '0001' }] })).toEqual([])
  })
})
