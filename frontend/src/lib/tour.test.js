// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  STEPS, FLOWS, TUTORIALS, TUTORIAL_COPY, tourSteps, stepFrom, indexOfStep, readTour, noteStep, markTourDone, markOffered, markResumeAsked,
  markTutorialDone, tutorialDone, shouldOffer, resumeAt, placeCard, visiblePart, reached, passOver, routeOf,
  openTour, closeTour, tourState, tourRunning, startTour, tourBack,
} from './tour.js'

const fresh = { workouts: [], routines: [], active: null }
beforeEach(() => { localStorage.clear(); closeTour() })
afterEach(() => { localStorage.clear(); closeTour() })

describe('steps', () => {
  it('runs Home, Plan, Library, the workout, Stats, Settings and a closing card, in that order', () => {
    const routes = tourSteps({}).map(s => s.route).filter((r, i, all) => r !== all[i - 1])
    expect(routes).toEqual(['/home', '/plan', '/library', '/workout', '/home', '/stats', '/home', '/settings', null])
    expect(tourSteps({}).at(-1)).toMatchObject({ id: 'done', anchor: null })
  })
  it('never jumps between screens: each change of screen is a stop on the real control that leads there', () => {
    for (const [flow, steps] of Object.entries(FLOWS)) {
      steps.forEach((s, i) => {
        if (s.go) expect(s.anchor, flow + ' ' + s.id).toBeTruthy()
        const prev = steps[i - 1]
        if (!prev || s.sandbox === 'practice' || prev.sandbox === 'practice') return
        const a = routeOf(prev, { made: 'r1' }), b = routeOf(s, { made: 'r1' })
        // a stop on another screen than the one before it comes right after a way there
        if (a && b && a !== b) expect(reached(prev, b) || prev.id === 'p-save', flow + ': ' + prev.id + ' → ' + s.id).toBe(true)
      })
    }
    // the tab bar's own buttons, the gear and the back buttons
    expect(STEPS.filter(s => s.go).map(s => s.anchor)).toEqual(['tab-plan', 'tab-library', 'tab-stats', 'tab-home', 'settings-gear'])
    // into the practice workout through the Start button, which the tour takes for itself
    expect(STEPS.find(s => s.id === 'start')).toMatchObject({ anchor: 'start', intercept: true, route: '/library' })
  })
  it('the tutorials each open with a card that says what they do and end with one', () => {
    expect(TUTORIALS).toEqual(['plan', 'custom', 'edit', 'backup'])
    for (const f of TUTORIALS) {
      const steps = tourSteps({}, f)
      expect(steps[0], f).toMatchObject({ anchor: null, route: null })
      expect(steps.at(-1), f).toMatchObject({ anchor: null })
      expect(new Set(steps.map(s => s.id)).size).toBe(steps.length)
      expect(TUTORIAL_COPY[f]()[0]).toBeTruthy()
    }
  })
  it('the plan is built in a copy right up to its Save, and only what comes after is real', () => {
    const steps = tourSteps({}, 'plan')
    const save = steps.findIndex(s => s.commit)
    const first = steps.findIndex(s => s.sandbox === 'plan')
    expect(steps[first].id).toBe('p-new')
    expect(steps.slice(first, save + 1).every(s => s.sandbox === 'plan')).toBe(true)
    expect(steps.slice(save + 1).some(s => s.sandbox)).toBe(false)
  })
  it('the data tutorial runs on its pretend copy all the way, and the backup one only points', () => {
    const edit = tourSteps({}, 'edit')
    expect(edit.slice(0, -1).every(s => s.sandbox === 'edit')).toBe(true)
    expect(edit.at(-1).sandbox).toBeUndefined()
    const backup = tourSteps({}, 'backup')
    expect(backup.some(s => s.open || s.tap || s.free || s.sandbox)).toBe(false)
  })
  // v1.4.4: date & time, duration, sharing and Delete moved behind the detail sheet's one
  // "Workout options" row (sheets.jsx WorkoutDetail), so the stop points at that row now.
  it('walks the workout sheet top to bottom: Edit, the note, then the Workout options row', () => {
    const sheet = tourSteps({}, 'edit').filter(s => s.back === 'e-row')
    expect(sheet.map(s => [s.id, s.anchor])).toEqual([['e-edit', 'wd-edit'], ['e-note', 'wd-note'], ['e-options', 'wd-options']])
    expect(sheet.every(s => s.sheet)).toBe(true)
  })
  it('leaves out what a profile has nothing to show for, and keeps it for one that has', () => {
    const empty = tourSteps({}).map(s => s.id)
    expect(empty).not.toContain('plan-body')
    expect(empty).not.toContain('stats-records')
    expect(empty).not.toContain('rest')
    const full = tourSteps({ plannedDays: true, rest: true, swipe: true, balance: true, workouts: true }).map(s => s.id)
    expect(full).toEqual(STEPS.map(s => s.id))
  })
  it('only the workout stops run on the practice session, and they sit together', () => {
    const steps = tourSteps({ rest: true, swipe: true })
    const idx = steps.map((s, i) => (s.sandbox === 'practice' ? i : -1)).filter(i => i >= 0)
    expect(idx.length).toBeGreaterThan(3)
    expect(idx.at(-1) - idx[0] + 1).toBe(idx.length)
    expect(steps.filter(s => s.sandbox === 'practice').every(s => s.route === '/workout')).toBe(true)
  })
  it('moves one stop at a time and says when it runs off either end', () => {
    const steps = tourSteps({})
    expect(stepFrom(steps, 0, 1)).toBe(1)
    expect(stepFrom(steps, 0, -1)).toBe(-1)
    expect(stepFrom(steps, steps.length - 1, 1)).toBe(-1)
    expect(indexOfStep(steps, 'lib-search')).toBe(steps.findIndex(s => s.id === 'lib-search'))
    // a stop this profile does not have (the record came from another one) starts from the top
    expect(indexOfStep(steps, 'plan-body')).toBe(0)
  })
})

