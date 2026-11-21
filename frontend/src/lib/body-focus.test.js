import { describe, expect, it } from 'vitest'
import { MUSCLES } from './muscles.js'
import {
  AREAS, AREA, VIEW_AREAS, areaOfMuscle, toggleArea, focusMuscles, exploreHref,
  loadFocus, saveFocus, FOCUS_KEY, poseProblem, areasFromPose, hitArea, toPhoto,
} from './body-focus.js'

// A person standing front-on in a 600 × 1000 photo, MediaPipe's normalised landmarks (only the
// ones the picker reads). Front view: the person's left side is on the right of the image.
const lm = (x, y, v = 0.99) => ({ x, y, visibility: v })
function standing() {
  const p = Array.from({ length: 33 }, () => lm(0.5, 0.5, 0.2))
  p[0] = lm(0.5, 0.1)
  p[7] = lm(0.53, 0.1); p[8] = lm(0.47, 0.1)
  p[11] = lm(0.6, 0.22); p[12] = lm(0.4, 0.22)
  p[13] = lm(0.64, 0.38); p[14] = lm(0.36, 0.38)
  p[15] = lm(0.66, 0.52); p[16] = lm(0.34, 0.52)
  p[23] = lm(0.56, 0.52); p[24] = lm(0.44, 0.52)
  p[25] = lm(0.56, 0.72); p[26] = lm(0.44, 0.72)
  p[27] = lm(0.56, 0.92); p[28] = lm(0.44, 0.92)
  return p
}
const W = 600, H = 1000

describe('body-focus areas', () => {
  it('cover every muscle the map draws exactly once', () => {
    const all = AREAS.flatMap(a => a.muscles)
    expect([...all].sort()).toEqual([...MUSCLES].sort())
    for (const m of MUSCLES) expect(areaOfMuscle(m)).toBe(AREAS.find(a => a.muscles.includes(m)).id)
    expect(areaOfMuscle('head')).toBe(null)
  })

  it('split into a front and a back view, shoulders, forearms and calves on both', () => {
    expect(VIEW_AREAS.front).toEqual(['shoulders', 'chest', 'biceps', 'forearms', 'core', 'quads', 'calves'])
    expect(VIEW_AREAS.back).toEqual(['traps', 'shoulders', 'upper-back', 'triceps', 'forearms', 'lower-back', 'glutes', 'hamstrings', 'calves'])
    for (const id of [...VIEW_AREAS.front, ...VIEW_AREAS.back]) expect(AREA[id]).toBeTruthy()
  })

  it('toggle on and off and stay in head-to-toe order, whatever order they were tapped in', () => {
    expect(toggleArea([], 'calves')).toEqual(['calves'])
    expect(toggleArea(['calves'], 'shoulders')).toEqual(['shoulders', 'calves'])
    expect(toggleArea(['shoulders', 'calves'], 'shoulders')).toEqual(['calves'])
    expect(toggleArea(['calves'], 'nope')).toEqual(['calves'])
  })

  it('turn into the explorer filter: the areas’ muscles, in the map’s order', () => {
    expect(focusMuscles(['core', 'shoulders'])).toEqual(['front-delts', 'side-delts', 'rear-delts', 'abs', 'obliques'])
    expect(focusMuscles(['nope'])).toEqual([])
    expect(exploreHref(['shoulders', 'core'])).toBe('/muscles?m=front-delts,side-delts,rear-delts,abs,obliques')
  })
})

describe('body-focus memory', () => {
  const mem = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m } }

  it('remembers the picked areas and the view on this device', () => {
    const s = mem()
    saveFocus(s, { areas: ['calves', 'shoulders'], view: 'back' })
    expect(JSON.parse(s.m.get(FOCUS_KEY))).toEqual({ areas: ['shoulders', 'calves'], view: 'back' })
    expect(loadFocus(s)).toEqual({ areas: ['shoulders', 'calves'], view: 'back' })
  })

  it('reads anything broken as a fresh start, and drops areas it does not know', () => {
    const s = mem()
    expect(loadFocus(s)).toEqual({ areas: [], view: 'front' })
    s.setItem(FOCUS_KEY, '{oops')
    expect(loadFocus(s)).toEqual({ areas: [], view: 'front' })
    s.setItem(FOCUS_KEY, JSON.stringify({ areas: ['glutes', 'wings', 3], view: 'side' }))
    expect(loadFocus(s)).toEqual({ areas: ['glutes'], view: 'front' })
    expect(loadFocus(null)).toEqual({ areas: [], view: 'front' })
    const throwing = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } }
    expect(loadFocus(throwing)).toEqual({ areas: [], view: 'front' })
    expect(() => saveFocus(throwing, { areas: [], view: 'front' })).not.toThrow()
  })
})

