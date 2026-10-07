// @vitest-environment happy-dom
// Plan → Schedule since v1.3.11: ONE "How you train: Fixed Week | Rotation" control (the same
// switch and keys as Settings, lib/rotation.js chooseRotation / chooseFixedWeek). Fixed Week shows
// the weekdays; Rotation shows the loop (add, Edit to reorder and remove, Start the loop over),
// with the weekdays that still hold a routine beside it. An externally written queue is read-only
// until adopted, and a malformed one offers recovery.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const state = { S: null, nav: null }
  state.snapshot = () => ({
    S: state.S,
    update: mut => { const next = structuredClone(state.S); mut(next); state.S = next },
    config: {}, user: null, coachLocal: { mode: 'off' },
  })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => selector ? selector(mocks.snapshot()) : mocks.snapshot()
  useStore.getState = mocks.snapshot
  return { useStore }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.nav }))
vi.mock('../sheets.jsx', () => ({
  dayAssignSheet: vi.fn(), starterPlanSheet: vi.fn(), menuSheet: vi.fn(), confirmSheet: vi.fn(),
  planHasRoutines: () => true, exportPlanFile: vi.fn(), printWholePlan: vi.fn(), importPlanFile: vi.fn(),
}))
vi.mock('../lib/mobile.js', () => ({ MOBILE: false }))
vi.mock('../lib/demo.js', () => ({ DEMO: false }))
vi.mock('../lib/coach.js', () => ({ coachAvailable: () => false }))

import Plan from './Plan.jsx'
import { menuSheet, confirmSheet } from '../sheets.jsx'
import { todayISO, isoOf, fmtDate } from '../lib/format.js'

const routines = [
  { id: 'a', name: 'A', emoji: null, ex: [{ id: '0025' }] },
  { id: 'b', name: 'B', emoji: null, ex: [{ id: '0025' }] },
  { id: 'c', name: 'C', emoji: null, ex: [{ id: '0025' }] },
]
const live = (over = {}) => ({ ids: ['a', 'b'], since: Date.now() - 86400000, startsOn: todayISO(), label: 'My split', ...over })
const saved = { id: 'r1', sequence: ['a', 'b'], label: 'My split' }
const baseS = over => ({ routines, week: { 1: ['c'] }, dayPlan: {}, workouts: [], queue: null, rotation: null, scheduleMode: null, ...over })

let host, root
beforeEach(() => {
  localStorage.removeItem('gym_plan_view')
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  menuSheet.mockClear(); confirmSheet.mockClear(); mocks.nav = vi.fn()
})
afterEach(() => { act(() => root.unmount()); host.remove() })

// the mocked store is not reactive: re-mount to see a write render
const mount = over => { mocks.S = baseS(over); act(() => root.render(<Plan />)) }
const remount = () => act(() => root.render(<Plan key={Math.random()} />))
const rows = () => [...host.querySelectorAll('.rotation-row')]
const names = () => rows().map(r => r.querySelector('.tt').textContent)
const click = el => act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true })))
const byLabel = label => [...host.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === label || b.textContent.trim() === label)
const modeButtons = () => [...host.querySelectorAll('.plan-mode .seg button')]
const pickMode = label => click(modeButtons().find(b => b.textContent === label))
const selectedMode = () => modeButtons().find(b => b.className.includes('on'))?.textContent
const headings = () => [...host.querySelectorAll('h4.sec')].map(h => h.firstChild.textContent)
const subtitle = () => host.querySelector('.hdr .sub').textContent

