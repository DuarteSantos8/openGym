// @vitest-environment happy-dom
// The Stats redesign: half the page, nothing lost. The streak once, Challenges folded, three
// recent workouts, the pages behind Stats as one list; one Muscles card where there were three
// lists of sets per muscle (Completed / Planned, the target range, the plan as a tick); exercise
// progress with a chart menu and a day a row; strength levels five at a time; effort with a calm
// headline, harder up in words, and the RIR spread as one stacked bar.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MUSCLES, loadOfWeeklyPlan } from '../lib/muscles.js'
import { TARGET_MUSCLES, DEFAULT_TARGETS } from '../lib/muscle-targets.js'
import { buildDemoProfile } from '../lib/demoSeed.js'
import { DEF } from '../store/useStore.js'
import Stats from './Stats.jsx'
import { pickFrom, pickerOptions } from './stats-pick.test-util.js'

const mocks = vi.hoisted(() => ({ S: null, nav: vi.fn(), charts: [], maps: [], history: vi.fn() }))
vi.mock('../store/useStore.js', async importOriginal => {
  const actual = await importOriginal()
  const useStore = selector => selector({ S: mocks.S })
  useStore.getState = () => ({ S: mocks.S, update: () => {} })
  return { ...actual, useStore }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.nav }))
vi.mock('../sheets.jsx', () => ({
  bwSheet: vi.fn(), goalSheet: vi.fn(), calendarSheet: vi.fn(), workoutDetailSheet: vi.fn(), dayOverrideSheet: vi.fn(),
  exerciseHistorySheet: (...a) => mocks.history(...a), weighInsSheet: vi.fn(), bwDeltaColor: () => '',
  WorkoutRow: ({ w }) => React.createElement('div', { 'data-workout-row': w.id }),
}))
vi.mock('../components/Heatmap.jsx', () => ({ default: () => React.createElement('div') }))
vi.mock('../components/LineChart.jsx', () => ({ default: props => { mocks.charts.push(props); return React.createElement('div') } }))
vi.mock('../components/BodyMap.jsx', () => ({
  default: props => {
    mocks.maps.push(props)
    return React.createElement('div', { 'data-body-map': true, 'data-selected': props.selected || '' },
      ...['chest', 'trapezius'].map(m => React.createElement('button', { key: m, 'data-map-muscle': m, onClick: () => props.onMuscle?.(m) }, m)))
  },
  BodyMapLegend: () => React.createElement('div', { 'data-body-map-legend': true }),
}))

const clone = v => JSON.parse(JSON.stringify(v))
const press = { id: 'press', n: 'Press', primaries: ['chest'], secondaries: ['triceps'], custom: true }
const done = (d, muscle, sets) => ({
  id: `${d}-${muscle}`, d, start: new Date(`${d}T12:00:00`).getTime(),
  entries: [{ id: `custom-${muscle}`, exercise: { primaries: [muscle], secondaries: [] }, sets: Array.from({ length: sets }, () => ({ done: true })) }],
})
const small = over => ({
  ...clone(DEF), unit: 'kg', body: 'male', effort: 'none', targetW: null, bodyweight: [], exWeights: {},
  routines: [{ id: 'push', name: 'Push', ex: [{ id: 'press', sets: 12 }] }],
  customEx: [press], week: { 1: ['push'] }, weekStart: 1, workouts: [], ...over,
})

let host, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  mocks.nav.mockClear(); mocks.history.mockClear(); mocks.charts.length = 0; mocks.maps.length = 0
})
afterEach(() => { act(() => root.unmount()); host.remove(); window.location.hash = ''; vi.useRealTimers() })

const mount = S => { mocks.S = S; act(() => root.render(<Stats />)) }
const card = sel => host.querySelector(sel)
const muscles = () => card('[data-muscles]')
const rows = () => [...muscles().querySelectorAll('[data-muscle-volume]')]
const rowOf = m => muscles().querySelector(`[data-muscle-volume="${m}"]`)
const btn = (scope, text) => [...scope.querySelectorAll('button')].find(b => b.textContent.trim() === text)
const click = el => act(() => el.click())

