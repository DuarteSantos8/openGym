// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { progressPhotosOf, groupByDate, daysBetween, todaysWorkout } from './ProgressPhotos.jsx'
import { todayISO } from '../lib/format.js'

// normalizeMediaRef (lib/media-refs.js) only accepts a 64-hex-char hash — workoutMediaOf drops
// anything else, so the fixtures need real ones. A short label maps to a stable fake hash.
let n = 0
const labels = {}
const hashOf = label => labels[label] || (labels[label] = (++n).toString(16).padStart(64, '0'))

const img = label => ({ kind: 'image', hash: hashOf(label), mime: 'image/jpeg', size: 1000, width: 10, height: 10 })
const gif = label => ({ kind: 'gif', hash: hashOf(label), mime: 'image/gif', size: 1000, width: 10, height: 10 })
const video = label => ({ kind: 'video', hash: hashOf(label), mime: 'video/mp4', size: 1000, width: 10, height: 10, dur: 5 })
const hashes = photos => photos.map(p => Object.keys(labels).find(l => labels[l] === p.m.hash))

describe('progressPhotosOf', () => {
  it('collects every still across every workout, newest first', () => {
    const S = {
      workouts: [
        { d: '2026-01-01', start: 100, media: [img('a')] },
        { d: '2026-02-01', start: 100, media: [img('b'), img('c')] },
      ],
    }
    const out = progressPhotosOf(S)
    expect(hashes(out)).toEqual(['b', 'c', 'a'])
    expect(out[0].d).toBe('2026-02-01')
  })

  it('leaves videos out — the comparator wants two stills, not two clips', () => {
    const S = { workouts: [{ d: '2026-01-01', start: 0, media: [img('still'), video('clip')] }] }
    expect(hashes(progressPhotosOf(S))).toEqual(['still'])
  })

  it('keeps a gif — it is a still image plus motion, not a clip', () => {
    const S = { workouts: [{ d: '2026-01-01', start: 0, media: [gif('animated')] }] }
    expect(hashes(progressPhotosOf(S))).toEqual(['animated'])
  })

  it('breaks a same-day tie by the later workout, most recent first', () => {
    const S = {
      workouts: [
        { d: '2026-01-01', start: 100, media: [img('morning')] },
        { d: '2026-01-01', start: 200, media: [img('evening')] },
      ],
    }
    expect(hashes(progressPhotosOf(S))).toEqual(['evening', 'morning'])
  })

  it('is empty for no workouts, and for workouts with no media', () => {
    expect(progressPhotosOf({ workouts: [] })).toEqual([])
    expect(progressPhotosOf({ workouts: [{ d: '2026-01-01', start: 0 }] })).toEqual([])
    expect(progressPhotosOf(null)).toEqual([])
  })
})

describe('groupByDate', () => {
  it('runs consecutive same-date entries into one group, in the order given', () => {
    const photos = [
      { d: '2026-02-01', m: { hash: hashOf('b') } }, { d: '2026-02-01', m: { hash: hashOf('c') } },
      { d: '2026-01-01', m: { hash: hashOf('a') } },
    ]
    expect(groupByDate(photos)).toEqual([
      { d: '2026-02-01', items: [photos[0], photos[1]] },
      { d: '2026-01-01', items: [photos[2]] },
    ])
  })

  it('is empty for an empty list', () => {
    expect(groupByDate([])).toEqual([])
  })
})

describe('todaysWorkout', () => {
  it('is null with no workout logged today', () => {
    expect(todaysWorkout({ workouts: [{ d: '2020-01-01', start: 0 }] })).toBeNull()
    expect(todaysWorkout({ workouts: [] })).toBeNull()
  })

  it('finds today\'s workout among others', () => {
    const w = { id: 'today-one', d: todayISO(), start: 100 }
    expect(todaysWorkout({ workouts: [{ d: '2020-01-01', start: 0 }, w] })).toBe(w)
  })

  it('picks the latest of two logged today (e.g. a morning and an evening session)', () => {
    const early = { id: 'a', d: todayISO(), start: 100 }
    const late = { id: 'b', d: todayISO(), start: 200 }
    expect(todaysWorkout({ workouts: [early, late] })).toBe(late)
    expect(todaysWorkout({ workouts: [late, early] })).toBe(late)
  })
})

describe('daysBetween', () => {
  it('counts whole days regardless of which date comes first', () => {
    expect(daysBetween('2026-01-01', '2026-01-15')).toBe(14)
    expect(daysBetween('2026-01-15', '2026-01-01')).toBe(14)
  })

  it('is zero for the same day', () => {
    expect(daysBetween('2026-01-01', '2026-01-01')).toBe(0)
  })
})

describe('progressPhotosOf — one file on two workouts', () => {
  it('keeps them apart, so the grid and the comparison can tell them apart', () => {
    const m = img('shared')
    const S = { workouts: [{ id: 'w1', d: '2026-09-01', start: 1, media: [m] }, { id: 'w2', d: '2026-09-08', start: 2, media: [m] }] }
    const keys = progressPhotosOf(S).map(p => p.key)
    expect(keys).toHaveLength(2)
    expect(new Set(keys).size).toBe(2)
  })
})