describe('Plan — How you train', () => {
  it('nothing saved: Fixed Week with the weekdays, and no rotation buttons of its own', () => {
    mount()
    expect(selectedMode()).toBe('Fixed Week')
    expect(headings()).toContain('This week')
    expect(subtitle()).toBe('Your weekly routine')
    expect(rows()).toEqual([])
    // the old duplicate controls are gone: the mode control is the one way in and out
    expect(byLabel('Build a rotation instead')).toBeUndefined()
    expect(byLabel('Cancel')).toBeUndefined()
  })

  it('Rotation with nothing saved holds the choice and shows an empty loop instead of the week', () => {
    mount()
    pickMode('Rotation')
    expect(mocks.S.scheduleMode).toBe('rotation')
    expect(mocks.S.queue).toBe(null)
    remount()
    expect(selectedMode()).toBe('Rotation')
    expect(headings()).toContain('The loop')
    expect(headings()).not.toContain('This week')
    expect(host.textContent).toContain('No rotation yet.')
    // the subtitle stops saying "weekly" once you train in a loop
    expect(subtitle()).toBe('Your routines in a loop')
  })

  it('the loop header can wrap so Add never runs off a 320 px screen', async () => {
    mount({ scheduleMode: 'rotation' })
    const acts = host.querySelector('.rotation .plan-sec-h > .plan-sec-acts')
    expect(acts).toBeTruthy()
    expect(acts.querySelector('button[aria-label="Add routine to the rotation"]')).toBeTruthy()
    const { readFileSync } = await import('node:fs')
    const css = readFileSync(process.cwd() + '/src/index.css', 'utf8')
    expect(css).toMatch(/^\.plan-sec-h\{[^}]*flex-wrap:wrap/m)
    expect(css).toMatch(/^\.plan-sec-h>\.plan-sec-acts\{[^}]*margin-inline-start:auto/m)
  })

  it('back to Fixed Week with nothing running needs no confirmation', () => {
    mount({ scheduleMode: 'rotation' })
    pickMode('Fixed Week')
    expect(confirmSheet).not.toHaveBeenCalled()
    expect(mocks.S.scheduleMode).toBe('week')
  })

  it('Rotation starts a pass from a saved loop', () => {
    mount({ rotation: saved })
    pickMode('Rotation')
    expect(mocks.S.queue).toMatchObject({ ids: ['a', 'b'], rotationId: 'r1', startsOn: todayISO() })
    expect(mocks.S.scheduleMode).toBe('rotation')
  })

  it('leaving a running loop asks first, then keeps the loop and the weekdays', () => {
    mount({ queue: live({ rotationId: 'r1' }), rotation: saved, dayPlan: { [todayISO()]: 'a' } })
    expect(selectedMode()).toBe('Rotation')
    pickMode('Fixed Week')
    expect(mocks.S.queue).not.toBe(null)
    expect(confirmSheet).toHaveBeenCalledTimes(1)
    act(() => confirmSheet.mock.calls[0][0].onConfirm())
    expect(mocks.S.queue).toBe(null)
    expect(mocks.S.scheduleMode).toBe('week')
    expect(mocks.S.rotation.sequence).toEqual(['a', 'b'])
    expect(mocks.S.week).toEqual({ 1: ['c'] })
    expect(mocks.S.dayPlan).toEqual({})
  })
})

