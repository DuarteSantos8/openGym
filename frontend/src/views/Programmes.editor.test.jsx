// @vitest-environment happy-dom
// The programme editor (spec 14): the schedule in calendar weeks or rounds, every training week of
// every exercise (StageSheet) with the fields of its mode, where each value comes from, the
// choices a kept progression needs, links and templates. What it saves is read back from the store.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const state = { S: null, sheets: [], navs: [], menu: null, toasts: [], params: {} }
  state.snapshot = () => ({ S: state.S, update: mut => { const next = structuredClone(state.S); mut(next); state.S = next } })
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
vi.mock('../sheets.jsx', () => ({ confirmSheet: vi.fn(), menuSheet: o => { mocks.menu = o }, exportProgrammeFile: vi.fn(), referenceSheet: vi.fn() }))

const { ProgrammeEdit } = await import('./Programmes.jsx')
const { bindUI } = await import('../components/ui.jsx')
bindUI((await import('../store/useUI.js')).useUI)
const { legacyProgramme, migratedFixture } = await import('../lib/test-fixtures.js')
const { applyTemplate, setTrackChoice, startProgramme } = await import('../lib/programmes.js')
const { defaultPlanRule } = await import('../lib/prescription/index.js')
const { exerciseNameText } = await import('../lib/format.js')
const { EXIDX } = await import('../lib/exercises.js')

beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 9, 26, 9, 0)) })
afterAll(() => { vi.useRealTimers() })