describe('the record on this device', () => {
  it('asks once, on a first setup only', () => {
    expect(shouldOffer(readTour(), fresh)).toBe(true)
    markOffered()
    expect(shouldOffer(readTour(), fresh)).toBe(false)
  })
  it('never asks a profile that has logged workouts, one mid-workout, or a copy still syncing', () => {
    expect(shouldOffer({}, { ...fresh, workouts: [{ id: 'w' }] })).toBe(false)
    expect(shouldOffer({}, { ...fresh, active: { id: 'a' } })).toBe(false)
    expect(shouldOffer({}, fresh, { synced: false })).toBe(false)
  })
  it('a tour closed halfway is offered to finish once, then not again', () => {
    noteStep('stats')
    expect(resumeAt(readTour())).toBe('stats')
    markResumeAsked()
    expect(resumeAt(readTour())).toBe(null)
    noteStep('look')   // they said yes and went on: a new halfway point asks again
    expect(resumeAt(readTour())).toBe('look')
    markTourDone()
    expect(resumeAt(readTour())).toBe(null)
    expect(shouldOffer(readTour(), fresh)).toBe(false)
  })
  it('keeps no record in the synced state, only in this browser', () => {
    noteStep('today')
    expect(Object.keys(localStorage)).toEqual(['gym_tour_v1'])
  })
})

describe('open or not', () => {
  it('Settings starts it from the top, whatever the record says', () => {
    markTourDone()
    startTour()
    expect(tourState()).toEqual({ kind: 'run', at: null })
    expect(tourRunning()).toBe(true)
  })
  it('a tutorial opens by name and is ticked off on its own record', () => {
    startTour(null, 'plan')
    expect(tourState()).toEqual({ kind: 'run', at: null, flow: 'plan' })
    expect(tutorialDone('plan')).toBe(false)
    markTutorialDone('plan')
    markTutorialDone('edit')
    expect(tutorialDone('plan')).toBe(true)
    expect(tutorialDone('custom')).toBe(false)
    expect(Object.keys(readTour().tutorials)).toEqual(['plan', 'edit'])
  })
  it('back closes a tutorial without touching the tour’s own record', () => {
    noteStep('stats')
    openTour({ kind: 'run', at: null, flow: 'custom' })
    expect(tourBack()).toBe(true)
    expect(readTour().done).toBeUndefined()
    expect(resumeAt(readTour())).toBe('stats')
  })
  it('back closes it, and a running tour closed by back counts as seen', () => {
    expect(tourBack()).toBe(false)
    openTour({ kind: 'run', at: 'plan-mode' })
    expect(tourBack()).toBe(true)
    expect(tourState()).toBe(null)
    expect(readTour().done).toBeGreaterThan(0)
  })
})

