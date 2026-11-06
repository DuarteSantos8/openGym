// @vitest-environment happy-dom
// Plan → Programmes (#159): the list, a starter added, a programme started through its activation
// sheet and ended, the running card (each exercise's week and try, what it waits for, closing a
// week), the week sheet, and the one-off notice of the programme-model upgrade.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const state = { S: null, sheets: [], navs: [], confirm: null, menu: null, toasts: [], params: {} }
  state.snapshot = () => ({
    S: state.S,
    update: mut => { const next = structuredClone(state.S); mut(next); state.S = next },
    dismissContractNotice: () => { const next = structuredClone(state.S); delete next.contractNotice; state.S = next },
  })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => (selector ? selector(mocks.snapshot()) : mocks.snapshot())
  useStore.getState = mocks.snapshot
  return { useStore }
})
vi.mock('../store/useUI.js', () => {
  const api = { openSheet: render => { mocks.sheets.push(render) }, toast: m => mocks.toasts.push(m) }
  const useUI = sel => (sel ? sel(api) : api)
  useUI.getState = () => api
  return { useUI }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => to => mocks.navs.push(to), useParams: () => mocks.params }))
vi.mock('../sheets.jsx', () => ({ confirmSheet: o => { mocks.confirm = o }, menuSheet: o => { mocks.menu = o }, exportProgrammeFile: vi.fn(), referenceSheet: vi.fn() }))

const { default: Programmes, ProgrammeEdit } = await import('./Programmes.jsx')
const { migratedFixture } = await import('../lib/test-fixtures.js')
const { legacyWeeksOf, setLegacyWeeks, startProgramme, programmeView } = await import('../lib/programmes.js')
const { buildSessionExposures } = await import('../lib/session-start.js')
const { entriesForExposures } = await import('../lib/session-ui-adapter.js')
const { buildCompletedSession } = await import('../lib/finish-session.js')
const { isWarmupRow } = await import('../lib/workout-model.js')

// A fixed clock (only Date is faked): Monday 00:30 local, the first minutes of a week, right after
// the EU clock change, where a UTC date would still say Sunday.
beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 9, 26, 0, 30)) })
afterAll(() => { vi.useRealTimers() })

