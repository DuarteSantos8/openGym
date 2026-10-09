// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildCompletedWorkout } from './finish-workout.js'
import { beginWorkout } from '../sheets.jsx'
import { setNav } from './nav.js'
import { useStore, DEF } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { createProgrammeDefinition, currentProgrammeProjection, programmeSessionsForDate, startProgrammeCycleInState } from './programmes.js'

const item = instanceId => ({
  instanceId, cycleId: 'cycle-1', programmeId: 'programme-1', sessionTemplateId: 'session-1',
  weekIndex: 1, weekday: 1, date: '2026-02-02', routineId: 'push',
  routineSnapshot: { id: 'push', name: 'Frozen Push', prog: 'off', ex: [] },
})

describe('Programme workout start boundary', () => {
  const navigate = vi.fn()
  beforeEach(() => {
    navigate.mockReset(); setNav(navigate)
    useUI.setState({ sheets: [], toastMsg: '', timer: null })
    useStore.setState({ S: { ...structuredClone(DEF), routines: [{ id: 'push', name: 'Changed live', ex: [] }] } })
  })

  it('seeds from the frozen snapshot and writes additive provenance', () => {
    const source = item('cycle-1:session-1')
    expect(beginWorkout('push', 82, source)).toBe('start')
    expect(useStore.getState().S.active).toMatchObject({
      routineIds: ['push'], name: 'Frozen Push', bw: 82, programmeId: 'programme-1', cycleId: 'cycle-1',
      programmeInstanceId: source.instanceId,
      programmeInstance: { version: 1, instanceId: source.instanceId },
    })
    expect(navigate).toHaveBeenCalledWith('/workout')
  })

  it('resumes the exact active instance byte-for-byte', () => {
    const active = { id: 'active', programmeInstanceId: 'cycle-1:session-1', entries: [{ id: 'bench', sets: [{ done: true }] }] }
    useStore.setState(state => ({ S: { ...state.S, active } }))
    expect(beginWorkout('push', 82, item('cycle-1:session-1'))).toBe('resume')
    expect(useStore.getState().S.active).toBe(active)
    expect(navigate).toHaveBeenCalledWith('/workout')
  })

  it.each([
    [{ id: 'classic', entries: [] }, item('cycle-1:session-1')],
    [{ id: 'programme', programmeInstanceId: 'cycle-1:other', entries: [] }, item('cycle-1:session-1')],
    [{ id: 'programme', programmeInstanceId: 'cycle-1:session-1', entries: [] }, null],
  ])('blocks a different active workout without mutation or navigation', (active, source) => {
    useStore.setState(state => ({ S: { ...state.S, active } }))
    const before = structuredClone(active)
    expect(beginWorkout('push', 82, source)).toBe('blocked')
    expect(useStore.getState().S.active).toEqual(before)
    expect(navigate).not.toHaveBeenCalled()
    expect(useUI.getState().toastMsg).toMatch(/finish.*current workout/i)
  })

  it('keeps the classic no-source start shape free of Programme fields', () => {
    expect(beginWorkout('push', 82)).toBe('start')
    const active = useStore.getState().S.active
    expect(active).toMatchObject({ routineIds: ['push'], name: 'Changed live', bw: 82 })
    expect(active).not.toHaveProperty('programmeId')
    expect(active).not.toHaveProperty('programmeInstance')
  })
})