describe('Plan — the loop', () => {
  it('lists the live pass in order with its state, and keeps the weekdays that hold a routine', () => {
    mount({ queue: live({ rotationId: 'r1' }), rotation: saved })
    expect(names()).toEqual(['A', 'B'])
    expect(rows().map(r => r.querySelector('.ss').textContent)).toEqual(['Up next', 'Later'])
    expect(rows()[0].querySelector('.plan-order').className).toContain('next')
    expect(host.textContent).toContain('0 of 2 done this round.')
    // week[1] = ['c'] rides along beside the pass (effectiveRoutineIds), so it stays in sight
    expect(headings()).toContain('Also on fixed days')
    expect(host.querySelector('.plan-day[data-day="1"] .tt').textContent).toBe('C')
    expect(host.querySelectorAll('.plan-day').length).toBe(1)
  })

  it('a weekday shows only what the loop does not have, and a day with nothing else is left out', () => {
    mount({ queue: live({ rotationId: 'r1' }), rotation: saved, week: { 1: ['a', 'c'], 3: ['b'], 5: ['a'] } })
    expect(headings()).toContain('Also on fixed days')
    expect([...host.querySelectorAll('.plan-day')].map(d => d.dataset.day)).toEqual(['1'])
    expect(host.querySelector('.plan-day[data-day="1"] .tt').textContent).toBe('C')
    remount()
    mount({ queue: live({ rotationId: 'r1' }), rotation: saved, week: { 3: ['b'], 5: ['a'] } })
    expect(headings()).not.toContain('Also on fixed days')
    expect(host.querySelectorAll('.plan-day').length).toBe(0)
  })

  it('a session done this round reads Done and moves Up next along', () => {
    const since = Date.now() - 86400000
    mount({
      queue: live({ since, rotationId: 'r1' }), rotation: saved,
      workouts: [{ id: 'w1', d: todayISO(), start: Date.now() - 1000, routineIds: ['a'], routineId: 'a', name: 'A', entries: [] }],
    })
    expect(rows().map(r => r.querySelector('.ss').textContent)).toEqual(['Done', 'Up next'])
    expect(host.textContent).toContain('1 of 2 done this round.')
  })

  it('adding a routine offers only the ones not in the loop, and saves the pass', () => {
    mount({ queue: live({ rotationId: 'r1' }), rotation: saved })
    click(byLabel('Add routine to the rotation'))
    const items = menuSheet.mock.calls[0][0].items
    expect(items.map(i => i.label)).toEqual(['C'])
    act(() => items[0].onClick())
    expect(mocks.S.queue.ids).toEqual(['a', 'b', 'c'])
    expect(mocks.S.rotation.sequence).toEqual(['a', 'b', 'c'])
  })

  it('Edit reveals the handles; moving one reorders without restarting the pass', () => {
    const since = Date.now() - 86400000
    mount({ queue: live({ since, rotationId: 'r1' }), rotation: saved })
    expect(host.querySelector('[data-reorder-handle]')).toBe(null)
    click(byLabel('Edit'))
    const handle = rows()[0].querySelector('[data-reorder-handle]')
    act(() => { handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })) })
    expect(mocks.S.queue.ids).toEqual(['b', 'a'])
    expect(mocks.S.queue.since).toBe(since)
  })

  it('a drag on the handle reorders the loop too', () => {
    mount({ queue: live({ ids: ['a', 'b', 'c'], rotationId: 'r1' }), rotation: { ...saved, sequence: ['a', 'b', 'c'] } })
    click(byLabel('Edit'))
    rows().forEach((row, i) => { row.getBoundingClientRect = () => ({ top: i * 68, bottom: i * 68 + 60, height: 60, left: 0, right: 300, width: 300 }) })
    const h = rows()[2].querySelector('[data-reorder-handle]')
    const fire = (type, y) => act(() => { h.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 7, button: 0, clientY: y })) })
    fire('pointerdown', 166)
    fire('pointermove', 20)
    fire('pointerup', 20)
    expect(mocks.S.queue.ids).toEqual(['c', 'a', 'b'])
  })

  it('removing the last routine keeps Rotation with an empty loop, ready for another routine', () => {
    mount({ queue: live({ ids: ['a'], rotationId: 'r1' }), rotation: { id: 'r1', sequence: ['a'], label: 'My split' } })
    click(byLabel('Edit'))
    const minus = rows()[0].querySelector('.plan-minus')
    expect(minus.getAttribute('aria-label')).toBe('Remove ' + routines.find(r => r.id === 'a').name)   // named for its routine
    expect(host.textContent).toContain('Drag to reorder. Tap the minus to take one out.')
    click(minus)
    expect(mocks.S.queue).toBe(null)
    expect(mocks.S.rotation).toEqual({ id: 'r1', sequence: [], label: 'My split' })
    expect(mocks.S.scheduleMode).toBe('rotation')
    expect(mocks.S.week).toEqual({ 1: ['c'] })
    remount()
    expect(selectedMode()).toBe('Rotation')
    expect(host.textContent).toContain('No rotation yet.')
    // swapping the only routine: add another one back in, same rotation id
    click(byLabel('Add routine to the rotation'))
    act(() => menuSheet.mock.calls.at(-1)[0].items.find(i => i.label === 'B').onClick())
    expect(mocks.S.rotation).toMatchObject({ id: 'r1', sequence: ['b'] })
    expect(mocks.S.queue.ids).toEqual(['b'])
  })

  it('a loop built here saves no name of its own, so it follows the language on screen', () => {
    mount({ scheduleMode: 'rotation' })
    click(byLabel('Add routine to the rotation'))
    act(() => menuSheet.mock.calls.at(-1)[0].items.find(i => i.label === 'A').onClick())
    expect(mocks.S.rotation.sequence).toEqual(['a'])
    expect(mocks.S.rotation.label).toBe('')
    expect(mocks.S.queue.label).toBe('')
  })

  it('Start the loop over rewinds the current round, strictly from now', () => {
    mount({
      queue: live({ since: Date.now() - 5 * 86400000, startsOn: '2026-09-01', rotationId: 'r1' }),
      rotation: saved,
    })
    click(byLabel('Start the loop over'))
    expect(mocks.S.queue.startsOn).toBe(todayISO())
    expect(mocks.S.queue.ids).toEqual(['a', 'b'])
    expect(mocks.S.queue.strict).toBe(true)
  })

  it('a round waiting on its first day ends its sentence before the hint', () => {
    const d = new Date(); d.setDate(d.getDate() + 1)
    const tomorrow = isoOf(d)
    mount({ queue: live({ startsOn: tomorrow, rotationId: 'r1' }), rotation: saved })
    expect(host.querySelector('.rotation .sect-f').textContent).toBe('Next round starts ' + fmtDate(tomorrow, true) + '. Trained out of order? Just pick another routine on Home.')
  })

  it('a saved loop with no round running offers Start the loop', () => {
    mount({ rotation: saved, scheduleMode: 'rotation' })
    expect(names()).toEqual(['A', 'B'])
    expect(byLabel('Start the loop over')).toBeUndefined()
    click(byLabel('Start the loop'))
    expect(mocks.S.queue.ids).toEqual(['a', 'b'])
    expect(mocks.S.queue.rotationId).toBe('r1')
  })
})