describe('Stats redesign: Overview', () => {
  it('shows the streak once, folds Challenges, lists three recent workouts and History has the rest', () => {
    mount(Object.assign(clone(DEF), buildDemoProfile()))
    const overview = card('#stats-overview')
    const kpis = overview.querySelector('[data-tour="stats-tiles"]')
    expect([...kpis.querySelectorAll('.tile .l')].map(l => l.textContent)).toEqual(['Workouts', 'This month', 'Weight 30d', 'Lifted in total'])
    expect(host.textContent.match(/Week streak/g)).toHaveLength(1)
    expect(host.querySelectorAll('[data-streak-card]')).toHaveLength(1)
    const fold = overview.querySelector('[data-challenge-shelf] .card-fold')
    if (fold) expect(fold.getAttribute('aria-expanded')).toBe('false')
    expect(overview.querySelectorAll('[data-workout-row]')).toHaveLength(3)
    const all = btn(overview, `All ${mocks.S.workouts.length}`)
    click(all)
    expect(mocks.nav).toHaveBeenCalledWith('/history')
  })

  it('puts the pages behind Stats in one grouped list of rows under Body', () => {
    mount(Object.assign(clone(DEF), buildDemoProfile()))
    const list = card('#stats-body [data-stats-links]')
    const titles = [...list.querySelectorAll('.lrow-t')].map(t => t.textContent)
    expect(titles.slice(0, 3)).toEqual(['Body measurements', 'Progress photos', 'Structural balance'])
    expect(titles).toContain('Your year')
    // rows, not cards with a paragraph and an Open button
    expect(btn(host, 'Open')).toBeUndefined()
    expect(list.querySelector('[data-tour="stats-measure"]')).toBeTruthy()
    click([...list.querySelectorAll('button')].find(b => b.textContent.startsWith('Body measurements')))
    expect(mocks.nav).toHaveBeenCalledWith('/measurements')
  })
})