let host, root
beforeEach(() => {
  // A v2 profile on engine contract 1, from v1 routines (r1 Push: bench; r2 Legs: squat).
  mocks.S = {
    ...migratedFixture({ unit: 'kg', weekStart: 1, workouts: [], routines: [{ id: 'r1', name: 'Push', ex: [{ id: '0025', sets: 3, reps: 5, weight: 60 }] }, { id: 'r2', name: 'Legs', ex: [{ id: '0043', sets: 3, reps: 5, weight: 80 }] }] }),
    exWeights: {}, dayPlan: {}, programmes: {}, programme: null, week: { 1: ['r1'] },
  }
  mocks.sheets = []; mocks.navs = []; mocks.confirm = null; mocks.menu = null; mocks.toasts = []; mocks.params = {}
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const render = el => act(() => root.render(el))
const button = text => [...host.querySelectorAll('button')].find(b => b.textContent.includes(text))
const click = el => act(() => el.click())
// The top sheet, drawn again over whatever the store holds now (the mock store does not re-render).
const close = vi.fn()
const sheet = () => render(mocks.sheets.at(-1)(close))
const sectionOf = title => [...host.querySelectorAll('section.sect')].find(x => x.querySelector('.sect-t')?.textContent === title)
const rowOf = (title, within = host) => [...within.querySelectorAll('.lrow')].find(r => r.querySelector('.lrow-t')?.textContent.startsWith(title))
const choice = (sect, row, label) => [...rowOf(row, sect ? sectionOf(sect) : host).querySelectorAll('button')].find(b => b.textContent === label || b.textContent.startsWith(label + ' ('))
const pick = (sect, row, label) => { click(choice(sect, row, label)); sheet() }
const pressed = (sect, row) => [...rowOf(row, sect ? sectionOf(sect) : host).querySelectorAll('button[aria-pressed="true"]')].map(b => b.textContent)
const startButton = () => [...host.querySelectorAll('button')].find(b => b.textContent === 'Start programme')
const runOf = () => Object.values(mocks.S.programmeRuns)[0]
// Every exercise answered at once, and an end chosen: what a start needs.
const answerAll = (missed = 'Move on', skipped = 'Repeat it', end = 'Stop') => {
  pick('For every exercise', 'After a missed week', missed)
  pick('For every exercise', 'After a skipped week', skipped)
  pick(null, 'When the weeks run out', end)
}

describe('the programme list', () => {
  it('adds a starter programme with its own routines and opens it', () => {
    render(<Programmes />)
    expect(host.textContent).toContain('No programmes yet.')
    click(button('Strength block, 4 weeks'))
    const [p] = Object.values(mocks.S.programmes)
    expect(p).toMatchObject({ src: 'strength-4', name: 'Strength block, 4 weeks', duration: { n: 4, unit: 'weeks' } })
    expect(legacyWeeksOf(p)[0].t['0043']).toEqual({ pct: 72.5 })
    expect(mocks.S.routines).toHaveLength(5)
    expect(mocks.S.week).toEqual({ 1: ['r1'] })
    expect(mocks.navs.at(-1)).toBe('/plan/prog/' + p.id)
  })

  it('makes a new one from the plan you have', () => {
    render(<Programmes />)
    click(button('New programme'))
    const [p] = Object.values(mocks.S.programmes)
    expect(p.schedule.appts).toEqual([{ rid: 'r1', day: 1 }])
    expect(p.duration.n).toBe(4)
  })
})

describe('a programme', () => {
  const seed = (days = { 3: ['r2'] }) => {
    mocks.S.programmes = { P: setLegacyWeeks({ id: 'P', name: 'Block', at: 1, rev: 1, end: 'stop', refs: 'inherit' }, [{ rpe: 7 }, {}], mocks.S, { days }) }
    mocks.params = { id: 'P' }
  }
  const weeks = () => legacyWeeksOf(mocks.S.programmes.P)

  it('starts through its sheet, shows where it stands, and ends with the plan back', () => {
    seed()
    render(<ProgrammeEdit />)
    expect(host.textContent).toContain('We Legs')
    click(startButton())
    sheet()
    answerAll()
    click(startButton())
    expect(mocks.S.week).toEqual({ 3: ['r2'] })
    expect(runOf()).toMatchObject({ end: 'stop', tracks: { 't:P:r2:o0': { policy: { onFailure: 'advance', onSkipped: 'repeat' }, ack: 'user' } } })
    expect(mocks.toasts).toEqual(['Week 1 starts now. Have fun!'])
    expect(close).toHaveBeenCalled()
    render(<ProgrammeEdit />)
    expect(host.textContent).toContain('Week 1 of 2')
    click(button('End programme'))
    // Ending asks about the weights reached; leaving the routines as they were.
    expect(mocks.menu.subtitle).toContain('Keep the weights you reached in your routines?')
    act(() => mocks.menu.items.find(i => i.label === 'Leave my routines as they were').onClick())
    expect(mocks.S.week).toEqual({ 1: ['r1'] })
    expect(mocks.S.programme).toBeNull()
  })

  it('changes its length with the stepper', () => {
    seed()
    render(<ProgrammeEdit />)
    click(host.querySelector('.prog-weeks button[aria-label="Increase Weeks"]'))
    expect(weeks()).toEqual([{ rpe: 7 }, {}, {}])
  })

  it('the week sheet sets a deload and an RPE', () => {
    seed({ 1: ['r1'] })
    render(<ProgrammeEdit />)
    click([...host.querySelectorAll('.lrow.tap')].find(r => r.textContent.startsWith('Week 2')))
    const sheet = mocks.sheets.at(-1)
    const close = vi.fn()
    render(sheet(close))
    click(host.querySelector('[role="switch"]'))
    expect(weeks()[1]).toEqual({ deload: true })
    render(sheet(close))
    click(button('RPE 8.5'))
    expect(weeks()[1]).toEqual({ deload: true, rpe: 8.5 })
    // The lift of its routine is there to get a %1RM.
    expect(host.querySelector('.prog-pct input')).not.toBeNull()
    render(sheet(close))
    click(button('Same as last week, a bit heavier'))
    expect(weeks()[1]).toEqual({ rpe: 7 })
  })

  it('delete asks first, and ends it when running', () => {
    seed()
    render(<ProgrammeEdit />)
    click(startButton())
    sheet()
    answerAll()
    click(startButton())
    render(<ProgrammeEdit />)
    click(button('Delete programme'))
    act(() => mocks.confirm.onConfirm())
    expect(mocks.S.programmes).toEqual({})
    expect(mocks.S.programme).toBeNull()
    expect(mocks.S.week).toEqual({ 1: ['r1'] })
  })
})

describe('the activation sheet', () => {
  // Two exercises on two days: bench on Monday's Push (a %1RM week), squat on Wednesday's Legs.
  const seed = (weeks = [{ t: { '0025': { pct: 75 } } }, {}], schedule = { days: { 1: ['r1'], 3: ['r2'] } }, more = {}) => {
    mocks.S.programmes = { P: { ...setLegacyWeeks({ id: 'P', name: 'Block', at: 1, rev: 1, end: 'stop', refs: 'inherit' }, weeks, mocks.S, schedule), ...more } }
    mocks.params = { id: 'P' }
    render(<ProgrammeEdit />)
    click(startButton())
    sheet()
  }
  const status = () => host.querySelector('[role="status"]')?.textContent ?? ''

  it('Start stays disabled until every exercise has both choices and an end choice; the default is marked, not chosen', () => {
    mocks.S.programmeEnd = 'extend'
    seed()
    expect(startButton().disabled).toBe(true)
    expect(status()).toBe('Choose both answers for every exercise. Choose what happens when the weeks run out.')
    // Nothing is chosen for you: no answer pressed, the Config default only marked.
    expect(pressed('For every exercise', 'After a missed week')).toEqual([])
    expect(pressed(null, 'When the weeks run out')).toEqual([])
    expect(choice(null, 'When the weeks run out', 'Keep going until every goal is reached (your default)')).toBeTruthy()
    // …and nothing looks chosen either: no segment is raised until one is picked.
    expect(rowOf('When the weeks run out').querySelector('.seg-sel')).toBeNull()
    expect(rowOf('After a missed week', sectionOf('For every exercise')).querySelector('.seg-sel')).toBeNull()
    pick('Barbell Bench Press', 'After a missed week', 'Move on')
    pick('Barbell Bench Press', 'After a skipped week', 'Move on')
    expect(startButton().disabled).toBe(true)   // squat has no answer yet
    pick('Barbell Full Squat', 'After a missed week', 'Repeat it')
    pick('Barbell Full Squat', 'After a skipped week', 'Repeat it')
    expect(status()).toBe('Choose what happens when the weeks run out.')
    click(startButton())
    expect(mocks.S.programmeRuns).toBeUndefined()   // a disabled Start starts nothing
    pick(null, 'When the weeks run out', 'Stop')
    expect(startButton().disabled).toBe(false)
    expect(rowOf('When the weeks run out').querySelector('.seg-sel')).not.toBeNull()
    expect(status()).toBe('')
    click(startButton())
    expect(runOf()).toMatchObject({ end: 'stop', tracks: {
      't:P:r1:o0': { policy: { onFailure: 'advance', onSkipped: 'advance' }, ack: 'user' },
      't:P:r2:o0': { policy: { onFailure: 'repeat', onSkipped: 'repeat' }, ack: 'user' } } })
  })

  it('For every exercise sets all rows; changing one row afterwards keeps the others', () => {
    seed()
    pick('For every exercise', 'After a missed week', 'Repeat it')
    expect(pressed('Barbell Bench Press', 'After a missed week')).toEqual(['Repeat it'])
    expect(pressed('Barbell Full Squat', 'After a missed week')).toEqual(['Repeat it'])
    pick('Barbell Bench Press', 'After a missed week', 'Move on')
    expect(pressed('Barbell Full Squat', 'After a missed week')).toEqual(['Repeat it'])
    // Mixed answers: the row on top shows none, and stays there to set them all again.
    expect(pressed('For every exercise', 'After a missed week')).toEqual([])
    pick('For every exercise', 'After a skipped week', 'Move on')
    pick(null, 'When the weeks run out', 'Keep going until every goal is reached')
    click(startButton())
    expect(runOf()).toMatchObject({ end: 'extend', tracks: {
      't:P:r1:o0': { policy: { onFailure: 'advance', onSkipped: 'advance' } }, 't:P:r2:o0': { policy: { onFailure: 'repeat', onSkipped: 'advance' } } } })
  })

  it('the effort-off, binding and repair rows appear only for their missing reason; the 1RMs to keep are always listed', () => {
    mocks.S.oneRepMaxes = { b1: { id: 'b1', exerciseId: '0025', value: 100, unit: 'kg', source: 'estimated', capturedAt: '2026-10-20T10:00:00.000Z' } }
    seed()
    expect(rowOf('Turn on effort per set in Settings')).toBeUndefined()
    expect(rowOf('Choose how to count the weeks for this rotation')).toBeUndefined()
    expect(rowOf('Fix in the editor')).toBeUndefined()
    // Only the %1RM lift is listed, with the 1RM it keeps.
    expect([...sectionOf('The 1RM each lift keeps').querySelectorAll('.lrow')].map(r => r.textContent)).toEqual(['Barbell Bench Press100 kg, estimated 20 Oct'])
    expect(host.textContent).toContain('Sessions can move to another day of the same week')
    expect(host.textContent).not.toContain('Skipping ahead')

    // No 1RM yet: said, and it does not block the start.
    mocks.S.oneRepMaxes = {}
    sheet()
    expect(sectionOf('The 1RM each lift keeps').textContent).toContain('No 1RM yet: your first session asks for one')

    // Operational effort with effort logging off.
    const def = mocks.S.programmes.P
    def.tracks[1].stages[0].targets['r2:o0'] = { own: 'inherit', effort: { mode: 'operational', rpe: 8 } }
    sheet()
    answerAll()
    expect(status()).toBe('Turn on effort per set in Settings')
    click(rowOf('Turn on effort per set in Settings'))
    expect(mocks.navs.at(-1)).toBe('/settings/workout')

    // A loop waiting for its binding: choosing rounds makes it a rotation, with its own words.
    seed([{}, {}], { sequence: ['r1', 'r2'] })
    answerAll()
    expect(status()).toBe('Choose how to count the weeks for this rotation')
    pick(null, 'Choose how to count the weeks for this rotation', 'By rounds, any days')
    expect(rowOf('Choose how to count the weeks for this rotation')).toBeTruthy()   // still there to change
    expect(host.textContent).toContain('Skipping ahead counts the sessions in between as skipped')
    expect(host.textContent).not.toContain('Sessions can move')
    pick('For every exercise', 'After a missed round', 'Move on')
    pick('For every exercise', 'After a skipped round', 'Move on')
    pick(null, 'When the rounds run out', 'Stop')
    click(startButton())
    expect(mocks.S.programmes.P).toMatchObject({ schedule: { mode: 'rotation', sequence: ['r1', 'r2'] }, duration: { n: 2, unit: 'blocks' } })
    expect(mocks.S.programmes.P.needs).toBeUndefined()
    expect(mocks.toasts.at(-1)).toBe('Round 1 starts now. Have fun!')

    // A programme waiting on a repair.
    mocks.S.programme = null
    seed(undefined, undefined, { needs: ['repair'] })
    expect(rowOf('Fix in the editor')).toBeTruthy()
    expect(rowOf('Choose how to count the weeks for this rotation')).toBeUndefined()
    answerAll()
    expect(status()).toBe('Fix in the editor')
  })

  it('a first week under way owes the sessions from today on, and an earlier one can be added back', () => {
    vi.setSystemTime(new Date(2026, 9, 28, 9, 0))   // Wednesday
    seed()
    expect(rowOf('This week:').textContent).toBe('This week: Wednesday’s Legs')
    click(rowOf('Also do Monday’s Push this week').querySelector('[role="switch"]'))
    sheet()
    answerAll()
    click(startButton())
    expect(runOf().firstWeek).toEqual([0, 1])
    vi.setSystemTime(new Date(2026, 9, 26, 0, 30))
  })
})

describe('the running card', () => {
  const REPEAT = { onFailure: 'repeat', onSkipped: 'repeat' }
  // Bench on Monday's Push, squat on Wednesday's Legs with an RPE 8 that decides the week.
  const running = (startedOn, more = {}) => {
    const def = setLegacyWeeks({ id: 'P', name: 'Block', at: 1, rev: 1, end: 'stop', refs: 'inherit' }, [{}, {}], mocks.S, { days: { 1: ['r1'], 3: ['r2'] } })
    def.tracks[1].stages[0].targets['r2:o0'] = { own: 'inherit', effort: { mode: 'operational', rpe: 8 } }
    mocks.S = { ...mocks.S, effort: 'rir', programmes: { P: def }, ...more }
    const s = structuredClone(mocks.S)
    expect(startProgramme(s, 'P', { policies: { 't:P:r1:o0': REPEAT, 't:P:r2:o0': REPEAT }, end: 'stop', today: startedOn, now: Date.parse(startedOn + 'T08:00:00') })).toEqual({ ok: true })
    mocks.S = s
  }
  // Routine `rid` done on `day` as prescribed, every work set ticked without an effort.
  const logged = (rid, day) => {
    vi.setSystemTime(new Date(day + 'T10:00:00'))
    const s = structuredClone(mocks.S)
    const exposures = buildSessionExposures(s, s.routines.find(r => r.id === rid), { now: Date.now(), newId: x => x })
    const A = { id: 'w' + day, d: day, start: Date.now(), routineIds: [rid], exposures, entries: entriesForExposures(exposures, s.prescriptions) }
    A.entries.forEach(e => e.sets.forEach(row => { if (!isWarmupRow(row)) row.done = true }))
    s.workouts = [...s.workouts, buildCompletedSession(A, s, { end: A.start + 3600000, newId: x => x, unit: 'kg' }).session]
    mocks.S = s
    vi.setSystemTime(new Date(2026, 9, 26, 0, 30))
  }

  it('running card shows calendar week, training week and try per exercise, and the held reason with Count it as missed', () => {
    running('2026-10-19')
    logged('r2', '2026-10-21')   // Wednesday's squat, no effort logged
    render(<Programmes />)
    const card = host.querySelector('.prog-run')
    expect(card.querySelector('.tag').textContent).toBe('Week 2 of 2')
    // Monday's bench went unattempted: skipped, so repeated. Squat waits for its effort.
    expect(card.textContent).toContain('Barbell Bench Press · Training week 1 · second try')
    expect(card.textContent).toContain('Barbell Full Squat · Waiting for effort on Wednesday’s set')
    click(button('Count it as missed'))
    expect(Object.values(mocks.S.programmeEvents).filter(e => e.type === 'resolve')).toEqual([expect.objectContaining({ slot: 'p1:a1:r2:o0', as: 'failed' })])
    render(<Programmes />)
    expect(host.textContent).toContain('Barbell Full Squat · Training week 1 · second try')
    expect(button('Count it as missed')).toBeUndefined()
  })

  it('Close this week lists the sessions that will count as skipped before confirming', () => {
    running('2026-10-26')
    render(<Programmes />)
    expect(host.textContent).toContain('Still open this week: Monday’s Push, Wednesday’s Legs')
    click(button('Close this week'))
    expect(mocks.confirm).toMatchObject({ title: 'Close this week?', message: 'These count as skipped: Monday’s Push, Wednesday’s Legs', confirmText: 'Close this week' })
    expect(mocks.S.programmeEvents).toBeUndefined()   // nothing until confirmed
    act(() => mocks.confirm.onConfirm())
    expect(Object.values(mocks.S.programmeEvents)).toEqual([expect.objectContaining({ type: 'close', period: 1 })])
    expect(Object.values(programmeView(mocks.S).tracks).map(tv => tv.decisions[0]?.action)).toEqual(['repeat', 'repeat'])
  })

  it('reads a stopped run apart from one with every goal reached', () => {
    running('2026-10-05')   // two weeks long, both gone by: stopped, nothing reached
    render(<Programmes />)
    expect(host.textContent).toContain('Stopped after week 2. Barbell Bench Press did not reach its goal. Barbell Full Squat did not reach its goal.')
    expect(host.textContent).not.toContain('Every goal reached.')
  })
})

describe('the upgrade notice', () => {
  it('adoption notice lists the summary once and stays dismissed', () => {
    mocks.S.contractNotice = [
      { kind: 'legacy-choices', runId: 'run:x', policy: { onFailure: 'advance', onSkipped: 'advance' }, end: 'stop' },
      { kind: 'reference', runId: 'run:x', trackId: 't', exerciseId: '0025', ref: { id: 'b', exerciseId: '0025', value: 100, unit: 'kg', source: 'estimated', capturedAt: '2026-11-03T08:00:00.000Z' } },
      { kind: 'reference', occurrenceId: 'r1:o0', exerciseId: '0025', ref: { id: 'b', exerciseId: '0025', value: 100, unit: 'kg', source: 'estimated', capturedAt: '2026-11-03T08:00:00.000Z' } },
      { kind: 'reference-missing', occurrenceId: 'r2:o0', exerciseId: '0043' },
    ]
    render(<Programmes />)
    expect(host.textContent).toContain('Your running programme moves on each week as before; choose differently any time')
    expect(host.textContent).toContain('Barbell Bench Press: 100 kg, estimated 3 Nov')
    expect(host.textContent.match(/Barbell Bench Press: 100 kg/g)).toHaveLength(1)   // each lift once
    expect(host.textContent).toContain('Barbell Full Squat: No 1RM yet: your first session asks for one')
    click(button('Got it'))
    expect(mocks.S.contractNotice).toBeUndefined()
    render(<Programmes />)
    expect(host.textContent).not.toContain('choose differently any time')
  })
})