it('starts Programme targets independently of global confirmed weights and preserves occurrence/unit provenance on finish',()=>{
 const cfg={id:'fixture',mode:'reps',sets:1,reps:5,weight:20,inc:2.5,prog:'linear'};
 const source=item('cycle-1:session-2');source.weekIndex=2;source.date='2026-02-09';source.routineSnapshot.ex=[cfg,{...cfg}];
 const history={unit:'kg',d:'2026-02-02',programmeInstance:{cycleId:'cycle-1',instanceId:'cycle-1:session-1',weekIndex:1},entries:[30,40].map((weight,i)=>({id:'fixture',occurrenceId:'fixture#'+(i+1),target:{...cfg,weight},sets:[{w:weight,r:5,done:true}]}))};
 useStore.setState({S:{...structuredClone(DEF),unit:'kg',active:null,exWeights:{fixture:{w:200}},workouts:[history,{...history,programmeInstance:{...history.programmeInstance,cycleId:'other'}}]}});
 beginWorkout('push',82,source);const active=useStore.getState().S.active;
 expect(active.entries.map(entry=>entry.sets[0].w)).toEqual([32.5,42.5]);
 active.entries.forEach(entry=>{entry.sets[0].done=true});const completed=buildCompletedWorkout(active);
 expect(completed.unit).toBe('kg');expect(completed.entries.map(entry=>entry.occurrenceId)).toEqual(['fixture#1','fixture#2']);
 useStore.setState({S:{...structuredClone(DEF),unit:'kg',active:null,exWeights:{fixture:{w:200}},workouts:[]}});
 beginWorkout('push',82,source);expect(useStore.getState().S.active.entries.map(entry=>entry.sets[0].w)).toEqual([20,20]);
});

it('keeps authored order and progresses the second of two same-day sessions from the first', () => {
  const cfg = { id: 'fixture', mode: 'reps', sets: 1, reps: 5, weight: 20, inc: 2.5, prog: 'linear' }
  const routine = { id: 'push', name: 'Push', prog: 'linear', ex: [cfg] }
  const state = { ...structuredClone(DEF), programmeMode: true, routines: [routine] }
  const definition = createProgrammeDefinition({ name: 'Double day', weeks: [{ days: [{ weekday: 1, sessions: [
    { id: 'z-first', sessionTemplateId: 'z-first', routineId: 'push' },
    { id: 'a-second', sessionTemplateId: 'a-second', routineId: 'push' },
  ] }] }] }, state, { id: 'programme' })
  startProgrammeCycleInState(state, definition, { id: 'cycle', week1StartDate: '2026-02-02', weekStart: 1 })
  const items = programmeSessionsForDate(state, '2026-02-02')
  expect(items.map(item => [item.sessionTemplateId, item.ordinal])).toEqual([['z-first', 1], ['a-second', 2]])
  expect(currentProgrammeProjection(state, { now: '2026-02-02T12:00:00Z' }).items.map(item => item.sessionTemplateId)).toEqual(['z-first', 'a-second'])

  useStore.setState({ S: state })
  beginWorkout('push', 82, items[0], items[0].date)
  let active = useStore.getState().S.active
  expect(active.programmeInstance.ordinal).toBe(1)
  active.entries[0].sets[0].done = true
  const completed = buildCompletedWorkout(active)
  useStore.getState().update(current => { current.workouts.push(completed); current.active = null })

  beginWorkout('push', 82, items[1], items[1].date)
  active = useStore.getState().S.active
  expect(active.programmeInstance.ordinal).toBe(2)
  expect(active.entries[0].sets[0].w).toBe(22.5)
})

it('starts combined routines with per-entry exclusion and records both routine identities', () => {
  const routines = ['work', 'rehab'].map(id => ({ id, name: id, prog: 'off',
    excludeFromProgression: id === 'rehab',
    ex: [{ id: '0025', sets: 1, reps: 5, weight: 20 }],
  }))
  useStore.setState({ S: { ...structuredClone(DEF), routines, active: null } })
  beginWorkout(['work', 'rehab'], 80)
  const active = useStore.getState().S.active
  expect(active.routineIds).toEqual(['work', 'rehab'])
  expect(active.entries.map(e => e.rid)).toEqual(['work', 'rehab'])
  expect(active.entries.map(e => e.noProg === true)).toEqual([false, true])
  active.entries.forEach(e => { e.sets[0].done = true })
  const completed = buildCompletedWorkout(active)
  expect(completed.routineIds).toEqual(['work', 'rehab'])
  expect(completed).not.toHaveProperty('excludeFromProgression')
  expect(completed).not.toHaveProperty('programmeInstance')
})