describe('Plan — someone else’s queue, and a broken one', () => {
  it('an externally written pass is locked: no mode control, no edits, adoption behind a confirm', () => {
    mount({ queue: live(), scheduleMode: 'rotation' })   // no rotationId, no rotation
    expect(modeButtons()).toEqual([])
    expect(host.querySelector('.plan-mode').textContent).toContain('Externally managed')
    expect(byLabel('Build a rotation instead')).toBeUndefined()
    expect(byLabel('Edit')).toBeUndefined()
    expect(byLabel('Add routine to the rotation')).toBeUndefined()
    expect(rows()[0].querySelectorAll('button').length).toBe(0)
    expect(headings()).toContain('Also on fixed days')
    click(byLabel('Use this rotation'))
    expect(mocks.S.rotation).toBe(null)            // not adopted yet — waiting on the confirm
    act(() => confirmSheet.mock.calls.at(-1)[0].onConfirm())
    expect(mocks.S.rotation.sequence).toEqual(['a', 'b'])
    expect(mocks.S.queue.rotationId).toBe(mocks.S.rotation.id)
    // Adopting drops the planner's name ("My split"): refillAfter would otherwise repeat it on
    // every pass this app generates on its own. It saves no name at all, so Home shows the word
    // in whatever language is on screen (QA 2026-10-06: a saved 'Rotation' stayed English).
    expect(mocks.S.rotation.label).toBe('')
    expect(mocks.S.queue.label).toBe('')
    remount()
    expect(host.textContent).not.toContain('Externally managed')
    expect(selectedMode()).toBe('Rotation')
  })

  it('adopting a coach queue over a different loop of your own says the loop gets replaced', () => {
    mount({ queue: live({ ids: ['b', 'c'] }), rotation: { id: 'r0', sequence: ['a', 'b'], label: 'Mine' }, scheduleMode: 'rotation' })
    click(byLabel('Use this rotation'))
    expect(confirmSheet.mock.calls.at(-1)[0].message).toMatch(/ Your own loop gets replaced\.$/)
    // the same sessions in the same order: nothing of yours is lost, nothing to warn about
    mount({ queue: live({ ids: ['a', 'b'] }), rotation: { id: 'r0', sequence: ['a', 'b'], label: 'Mine' }, scheduleMode: 'rotation' })
    click(byLabel('Use this rotation'))
    expect(confirmSheet.mock.calls.at(-1)[0].message).not.toContain('Your own loop')
  })

  it('a malformed queue offers recovery instead of a loop full of nothing', () => {
    mount({ queue: { ids: ['gone'], since: Date.now() } })
    expect(host.textContent).toContain('This rotation couldn’t be read')
    click(byLabel('Discard it'))
    expect(mocks.S.queue).toBe(null)
  })

  it('Discard it leaves a clear way back in: Rotation starts the saved loop again', () => {
    mount({ queue: { ids: ['gone'], since: Date.now() }, rotation: saved, scheduleMode: 'rotation' })
    click(byLabel('Discard it'))
    expect(mocks.S.queue).toBe(null)
    expect(mocks.S.scheduleMode).toBe('week')
    remount()
    expect(headings()).toContain('This week')
    pickMode('Rotation')
    expect(mocks.S.queue.ids).toEqual(['a', 'b'])
  })

  it('every routine in the loop deleted still leaves a way back in, not a locked editor', () => {
    mount({ routines: [], queue: { ids: ['a', 'b'], since: Date.now() }, rotation: saved, scheduleMode: 'rotation' })
    expect(host.textContent).toContain('This rotation couldn’t be read')
    click(byLabel('Discard it'))
    expect(mocks.S.scheduleMode).toBe('week')
    remount()
    // nothing in the saved loop survives, so Rotation only holds the choice: a fresh build
    pickMode('Rotation')
    expect(mocks.S.queue).toBe(null)
    expect(mocks.S.scheduleMode).toBe('rotation')
  })
})