describe('body-focus photo geometry', () => {
  it('accepts a whole body standing in view', () => {
    expect(poseProblem(standing(), W, H)).toBe(null)
  })

  it('refuses no body, a cut-off body and a tiny one', () => {
    expect(poseProblem([], W, H)).toBe('none')
    expect(poseProblem(null, W, H)).toBe('none')
    const feet = standing(); feet[27] = lm(0.56, 0.92, 0.1)
    expect(poseProblem(feet, W, H)).toBe('partial')
    const cut = standing(); cut[28] = lm(0.44, 1.2)
    expect(poseProblem(cut, W, H)).toBe('partial')
    expect(poseProblem(standing(), 60, 100)).toBe('small')
  })

  it('draws the front view’s areas over the photo and finds the one under a tap', () => {
    const shapes = areasFromPose(standing(), W, H, 'front')
    expect(new Set(shapes.map(s => s.area))).toEqual(new Set(VIEW_AREAS.front))
    const at = (x, y) => hitArea(shapes, x * W, y * H)
    expect(at(0.6, 0.22)).toBe('shoulders')      // on the left shoulder joint
    expect(at(0.4, 0.23)).toBe('shoulders')
    expect(at(0.5, 0.27)).toBe('chest')
    expect(at(0.5, 0.45)).toBe('core')
    expect(at(0.62, 0.3)).toBe('biceps')         // halfway shoulder to elbow
    expect(at(0.65, 0.45)).toBe('forearms')
    expect(at(0.44, 0.62)).toBe('quads')
    expect(at(0.56, 0.82)).toBe('calves')
    expect(at(0.1, 0.5)).toBe(null)              // beside the body
    expect(at(0.5, 0.05)).toBe(null)             // the head is not a muscle
  })

  it('draws the back view’s areas, with the upper thigh as glutes', () => {
    const shapes = areasFromPose(standing(), W, H, 'back')
    expect(new Set(shapes.map(s => s.area))).toEqual(new Set(VIEW_AREAS.back))
    const at = (x, y) => hitArea(shapes, x * W, y * H)
    expect(at(0.5, 0.19)).toBe('traps')
    expect(at(0.5, 0.3)).toBe('upper-back')
    expect(at(0.5, 0.42)).toBe('lower-back')
    expect(at(0.62, 0.3)).toBe('triceps')
    expect(at(0.5, 0.53)).toBe('glutes')
    expect(at(0.56, 0.66)).toBe('hamstrings')
    expect(at(0.44, 0.82)).toBe('calves')
  })

  it('keeps circles round on a wide photo: sizes follow the body, not the frame', () => {
    const shapes = areasFromPose(standing(), 1000, 1000, 'front')
    const c = shapes.find(s => s.kind === 'circle')
    expect(c.r).toBeCloseTo(0.28 * 0.2 * 1000, 5)
  })
})

describe('body-focus taps on a scaled photo', () => {
  it('maps a tap into the photo’s pixels, also when the picture is letterboxed in its box', () => {
    // Exactly the photo's shape: a straight scale.
    expect(toPhoto({ left: 10, top: 20, width: 300, height: 500 }, 600, 1000, 160, 270)).toEqual({ x: 300, y: 500 })
    // A 405 × 720 photo in a 326 × 520 box: drawn 292.5 wide, centred, 16.75 px of bars each side.
    const p = toPhoto({ left: 0, top: 0, width: 326, height: 520 }, 405, 720, 163, 260)
    expect(p.x).toBeCloseTo(202.5, 5)
    expect(p.y).toBeCloseTo(360, 5)
    expect(toPhoto({ left: 0, top: 0, width: 326, height: 520 }, 405, 720, 5, 260)).toBe(null)   // on the bar
    expect(toPhoto({ left: 0, top: 0, width: 0, height: 0 }, 405, 720, 5, 5)).toBe(null)
  })
})
