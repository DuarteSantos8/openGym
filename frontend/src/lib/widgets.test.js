// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The iPhone widgets' snapshot (lib/widgets.js): what the page hands the widget extension through
// the App Group. The shape is what ios/App/OpenGymWidgets/WidgetSnapshot.swift decodes, so a field
// renamed here is a widget gone blank there. Text only, nothing from the exercise media.
const h = vi.hoisted(() => { vi.stubEnv('VITE_MOBILE', '1'); return { platform: 'ios' } })
vi.mock('./mobile.js', () => ({ MOBILE: true, nativePlatform: async () => h.platform }))

const { buildWidgetSnapshot, startWidgetSync, _setWidgetPluginForTest, _resetWidgets, WIDGET_DAYS } = await import('./widgets.js')

// 2026-10-14 is a Wednesday (getDay 3).
const TODAY = '2026-10-14'
const push = { id: 'r1', name: 'Push', ex: [{ id: '0025', sets: 3, reps: 8, weight: 60 }, { id: 'c1', name: 'Cable thing', sets: 2, reps: 12 }] }
const legs = { id: 'r2', name: 'Legs', ex: [{ id: '0043', sets: 5, reps: 5, weight: 100 }] }
const S = (over = {}) => ({
  unit: 'kg', accent: 'sky', routines: [push, legs], week: { 3: ['r1'], 5: ['r2'] }, dayPlan: {}, workouts: [], bodyweight: [], ...over,
})

describe('buildWidgetSnapshot', () => {
  it('has the plan for today and the week after it, today with its exercises', () => {
    const snap = buildWidgetSnapshot(S(), { today: TODAY })
    expect(snap.v).toBe(1)
    expect(snap.today).toBe(TODAY)
    expect(snap.days).toHaveLength(WIDGET_DAYS)
    expect(snap.days.map(d => d.iso)).toEqual(['2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21'])
    const [today, thu, fri] = snap.days
    expect(today).toMatchObject({ name: 'Push', count: 2, done: false })
    expect(today.exercises).toHaveLength(2)
    expect(today.exercises[0].line).toMatch(/3 × 8 · 60 kg/)
    expect(today.exercises[1].name).toBe('Cable thing')
    // Title-cased like the app shows it, not the stored lower-case name.
    expect(today.exercises[0].name).toBe('Barbell Bench Press')
    expect(typeof today.weekday).toBe('string')
    // A rest day is a day without a name; other days carry no exercise list.
    expect(thu).toMatchObject({ name: null, count: 0 })
    expect(fri).toMatchObject({ name: 'Legs', count: 1 })
    expect(fri.exercises).toBeUndefined()
    // the next week's Wednesday again
    expect(snap.days[7].name).toBe('Push')
  })

  it('says today is done once a workout from today covers it', () => {
    const w = { id: 'w1', d: TODAY, start: 1, end: 2, routineIds: ['r1'], entries: [] }
    expect(buildWidgetSnapshot(S({ workouts: [w] }), { today: TODAY }).days[0].done).toBe(true)
    const other = { ...w, routineIds: ['r2'] }
    expect(buildWidgetSnapshot(S({ workouts: [other] }), { today: TODAY }).days[0].done).toBe(false)
  })

  it('counts the week, the streak and names the last PR with its best weight', () => {
    const older = { id: 'w0', d: '2026-10-01', end: 1, prs: ['0043'], entries: [{ id: '0043', target: { mode: 'reps' }, sets: [{ w: 90, r: 5, done: true }] }] }
    const newer = { id: 'w1', d: '2026-10-13', end: 5, prs: ['0025'], entries: [{ id: '0025', target: { mode: 'reps' }, sets: [{ w: 62.5, r: 8, done: true }, { w: 65, r: 6, done: true }] }] }
    const snap = buildWidgetSnapshot(S({ workouts: [newer, older] }), { today: TODAY })
    expect(snap.week).toEqual({ done: 1, planned: 2 })
    expect(snap.weekFrom).toBe('2026-10-12')
    expect(snap.weekUntil).toBe('2026-10-19')
    expect(typeof snap.streak).toBe('number')
    expect(snap.lastPR).toMatchObject({ value: '65 kg', d: '2026-10-13' })
    expect(snap.lastPR.name).toBeTruthy()
    expect(buildWidgetSnapshot(S(), { today: TODAY }).lastPR).toBeNull()
  })

  it('shows a running workout, but not a saved one being edited', () => {
    const active = { id: 'a1', name: 'Push', start: 1000, entries: [{ id: '0025', sets: [{ done: true }, { done: false }, { done: false }] }] }
    expect(buildWidgetSnapshot(S({ active }), { today: TODAY }).active).toEqual({ id: 'a1', name: 'Push', start: 1000, done: 1, total: 3 })
    expect(buildWidgetSnapshot(S({ active: { ...active, editingWorkoutId: 'w9' } }), { today: TODAY }).active).toBeNull()
    expect(buildWidgetSnapshot(S(), { today: TODAY }).active).toBeNull()
  })

  it('carries the accent and its words, and stands up to a thin state', () => {
    const snap = buildWidgetSnapshot(S(), { today: TODAY })
    expect(snap.accent).toBe('#0a84ff')
    expect(snap.ink).toBe('#ffffff')
    expect(buildWidgetSnapshot(S({ accent: 'custom', accentCustom: '#123456' }), { today: TODAY }).accent).toBe('#123456')
    for (const k of ['today', 'restDay', 'upNext', 'thisWeek', 'weekStreak', 'streak', 'lastPR', 'done', 'running']) {
      expect(typeof snap.labels[k], k).toBe('string')
    }
    const thin = buildWidgetSnapshot({}, { today: TODAY })
    expect(thin.days.every(d => d.name === null)).toBe(true)
    expect(thin.week).toEqual({ done: 0, planned: 0 })
    // plain JSON all the way down
    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap)
  })
})

describe('startWidgetSync', () => {
  let state, subs, writes
  const useStore = {
    getState: () => ({ S: state }),
    subscribe: fn => { subs.push(fn); return () => {} },
  }
  beforeEach(() => {
    vi.useFakeTimers()
    state = S(); subs = []; writes = []
    _setWidgetPluginForTest({ write: async ({ json }) => { writes.push(JSON.parse(json)) } })
  })
  afterEach(() => { vi.useRealTimers(); _resetWidgets() })

  it('writes at start, then only when what the widgets show changed', async () => {
    const stop = await startWidgetSync({ useStore })
    await vi.runAllTimersAsync()
    expect(writes).toHaveLength(1)
    // a change to the state that leaves the snapshot as it was writes nothing
    const prev = state; state = { ...state }
    subs.forEach(fn => fn({ S: state }, { S: prev }))
    await vi.runAllTimersAsync()
    expect(writes).toHaveLength(1)
    const before = state; state = { ...state, routines: [{ ...push, name: 'Push heavy' }, legs] }
    subs.forEach(fn => fn({ S: state }, { S: before }))
    await vi.runAllTimersAsync()
    expect(writes).toHaveLength(2)
    expect(writes[1].days.some(d => d.name === 'Push heavy')).toBe(true)
    stop()
  })

  it('does nothing off the iPhone app', async () => {
    _resetWidgets()
    h.platform = 'android'
    const stop = await startWidgetSync({ useStore })
    await vi.runAllTimersAsync()
    expect(writes).toEqual([])
    stop()
    h.platform = 'ios'
  })
})