describe('Stats redesign: Muscles', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 8, 30, 12)) })

  it('is one card: the three lists of sets per muscle are gone', () => {
    mount(small({ workouts: [done('2026-09-30', 'chest', 8)] }))
    expect(host.querySelectorAll('[data-muscles]')).toHaveLength(1)
    expect(host.querySelector('[data-weekly-sets]')).toBeNull()
    expect(host.querySelector('[data-weekly-muscle-volume]')).toBeNull()
    expect(muscles().id).toBe('weekly-volume')
    expect(muscles().dataset.tour).toBe('stats-body')
  })

  it('draws each main muscle against its range, five rows until Show more, the plan as a tick', () => {
    mount(small({ workouts: [done('2026-09-30', 'chest', 8), done('2026-09-30', 'biceps', 3), done('2026-09-30', 'forearm', 2)] }))
    expect(rows().map(r => r.dataset.muscleVolume)).toEqual(['chest', 'biceps', 'triceps', 'deltoids', 'upper-back'])
    const chest = rowOf('chest')
    expect(chest.querySelector('.sbar-v').textContent).toBe('8 / 10–20')
    expect(chest.classList.contains('below')).toBe(true)
    expect(chest.querySelector('.sbar-band')).toBeTruthy()
    // the plan (12 chest sets a week) is a tick on this week's bar, and said in words
    expect(chest.querySelector('.sbar-tick')).toBeTruthy()
    expect(chest.getAttribute('aria-label')).toBe('Chest: 8 sets, Target range 10–20, room for more, Planned 12 sets')
    click(muscles().querySelector('.weekly-volume-toggle'))
    expect(rows()).toHaveLength(TARGET_MUSCLES.length + 1)
    // a muscle without a range has no band
    expect(rowOf('forearm').querySelector('.sbar-band')).toBeNull()
    expect(rowOf('forearm').querySelector('.sbar-v').textContent).toBe('2')
  })

  it('colours a fill by where it sits against the range, by class, never inline', () => {
    mount(small({ workouts: [done('2026-09-30', 'chest', 14), done('2026-09-30', 'biceps', 30)] }))
    expect(rowOf('chest').classList.contains('in')).toBe(true)
    expect(rowOf('biceps').classList.contains('above')).toBe(true)
    for (const r of rows()) expect(r.querySelector('.sbar-f').style.background).toBe('')
  })

  it('switches to the plan: Planned counts the routines of a week, a running rotation too', () => {
    mount(small({ week: { 1: ['push'], 3: 'push' } }))
    click(btn(muscles(), 'Planned'))
    expect(muscles().querySelector('[data-weekly-volume-comparison]').dataset.mode).toBe('planned')
    expect(rowOf('chest').querySelector('.sbar-v').textContent).toBe('24 / 10–20')
    expect(rowOf('triceps').querySelector('.sbar-v').textContent).toBe('9.6 / 6–16')
    expect(muscles().textContent).toContain('Planned sets per week, from your plan.')
    // no period and no week arrows: a plan is a week
    expect(pickerOptions(muscles(), 'Period')).toEqual([])
    act(() => root.unmount()); root = createRoot(host)
    mount(small({ week: {}, queue: { ids: ['push'], since: Date.now(), startsOn: '2026-01-01', label: 'R' } }))
    click(btn(muscles(), 'Planned'))
    expect(rowOf('chest').querySelector('.sbar-v').textContent).toBe(`${loadOfWeeklyPlan(mocks.S).chest} / 10–20`)
  })

  it('says so when there is no plan', () => {
    mount(small({ routines: [], week: {}, workouts: [done('2026-09-30', 'chest', 2)] }))
    click(btn(muscles(), 'Planned'))
    expect(muscles().textContent).toContain('No muscle volume planned.')
  })

  it('reads a longer period as sets a week on average, against the same range', () => {
    mount(small({ workouts: [done('2026-09-30', 'chest', 6), done('2026-09-20', 'chest', 6)] }))
    expect(pickerOptions(muscles(), 'Period')).toEqual(['Week', '30d', '90d', 'All'])
    pickFrom(muscles(), 'Period', '30d')
    expect(muscles().textContent).toContain('Average sets a week')
    expect(rowOf('chest').querySelector('.sbar-v').textContent).toBe(`${Math.round(12 / (30 / 7) * 10) / 10} / 10–20`)
    // the plan tick belongs to this week only
    expect(rowOf('chest').querySelector('.sbar-tick')).toBeNull()
  })

  it('steps back through the weeks and respects a Sunday week start', () => {
    mount(small({ weekStart: 0, workouts: [done('2026-09-27', 'biceps', 1), done('2026-09-20', 'quadriceps', 4)] }))
    const cmp = () => muscles().querySelector('[data-weekly-volume-comparison]')
    expect(cmp().dataset.week).toBe('2026-09-27')
    const next = () => muscles().querySelector('button[aria-label="Next week"]')
    expect(next().disabled).toBe(true)
    click(muscles().querySelector('button[aria-label="Previous week"]'))
    expect(cmp().dataset.week).toBe('2026-09-20')
    expect(mocks.maps.at(-1).load).toEqual({ quadriceps: 4 })
    expect(rowOf('quadriceps').querySelector('.sbar-v').textContent).toBe('4 / 8–18')
    expect(next().disabled).toBe(false)
    click(muscles().querySelector('button[aria-label="Previous week"]'))
    expect(muscles().textContent).toContain('No workouts in this period yet.')
  })

  it('lists an untrained muscle once: a row when it is on one, a quiet chip that opens its exercises when not', () => {
    mount(small({ workouts: [done('2026-09-30', 'chest', 8)] }))
    const fold = muscles().querySelector('.mus-miss')
    expect(fold.getAttribute('aria-expanded')).toBe('false')
    expect(muscles().querySelectorAll('.mchip.miss')).toHaveLength(0)
    click(fold)
    const chips = [...muscles().querySelectorAll('.mchip.miss')]
    expect(fold.querySelector('.mus-miss-n').textContent).toBe(String(chips.length))
    const onRows = new Set(rows().map(r => r.dataset.muscleVolume))
    expect(chips.length).toBe(MUSCLES.length - 1 - (onRows.size - 1))
    for (const c of chips) expect(onRows.has(c.dataset.muscle)).toBe(false)
    click(chips[0])
    expect(mocks.nav).toHaveBeenCalledWith('/muscles?m=' + chips[0].dataset.muscle, { state: { from: '/stats' } })
  })

  it('a muscle picked on the map shows its row, and its exercises when it was not trained', () => {
    mount(small({ workouts: [done('2026-09-30', 'biceps', 3)] }))
    click(muscles().querySelector('[data-map-muscle="chest"]'))
    expect(rows().map(r => r.dataset.muscleVolume)).toEqual(['chest'])
    const find = muscles().querySelector('[data-find-exercises="chest"]')
    expect(find.getAttribute('aria-label')).toBe('Exercises for Chest')
    click(find)
    expect(mocks.nav).toHaveBeenCalledWith('/muscles?m=chest', { state: { from: '/stats' } })
  })

  it('opens on Planned and scrolls itself into view when Plan links here', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 8, 30, 12))
    window.location.hash = '#/stats?focus=weekly-volume'
    const scroll = vi.fn()
    const orig = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = scroll
    try {
      mount(small())
      act(() => { vi.advanceTimersByTime(50) })
      expect(muscles().querySelector('[data-weekly-volume-comparison]').dataset.mode).toBe('planned')
      expect(scroll).toHaveBeenCalled()
    } finally { Element.prototype.scrollIntoView = orig }
  })

  it('keeps the ranges one tap away, beside the key that explains them', () => {
    mount(small({ workouts: [done('2026-09-30', 'chest', 8)] }))
    const key = muscles().querySelector('.mus-key')
    expect([...key.querySelectorAll('.slegend-l')].map(l => l.textContent)).toEqual(['Target range', 'Planned'])
    expect(btn(key, 'Ranges')).toBeTruthy()
    expect(DEFAULT_TARGETS.chest).toEqual([10, 20])
  })
})

