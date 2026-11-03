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
    expect(snap.v).toBe(2)
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
    // #753: what is left of the plan rides along for the widgets
    expect(snap.weekLeft).toEqual({ left: 1, of: 2 })
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

describe('buildWidgetSnapshot: the configurable widget\'s blocks', () => {
  const wk = (d, extra = {}) => ({ id: 'w' + d, d, end: 1, entries: [], ...extra })
  it('carries the streak with its best run, freezes and whether this week is done', () => {
    // Mondays: 09-14, 09-21, 09-28, 10-05 trained (a freeze), 10-12 trained (this week)
    const ws = ['2026-09-16', '2026-09-23', '2026-09-30', '2026-10-07', '2026-10-13'].map(d => wk(d))
    const snap = buildWidgetSnapshot(S({ workouts: ws }), { today: TODAY })
    expect(snap.streak).toBe(5)
    expect(snap.streakInfo).toMatchObject({ current: 5, best: 5, freezes: 1, weekDone: true, next: 12 })
    expect(snap.streakInfo.line).toMatch(/5/)
  })

  it('has the weight goal: current, goal, how far, the last 7 weigh-ins', () => {
    const bodyweight = Array.from({ length: 9 }, (_, i) => ({ d: `2026-10-0${i + 1}`, w: 90 - i * 0.5 }))
    const snap = buildWidgetSnapshot(S({ bodyweight, targetW: 80 }), { today: TODAY })
    expect(snap.weight).toMatchObject({ current: 86, goal: 80, toGo: 6, unit: 'kg' })
    expect(snap.weight.trend).toEqual([89, 88.5, 88, 87.5, 87, 86.5, 86])
    expect(snap.weight.line).toMatch(/6 kg/)
    expect(buildWidgetSnapshot(S({ bodyweight, targetW: 86 }), { today: TODAY }).weight.toGo).toBe(0)
    expect(buildWidgetSnapshot(S({ bodyweight, unit: 'lb' }), { today: TODAY }).weight).toMatchObject({ goal: null, toGo: null, unit: 'lb' })
    expect(buildWidgetSnapshot(S(), { today: TODAY }).weight).toBeNull()
  })

  it('names the next workout with its routines: today until done, then the next planned day', () => {
    expect(buildWidgetSnapshot(S(), { today: TODAY }).next).toMatchObject({ name: 'Push', iso: TODAY, today: true, ids: ['r1'] })
    const done = wk(TODAY, { routineIds: ['r1'] })
    expect(buildWidgetSnapshot(S({ workouts: [done] }), { today: TODAY }).next).toMatchObject({ name: 'Legs', iso: '2026-10-16', today: false, ids: ['r2'] })
    expect(buildWidgetSnapshot(S({ week: {} }), { today: TODAY }).next).toBeNull()
  })

  it('counts the PRs of this month and the volume of this week against last week', () => {
    const set = (w, r) => ({ w, r, done: true })
    const ws = [
      wk('2026-09-30', { prs: ['0025'] }),
      wk('2026-10-02', { prs: ['0025', '0043'] }),
      wk('2026-10-07', { entries: [{ id: '0025', target: { mode: 'reps' }, sets: [set(100, 10)] }] }),
      wk('2026-10-13', { prs: ['0043'], entries: [{ id: '0043', target: { mode: 'reps' }, sets: [set(100, 5), set(100, 5), set(100, 2)] }] }),
    ]
    const snap = buildWidgetSnapshot(S({ workouts: ws }), { today: TODAY })
    expect(snap.records.month).toBe(3)
    expect(snap.records.last).toMatchObject({ d: '2026-10-13' })
    expect(snap.volume).toMatchObject({ now: 1200, prev: 1000, pct: 20, unit: 'kg' })
    expect(snap.volume.line).toMatch(/\+20%/)
    expect(buildWidgetSnapshot(S(), { today: TODAY }).volume).toMatchObject({ now: 0, prev: 0, pct: null })
  })

  it('leaves the level hook empty until points exist, and has every block\'s words', () => {
    const snap = buildWidgetSnapshot(S(), { today: TODAY })
    expect(snap.level).toBeNull()
    for (const k of ['weightGoal', 'nextWorkout', 'records', 'volume', 'freezes', 'nothingPlanned', 'noWeighIn', 'startNow']) {
      expect(typeof snap.labels[k], k).toBe('string')
    }
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

  it('writes on Android too, and nothing on any other platform', async () => {
    for (const [platform, n] of [['android', 1], ['web', 0]]) {
      _resetWidgets()
      writes = []
      h.platform = platform
      if (n) _setWidgetPluginForTest({ write: async ({ json }) => { writes.push(JSON.parse(json)) } })
      const stop = await startWidgetSync({ useStore })
      await vi.runAllTimersAsync()
      expect(writes, platform).toHaveLength(n)
      stop()
    }
    h.platform = 'ios'
  })

  it('debounces a burst of changes into one write', async () => {
    const stop = await startWidgetSync({ useStore })
    await vi.runAllTimersAsync()
    for (let i = 0; i < 5; i++) {
      const prev = state; state = { ...state, bodyweight: [...state.bodyweight, { d: '2026-10-1' + i, w: 80 - i }] }
      subs.forEach(fn => fn({ S: state }, { S: prev }))
      await vi.advanceTimersByTimeAsync(200)
    }
    await vi.runAllTimersAsync()
    expect(writes).toHaveLength(2)
    expect(writes[1].weight.current).toBe(76)
    stop()
  })
})