describe('ways to another screen', () => {
  const step = id => Object.values(FLOWS).flat().find(s => s.id === id)
  it('is reached on its path, or one its pattern matches', () => {
    expect(reached(step('go-plan'), '/plan')).toBe(true)
    expect(reached(step('go-plan'), '/plan/r/x')).toBe(false)
    expect(reached(step('p-new'), '/plan/r/abc')).toBe(true)
    expect(reached(step('p-new'), '/plan')).toBe(false)
    expect(reached(step('today'), '/home')).toBe(false)
  })
  it('is passed over when that screen is on already, or by its own rule', () => {
    const has = () => false
    expect(passOver(step('c-go'), { path: '/library', has })).toBe(true)
    expect(passOver(step('c-go'), { path: '/home', has })).toBe(false)
    expect(passOver(step('b-up'), { path: '/settings', has })).toBe(true)
    expect(passOver(step('b-up'), { path: '/settings/about', has })).toBe(false)
    expect(passOver(step('p-views'), { path: '/plan', has: n => n === 'plan-new' })).toBe(true)
  })
  it('the new routine’s own screen is worked out from the one the tour made', () => {
    expect(routeOf(step('p-name'), { made: 'r9' })).toBe('/plan/r/r9')
    expect(routeOf(step('today'))).toBe('/home')
  })
})

describe('visiblePart', () => {
  const view = { top: 40, bottom: 760, vw: 390 }
  it('is the box when it is on screen, clipped to the band', () => {
    expect(visiblePart({ top: 100, left: 10, width: 100, height: 40 }, view)).toEqual({ top: 100, left: 10, width: 100, height: 40 })
    expect(visiblePart({ top: 20, left: 10, width: 100, height: 100 }, view)).toMatchObject({ top: 40, height: 80 })
  })
  it('is nothing for a box scrolled away, a sliver at the edge or nothing at all', () => {
    expect(visiblePart({ top: 900, left: 10, width: 100, height: 40 }, view)).toBe(null)
    expect(visiblePart({ top: -200, left: 10, width: 100, height: 40 }, view)).toBe(null)
    expect(visiblePart({ top: 752, left: 10, width: 100, height: 40 }, view)).toBe(null)
    expect(visiblePart({ top: 100, left: 10, width: 0, height: 0 }, view)).toBe(null)
  })
})

describe('placeCard', () => {
  const card = { w: 300, h: 160 }
  const view = { vw: 390, vh: 800, top: 40, bottom: 30 }
  it('goes under the spotlight when it fits', () => {
    expect(placeCard({ top: 100, left: 20, width: 200, height: 50 }, card, view)).toMatchObject({ side: 'below', top: 162 })
  })
  it('goes over it near the bottom (the Start button)', () => {
    const p = placeCard({ top: 700, left: 150, width: 90, height: 60 }, card, view)
    expect(p.side).toBe('above')
    expect(p.top + card.h).toBeLessThanOrEqual(700)
  })
  it('stays inside the screen and the phone’s insets at 320 px', () => {
    const p = placeCard({ top: 300, left: 280, width: 40, height: 40 }, { w: 288, h: 200 }, { vw: 320, vh: 568, top: 20, bottom: 20 })
    expect(p.left).toBeGreaterThanOrEqual(16)
    expect(p.left + 288).toBeLessThanOrEqual(320 - 16)
  })
  it('a tall spotlight with no room either side keeps the card on screen', () => {
    const p = placeCard({ top: 60, left: 0, width: 390, height: 700 }, card, view)
    expect(p.top).toBeGreaterThanOrEqual(56)
    expect(p.top + card.h).toBeLessThanOrEqual(800 - 30 - 16)
  })
  it('points at the middle of the spotlight from wherever the card sits', () => {
    const p = placeCard({ top: 700, left: 300, width: 60, height: 60 }, card, view)
    expect(p.left + p.arrow).toBe(330)
    // no room either side: the card may sit on the hole, so it points at nothing
    expect(placeCard({ top: 60, left: 0, width: 390, height: 700 }, card, view).arrow).toBe(null)
  })
  it('no spotlight: the middle', () => {
    expect(placeCard(null, card, view)).toMatchObject({ side: 'center', left: 45 })
  })
})