describe('Plan — Schedule extras', () => {
  it('links to the weekly muscle volume in Stats', () => {
    mount()
    click(byLabel('Weekly muscle volume') || [...host.querySelectorAll('.plan-link button')][0])
    expect(mocks.nav).toHaveBeenCalledWith('/stats?focus=weekly-volume')
  })

  it('has no volume link before there is a routine (Stats has no card to show then)', () => {
    mount({ routines: [], week: {} })
    expect(host.querySelector('.plan-link')).toBe(null)
  })

  it('switches to Routines and remembers it for next time', () => {
    mount()
    const seg = label => [...host.querySelectorAll('.plan-views button')].find(b => b.textContent === label)
    click(seg('Routines'))
    expect(localStorage.getItem('gym_plan_view')).toBe('routines')
    expect(host.querySelector('.plan-mode')).toBe(null)
    expect(host.querySelector('.plan-routines')).toBeTruthy()
    act(() => root.unmount()); root = createRoot(host)
    act(() => root.render(<Plan />))
    expect(seg('Routines').className).toContain('on')
    click(seg('Schedule'))
    expect(localStorage.getItem('gym_plan_view')).toBe('schedule')
    expect(host.querySelector('.plan-mode')).toBeTruthy()
  })

  it('one Plan menu holds share, print, import and the starter plans', () => {
    mount()
    click(byLabel('Plan options'))
    const items = menuSheet.mock.calls.at(-1)[0].items.filter(Boolean)
    expect(items.map(i => i.label)).toEqual(['Export plan file', 'Print / Save as PDF', 'Import a plan file', 'Load starter plan'])
  })
})