const BENCH = '0025', SQUAT = '0043', PLANK = '0463', TREADMILL = '2259', PUSHUP = '0662'
let host, root
beforeEach(() => {
  mocks.S = {
    ...migratedFixture({ unit: 'kg', weekStart: 1, workouts: [], routines: [
      { id: 'r1', name: 'Push', ex: [{ id: BENCH, sets: 3, reps: 12, prog: 'double', repsMin: 8, weight: 50 }] },
      { id: 'r2', name: 'Legs', ex: [{ id: SQUAT, sets: 3, reps: 5, weight: 80 }] },
      { id: 'r3', name: 'Upper', ex: [{ id: BENCH, sets: 3, reps: 5, weight: 60 }] },
      { id: 'r4', name: 'Core', ex: [{ id: PLANK, mode: 'time', sets: 3, sec: 30 }, { id: PUSHUP, sets: 3, reps: 10 }] },
      { id: 'r5', name: 'Run', ex: [{ id: TREADMILL, mode: 'cardio', sets: 1, min: 20, speed: 8, incline: 1 }] },
    ] }),
    effort: 'rir', exWeights: {}, dayPlan: {}, programmes: {}, programme: null, week: { 1: ['r1'] },
  }
  mocks.sheets = []; mocks.navs = []; mocks.menu = null; mocks.toasts = []; mocks.params = { id: 'P' }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

const seed = (days = { 1: ['r1'], 3: ['r2'] }, weeks = [{}, {}, {}], more = d => d) => {
  mocks.S.programmes = { P: more(legacyProgramme(mocks.S, { id: 'P', name: 'Block', at: 1, weeks, days })) }
}
const def = () => mocks.S.programmes.P
const trackOf = exId => def().tracks.find(t => t.exerciseId === exId)
const render = el => act(() => root.render(el))
const click = el => act(() => el.click())
const buttons = () => [...host.querySelectorAll('button')]
const button = text => buttons().find(b => b.textContent.trim() === text)
const rows = () => [...host.querySelectorAll('.lrow')]
const rowOf = title => rows().find(r => r.querySelector('.lrow-t')?.textContent.startsWith(title))
const sectionOf = title => [...host.querySelectorAll('section.sect')].find(x => x.querySelector('.sect-t')?.textContent.startsWith(title))
const labels = () => [...host.querySelectorAll('.stp-l')].map(l => l.textContent)
const status = () => host.querySelector('[role="status"]')?.textContent ?? ''
// The editor page, and the sheet on top of it, drawn again over what the store holds now.
const page = () => render(<ProgrammeEdit />)
const sheet = () => render(mocks.sheets.at(-1)(vi.fn()))
// An exercise's card, by its name; week n of it opens its StageSheet.
const cardOf = exId => [...host.querySelectorAll('section.sect')].find(x => x.querySelector('.sect-t')?.textContent.startsWith(exerciseNameText(EXIDX[exId]) + ' · '))
const openWeek = (exId, n) => {
  page()
  const card = cardOf(exId)
  click([...card.querySelectorAll('.lrow')].find(r => r.querySelector('.lrow-t').textContent.endsWith(` ${n}`)))
  sheet()
}
// A picker row (PickRow or SelectRow): its sheet on a host of its own, the option tapped, the sheet under it drawn again.
const choose = (title, label) => {
  click(rowOf(title))
  const top = document.createElement('div'); document.body.appendChild(top)
  const r = createRoot(top)
  act(() => r.render(mocks.sheets.pop()(() => {})))
  click([...top.querySelectorAll('button.lrow')].find(b => b.querySelector('.lrow-t')?.textContent === label))
  act(() => r.unmount()); top.remove()
  sheet()
}
const segment = label => click(button(label))
const toggle = title => { click(rowOf(title).querySelector('[role="switch"]')); sheet() }

describe('the schedule', () => {
  it('switching to Rotation hides weekdays and renames weeks to rounds', () => {
    seed()
    page()
    expect(rowOf('Push').querySelector('.lrow-s').textContent).toBe('Monday')
    expect(rowOf('Weeks')).toBeTruthy()
    expect(host.textContent).toContain('Week 3')
    click(button('Rotation'))
    expect(def()).toMatchObject({ schedule: { mode: 'rotation', sequence: ['r1', 'r2'] }, duration: { n: 3, unit: 'blocks' } })
    page()
    for (const day of ['Monday', 'Wednesday', 'No preferred day', 'In this order']) expect(host.textContent).not.toContain(day)
    expect(rowOf('Rounds')).toBeTruthy()
    expect(rowOf('Weeks')).toBeUndefined()
    expect(host.textContent).toContain('Round 3')
    expect(host.textContent).not.toMatch(/Week \d/)
    expect(sectionOf('Schedule').textContent).toContain('A round is one pass through the list')
  })

  it('a loop waiting for its binding is bound here, to weeks in its order or to rounds, and the need is gone', () => {
    mocks.S.programmes = { P: legacyProgramme(mocks.S, { id: 'P', name: 'Loop', at: 1, weeks: [{}, {}], sequence: ['r1', 'r2'] }) }
    expect(def().needs).toEqual(['binding'])
    page()
    expect(rowOf('Choose how to count the weeks for this rotation')).toBeTruthy()
    // Nothing is chosen for you: no segment raised.
    expect(sectionOf('Schedule').querySelector('.seg-sel')).toBeNull()
    click(button('Calendar weeks'))
    expect(def().needs).toBeUndefined()
    expect(def().schedule).toEqual({ mode: 'weeks', appts: [{ rid: 'r1' }, { rid: 'r2' }], ordered: true })
    page()
    expect(rowOf('Choose how to count the weeks for this rotation')).toBeUndefined()
    // The other answer, on a fresh loop: a free rotation counted in rounds.
    mocks.S.programmes = { P: legacyProgramme(mocks.S, { id: 'P', name: 'Loop', at: 1, weeks: [{}, {}], sequence: ['r1', 'r2'] }) }
    page()
    click(button('Rotation'))
    expect(def()).toMatchObject({ schedule: { mode: 'rotation', sequence: ['r1', 'r2'] }, duration: { n: 2, unit: 'blocks' } })
    expect(def().needs).toBeUndefined()
  })

  it('an edit that breaks the programme is refused: the saved one stays and the reason shows', () => {
    seed({ 1: ['r1'] })
    const before = structuredClone(def())
    page()
    click(rowOf('Push'))
    act(() => mocks.menu.items.find(i => i.label === 'Remove').onClick())
    expect(def()).toEqual(before)
    expect(mocks.toasts).toEqual(['Add a routine with exercises to the schedule.'])
  })
})

describe('a training week (StageSheet)', () => {
  it('Set reveals only the fields of the exercise mode; cardio shows speed and incline, timed shows seconds', () => {
    seed({ 1: ['r1'], 3: ['r4'], 5: ['r5'] })
    openWeek(BENCH, 1)
    expect(labels()).toEqual([])   // following its progression: nothing to set
    segment('Set the targets')
    expect(labels()).toEqual(['Sets', 'Reps from', 'Reps to', 'Load', 'Rest (s)'])
    openWeek(PLANK, 1)
    segment('Set the targets')
    expect(labels()).toEqual(['Sets', 'Seconds', 'Load', 'Rest (s)'])
    openWeek(TREADMILL, 1)
    segment('Set the targets')
    expect(labels()).toEqual(['Intervals', 'Minutes', 'Speed (km/h)', 'Incline (%)', 'Recovery'])
    expect(host.textContent).not.toContain('Keep progressing')
  })

  it('fixing the load of a kept reps progression requires the top-of-range choice before saving', () => {
    seed({ 1: ['r1'] }, [{}], d => applyTemplate(d, d.tracks[0].id, 'copy', { S: mocks.S }))
    const before = structuredClone(def())
    openWeek(BENCH, 1)
    expect(rowOf('Keep progressing reps')).toBeTruthy()
    toggle('Keep progressing reps')
    expect(rowOf('Keep progressing reps').querySelector('.lrow-s').textContent).toBe('8 to 12, +1 after a good session')
    expect(button('Save').disabled).toBe(true)
    expect(status()).toBe('Choose what happens at the top of the range.')
    expect(button('Save').getAttribute('aria-describedby')).toBe(host.querySelector('[role="status"]').id)
    click(button('Save'))
    expect(def()).toEqual(before)   // nothing saved yet
    expect(rowOf('At the top').querySelector('.lrow-s')).toBeNull()
    choose('At the top', 'Stay there')
    expect(button('Save').disabled).toBe(false)
    click(button('Save'))
    const ph = trackOf(BENCH).stages[0].targets['r1:o0'].phase
    expect(ph.progression).toEqual([expect.objectContaining({ metric: 'reps', step: 1, resetOnCarry: false })])
    expect(ph.parameters.load).toEqual({ mode: 'absolute', value: 50, unit: 'kg' })
    expect(ph.target).toEqual({ mode: 'none' })
  })

  it('a newly progressing load asks where to start and saves the seed', () => {
    seed({ 1: ['r1'] }, [{}, {}], d => applyTemplate(d, d.tracks[0].id, 'copy', { S: mocks.S }))
    openWeek(BENCH, 2)
    toggle('Keep progressing load')
    expect(rowOf('Keep progressing load').querySelector('.lrow-s').textContent).toBe('+2.5 kg after a good session')
    expect(button('Save').disabled).toBe(true)
    expect(status()).toBe('Choose where this week starts.')
    expect(sectionOf('Week 2 starts from')).toBeTruthy()
    choose('Load', 'Type a value')
    click(sectionOf('Week 2 starts from').querySelector('button[aria-label="Increase Load"]'))
    sheet()
    click(button('Save'))
    expect(trackOf(BENCH).stages[1].targets['r1:o0']).toMatchObject({ own: 'set', seed: { load: 52.5 }, phase: { progression: [expect.objectContaining({ metric: 'load' })] } })
    // Or from where week 1 left it.
    openWeek(BENCH, 2)
    choose('Load', 'Week 1')
    click(button('Save'))
    expect(trackOf(BENCH).stages[1].targets['r1:o0'].seed).toEqual({ load: 'copy' })
  })

  it('Decides progress is disabled when effort logging is off, with the reason', () => {
    mocks.S.effort = 'none'
    seed({ 1: ['r3'] })
    openWeek(BENCH, 1)
    // Effort logging off: shown as RPE.
    choose('Effort', 'RPE 8')
    const decide = () => button('Decides progress')
    expect(decide().disabled).toBe(true)
    const why = document.getElementById(decide().getAttribute('aria-describedby'))
    expect(why.textContent).toBe('Turn on effort per set in Settings')
    expect(button('For reference').getAttribute('aria-pressed')).toBe('true')
    click(button('Save'))
    expect(trackOf(BENCH).stages[0].targets['r3:o0'].effort).toEqual({ mode: 'advisory', rpe: 8 })
    // On again, it decides; and a week whose every set goes to failure cannot.
    mocks.S.effort = 'rir'
    openWeek(BENCH, 1)
    expect(decide().disabled).toBe(false)
    click(decide()); sheet()
    click(button('All')); sheet()
    expect(decide().disabled).toBe(false)   // chosen already: it stays, and Save says why
    expect(status()).toBe('Every set this week is AMRAP or to failure, so effort cannot decide progress.')
    expect(button('Save').disabled).toBe(true)
    click(button('For reference')); sheet()
    expect(decide().disabled).toBe(true)
    expect(document.getElementById(decide().getAttribute('aria-describedby')).textContent).toBe('Every set this week is AMRAP or to failure, so effort cannot decide progress.')
  })

  it('copy and move keep stage ids; an invalid edit keeps the old definition and shows why', () => {
    seed({ 1: ['r3'] }, [{ t: { [BENCH]: { pct: 70 } } }, { t: { [BENCH]: { pct: 75 } } }, { t: { [BENCH]: { pct: 80 } } }])
    const id = trackOf(BENCH).id
    openWeek(BENCH, 3)
    choose('Copy from', 'Week 1')
    click(button('Move up')); sheet()
    click(button('Save'))
    const stages = trackOf(BENCH).stages
    expect(stages.map(s => s.id)).toEqual(['s1', 's3', 's2'])
    expect(stages[1].targets['r3:o0'].phase.parameters.load).toEqual({ mode: 'percent_1rm', percent: 70 })
    expect(trackOf(BENCH).id).toBe(id)
    // Week 2 back to its progression after a fixed week 1: where it starts is not said, so it is
    // refused and the saved weeks stay as they were.
    const before = structuredClone(def())
    openWeek(BENCH, 2)
    segment('Follow my progression'); sheet()
    expect(status()).toBe('Choose where this week starts.')
    expect(button('Save').disabled).toBe(true)
    click(button('Save'))
    expect(def()).toEqual(before)
  })

  it('a week of a lift that cannot take a dropset offers none; cardio weeks keep their own incline', () => {
    seed({ 1: ['r1'], 3: ['r4'], 5: ['r5'] })
    openWeek(BENCH, 1)
    expect(rowOf('Drop-set')).toBeTruthy()
    openWeek(PUSHUP, 1)
    expect(rowOf('Drop-set')).toBeUndefined()
    expect(rowOf('Rest-pause')).toBeUndefined()
    // The treadmill's weeks: 2 % then 3 %; the routine keeps its own 1 %.
    const incline = (n, to) => {
      openWeek(TREADMILL, n)
      segment('Set the targets')
      const field = [...host.querySelectorAll('.stp-w')].find(w => w.querySelector('.stp-l').textContent === 'Incline (%)')
      for (let v = 1; v < to; v += 0.5) { click(field.querySelector('button[aria-label="Increase"]')); sheet() }
      click(button('Save'))
    }
    incline(1, 2)
    incline(2, 3)
    const tr = trackOf(TREADMILL)
    expect(tr.stages.map(st => st.targets['r5:o0'].options?.incline)).toEqual([2, 3, undefined])
    expect(mocks.S.routines.find(r => r.id === 'r5').ex[0].cardio.incline).toBe(1)
  })

  it('an edit of one week keeps every other week, a Coach-set one included, and every exercise\'s choices', () => {
    seed({ 1: ['r3'], 3: ['r2'] }, [{ t: { [BENCH]: { pct: 75 } } }, {}, {}])
    const id = trackOf(BENCH).id
    mocks.S.programmes.P = setTrackChoice(def(), id, { policy: { onFailure: 'repeat', onSkipped: 'advance' }, refs: 'keep', tm: { value: 100, unit: 'kg' } })
    const week1 = structuredClone(trackOf(BENCH).stages[0]), squat = structuredClone(trackOf(SQUAT))
    openWeek(BENCH, 3)
    segment('Rest'); sheet()
    click(button('Save'))
    expect(trackOf(BENCH).stages[0]).toEqual(week1)
    expect(trackOf(BENCH).stages[2]).toMatchObject({ kind: 'rest' })
    expect(trackOf(BENCH)).toMatchObject({ policy: { onFailure: 'repeat', onSkipped: 'advance' }, refs: 'keep', tm: { value: 100, unit: 'kg' } })
    expect(trackOf(SQUAT)).toEqual(squat)
    // The card says what each week sets, and where it comes from.
    page()
    expect(rowOf('Week 1').querySelector('.lrow-s').textContent).toBe('3 × 5 · 75% of 1RM Set')
    expect(rowOf('Week 2').querySelector('.lrow-s').textContent).toBe('Follow my progression Progressing')
  })
})

describe('exercises', () => {
  it('linking is offered only for the same exercise and load meaning', () => {
    seed({ 1: ['r3'], 3: ['r2'], 4: ['r1'] })
    page()
    const link = 'Count Barbell Bench Press in Monday’s Upper and in Thursday’s Push as one'
    expect(rows().filter(r => r.textContent.startsWith('Count '))).toHaveLength(1)
    expect(rowOf(link)).toBeTruthy()
    click(rowOf(link))
    const bench = def().tracks.filter(t => t.exerciseId === BENCH)
    expect(bench).toHaveLength(1)
    expect(bench[0].slots).toEqual([{ rid: 'r3', oid: 'r3:o0' }, { rid: 'r1', oid: 'r1:o0' }])
    // The same bench counted per dumbbell in one of them: not the same load meaning, nothing offered.
    seed({ 1: ['r3'], 4: ['r1'] })
    mocks.S.routines = mocks.S.routines.map(r => (r.id === 'r1' ? { ...r, ex: r.ex.map(o => ({ ...o, dbLoad: 'each' })) } : r))
    page()
    expect(rows().filter(r => r.textContent.startsWith('Count '))).toHaveLength(0)
  })

  it('5/3/1 template fills four weeks at 65/75/85, 70/80/90, 75/85/95 and 40/50/60 % of the training max', () => {
    mocks.S.oneRepMaxes = { b1: { id: 'b1', exerciseId: BENCH, value: 100, unit: 'kg', source: 'estimated', capturedAt: '2026-10-20T10:00:00.000Z' } }
    seed({ 1: ['r3'] }, [{}, {}, {}, {}])
    const ids = trackOf(BENCH).stages.map(st => st.id)
    page()
    click(rowOf('Fill from a template'))
    expect(mocks.menu.items.map(i => i.label)).toEqual(['5/3/1 by week (needs a training max)', 'Same work every week'])
    act(() => mocks.menu.items[0].onClick())
    sheet()
    expect([...host.querySelectorAll('.stp-l')].map(l => l.textContent)).toEqual(['Training max'])
    expect(host.querySelector('.stp input').value).toBe('90')
    click(button('Fill in'))
    const tr = trackOf(BENCH)
    expect(tr.stages.map(st => st.id)).toEqual(ids)
    expect(tr.stages.map(st => st.targets['r3:o0'].phase.groups.map(g => g.load.percent))).toEqual([[65, 75, 85], [70, 80, 90], [75, 85, 95], [40, 50, 60]])
    expect(tr.stages.map(st => st.kind)).toEqual(['work', 'work', 'work', 'recovery'])
    expect(tr.tm).toEqual({ value: 90, unit: 'kg', increment: 2.5 })
    page()
    expect(rowOf('Week 1').querySelector('.lrow-s').textContent).toBe('1 × 5 · 65% of training max Set · 1 × 5 · 75% of training max Set · 1 × 5+ · 85% of training max Set')
    // A plank has no training max to take: the menu offers only the other template.
    seed({ 3: ['r4'] })
    page()
    click([...cardOf(PLANK).querySelectorAll('.lrow')].find(r => r.textContent === 'Fill from a template'))
    expect(mocks.menu.items.map(i => i.label)).toEqual(['Same work every week'])
  })
})

describe('fix round 1', () => {
  it('a recovery week says whether it needs its sessions done or passes with the week, and saves the choice', () => {
    seed({ 1: ['r3'] })
    openWeek(BENCH, 3)
    segment('Recovery'); sheet()
    expect(button('Needs its sessions done').getAttribute('aria-pressed')).toBe('true')
    click(button('Passes with the week')); sheet()
    click(button('Save'))
    expect(trackOf(BENCH).stages[2]).toMatchObject({ kind: 'recovery', close: 'calendar' })
    openWeek(BENCH, 3)
    expect(button('Passes with the week').getAttribute('aria-pressed')).toBe('true')
    expect(button('Needs its sessions done').closest('[role="group"]').getAttribute('aria-label')).toBe('Recovery')
  })

  it('calendar weeks with no preferred day can start, and run as the loop of their sessions', () => {
    seed({ 1: ['r1'], 3: ['r2'] })
    mocks.S.programmes.P = { ...def(), schedule: { mode: 'weeks', appts: [{ rid: 'r1' }, { rid: 'r2' }] } }
    page()
    expect(button('Start programme').disabled).toBe(false)
    click(button('Start programme'))
    sheet()
    for (const row of ['After a missed week', 'After a skipped week']) click([...rowOf(row).querySelectorAll('button')].find(b => b.textContent === 'Move on'))
    sheet()
    choose('When the weeks run out', 'Stop')
    click(button('Start programme'))
    expect(Object.values(mocks.S.programmeRuns)).toHaveLength(1)
    expect(mocks.S.rotation.sequence).toEqual(['r1', 'r2'])
  })

  it('with nothing to start from, Start says why', () => {
    seed({ 1: ['r1'] })
    mocks.S.programmes.P = { ...def(), schedule: { mode: 'weeks', appts: [] }, needs: ['repair'] }
    page()
    const start = button('Start programme')
    expect(start.disabled).toBe(true)
    expect(document.getElementById(start.getAttribute('aria-describedby')).textContent).toBe('Add a routine with exercises to the schedule.')
  })

  it('a programme waiting on a repair names each exercise; an edit keeps the wait, I checked these ends it', () => {
    seed({ 1: ['r3'] })
    const o = mocks.S.routines.find(r => r.id === 'r3').ex[0]
    o.rule = { ...defaultPlanRule('five_three_one', { id: o.rule.id, exerciseId: BENCH, routineId: 'r3', unit: 'kg' }), revision: 1 }
    mocks.S.programmes = { P: legacyProgramme(mocks.S, { id: 'P', name: 'Block', at: 1, weeks: [{ t: { [BENCH]: { pct: 80 } } }, {}], days: { 1: ['r3'] } }) }
    expect(def().needs).toEqual(['repair'])
    page()
    expect(host.textContent).toContain('Check these before you start')
    expect(host.textContent).toContain('Barbell Bench Press: the old programme asked 80% of the 1RM in week 1. Its sets work from a training max, so its weeks follow its own progression now.')
    click(host.querySelector('.prog-weeks button[aria-label="Increase Weeks"]'))
    expect(def().duration.n).toBe(3)
    expect(def().needs).toEqual(['repair'])
    page()
    click(button('I checked these'))
    expect(def().needs).toBeUndefined()
    page()
    expect(host.textContent).not.toContain('Check these before you start')
  })

  it('past 50 exercises the editor says what to do, and removing a session works', () => {
    const ids = ['0025', '0043', '0027', '0047', '0031', '0294', '0313', '0334', '0241']
    const routines = Array.from({ length: 6 }, (_, i) => ({ id: 'R' + i, name: 'Day ' + i, ex: ids.map(id => ({ id, sets: 3, reps: 8, weight: 20 })) }))
    mocks.S = { ...migratedFixture({ unit: 'kg', weekStart: 1, workouts: [], routines }), effort: 'rir', dayPlan: {}, programme: null }
    mocks.S.programmes = { P: legacyProgramme(mocks.S, { id: 'P', name: 'Big', at: 1, weeks: [{}, {}], days: Object.fromEntries(routines.map((r, i) => [i + 1, [r.id]])) }) }
    page()
    const over = 'This programme has more exercises than it can hold. Remove a session from the schedule, or delete the programme.'
    expect(host.textContent).toContain(over)
    expect(button('I checked these')).toBeUndefined()
    click(host.querySelector('.prog-weeks button[aria-label="Increase Weeks"]'))
    expect(mocks.toasts.at(-1)).toBe(over)
    expect(def().duration.n).toBe(2)
    click(rowOf('Day 5'))
    act(() => mocks.menu.items.find(i => i.label === 'Remove').onClick())
    expect(def().tracks).toHaveLength(45)
    page()
    expect(host.textContent).not.toContain(over)
  })

  it('a running programme keeps how it counts its weeks, and says why', () => {
    seed({ 1: ['r1'], 3: ['r2'] })
    const adv = { onFailure: 'advance', onSkipped: 'advance' }
    expect(startProgramme(mocks.S, 'P', { policies: Object.fromEntries(def().tracks.map(t => [t.id, adv])), end: 'stop', today: '2026-10-26', now: Date.now() })).toEqual({ ok: true })
    const before = structuredClone(def())
    page()
    const rotation = button('Rotation')
    expect(rotation.disabled).toBe(true)
    expect(document.getElementById(rotation.getAttribute('aria-describedby')).textContent).toBe('Stop this programme before changing how it counts the weeks.')
    click(rotation)
    expect(def()).toEqual(before)
  })

  it('an assisted machine\'s week offers no back-off sets', () => {
    mocks.S.routines = [...mocks.S.routines, ...migratedFixture({ unit: 'kg', weekStart: 1, workouts: [], routines: [{ id: 'r6', name: 'Pull', ex: [{ id: '0017', sets: 3, reps: 8, weight: 30 }] }] }).routines]
    seed({ 1: ['r3'], 2: ['r6'] })
    openWeek(BENCH, 1)
    expect(rowOf('Back-off sets')).toBeTruthy()
    openWeek('0017', 1)
    expect(rowOf('Back-off sets')).toBeUndefined()
  })
})