describe('Stats redesign: Lifts and Effort on the example profile', () => {
  const demo = () => Object.assign(clone(DEF), buildDemoProfile())

  it('picks the chart from a menu and lists one row a day: the top set, effort as a tag', () => {
    mount(demo())
    const ex = [...host.querySelectorAll('.card')].find(c => c.querySelector('h2')?.textContent === 'Exercise progress')
    // one range control, no segmented control of metrics
    expect(ex.querySelectorAll('.seg')).toHaveLength(1)
    expect(pickerOptions(ex, 'Chart')).toEqual(expect.arrayContaining(['Top set', 'Est. 1RM']))
    const days = [...ex.querySelectorAll('[data-ex-days] .ex-day')]
    expect(days.length).toBeGreaterThan(0)
    expect(days.length).toBeLessThanOrEqual(5)
    for (const d of days) {
      expect(d.querySelector('.ex-day-s').textContent).not.toMatch(/RIR|RPE/)
      expect(d.querySelector('.ex-day-s').textContent).not.toMatch(/ {2}/)   // one set, not the session
    }
    expect(days.some(d => d.querySelector('.ex-eff'))).toBe(true)
    click(days[0])
    expect(mocks.history).toHaveBeenCalledTimes(1)
  })

  it('shows five strength levels, one line each, then Show more', () => {
    mount(demo())
    const lv = card('[data-strength-levels]')
    if (!lv) return
    const n = lv.querySelectorAll('.slevel-row').length
    expect(n).toBeLessThanOrEqual(5)
    const more = btn(lv, 'Show more')
    if (more) { click(more); expect(lv.querySelectorAll('.slevel-row').length).toBeGreaterThan(5) }
    expect(lv.querySelector('.slevel-bar')).toBeNull()
  })

  it('effort: the average leads in ink, harder is up in words, the spread is one stacked bar', () => {
    mount(demo())
    const eff = card('.effort-card')
    expect(eff).toBeTruthy()
    expect(eff.querySelectorAll('.stat-v')).toHaveLength(1)
    for (const el of eff.querySelectorAll('[style]')) expect(el.getAttribute('style')).not.toMatch(/gold-ink\)?;?\s*$/)
    const chart = mocks.charts.find(c => c.h === 140)
    expect(chart.yHint).toEqual({ hi: 'Harder' })
    expect(chart.tickPrefix).toMatch(/^(RIR|RPE) $/)
    const bar = eff.querySelector('.sstack-bar')
    expect(bar.getAttribute('role')).toBe('img')
    expect(eff.querySelectorAll('.sstack-legend li')).toHaveLength(5)
    expect(eff.querySelector('.mrow')).toBeNull()
  })
})

// Card dismiss pass (1.4.4): the redesigned Stats keeps every control a sibling, never inside
// another (the folded Challenges header, the tapped bar rows, the day rows, the links list).
describe('Stats: no control inside a control', () => {
  it('nothing interactive sits inside anything interactive, with every section shown', () => {
    mount(Object.assign(clone(DEF), buildDemoProfile()))
    act(() => host.querySelector('[data-challenge-shelf] .card-fold')?.click())
    const sel = 'button, a[href], input, select, textarea, [role="button"], [role="link"], [tabindex]:not([tabindex="-1"])'
    const nested = [...host.querySelectorAll(sel)].filter(el => el.parentElement?.closest(sel)).map(el => el.outerHTML.slice(0, 80))
    expect(host.querySelectorAll(sel).length).toBeGreaterThan(20)
    expect(nested).toEqual([])
  })
})
