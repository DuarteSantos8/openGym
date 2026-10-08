import { buildCompletedWorkout } from './finish-workout.js'
import { describe, expect, it } from 'vitest'
import {
  activeProgrammeCycles, addProgrammeDefinitionInState, completeProgrammeCycleInState,
  copyProgrammeWeekToTargets, createProgrammeDefinition, currentProgrammeProjection,
  cycleWeekMode, PROGRAMME_COLOURS, programmeBuilderSources, programmeProgressionOptions,
  programmeWeeksFromSource, setProgrammeDaySessions,
  programmeStartDisposition, programmeWorkoutSource, readyProgrammeDefinitions,
  settleProgrammeWorkoutInState, startProgrammeCycleInState, updateActiveProgrammeCycleInState,
} from './programmes.js'

const routine = (id, mode = 'reps') => ({ id, name: id.toUpperCase(), prog: 'linear', ex: [{ id: `${id}-ex`, mode, sets: 3, reps: 5, sec: 30 }] })
const fresh = () => ({
  weekStart: 1, routines: [routine('push'), routine('pull'), routine('hold', 'time'), routine('run', 'cardio')], workouts: [], active: null,
  programmes: { version: 1, definitions: [], cycles: [] },
})
const input = {
  name: ' Strength block ', progression: 'linear',
  weeks: [
    { days: [{ weekday: 1, sessions: [{ routineId: 'push' }] }, { weekday: 3, sessions: [{ routineId: 'pull' }] }] },
    { days: [{ weekday: 2, sessions: [{ routineId: 'push' }] }] },
  ],
}
const make = (S, id = 'programme-1') => createProgrammeDefinition(input, S, { id, now: '2026-02-01T10:00:00Z' })

describe('Programme definitions and progression', () => {
  it('requires and trims editable Programme names', () => {
    const S = fresh()
    expect(createProgrammeDefinition({ ...input, name: '  Trimmed block  ' }, S, { id: 'trimmed' }).name).toBe('Trimmed block')
    expect(() => createProgrammeDefinition({ ...input, name: '   ' }, S, { id: 'blank' })).toThrow(/needs a name/i)
  })

  it('persists canonical colour and week modes while preserving retained unknown fields', () => {
    const S = fresh()
    S.programmes.definitions.push({ id: 'programme-1', legacyDefinition: true, colour: 'future-colour' })
    const definition = createProgrammeDefinition({
      ...input, colour: 'sky',
      weeks: [{ legacyWeek: true, mode: 'deload', days: [{ weekday: 1, legacyDay: true, sessions: [{
        id: 'occ', sessionTemplateId: 'tpl', routineId: 'push', legacySession: true,
      }] }] }],
    }, S, { id: 'programme-1' })
    expect(PROGRAMME_COLOURS).toEqual(['lime', 'sky', 'orange', 'gold', 'violet', 'pink', 'teal'])
    expect(definition).toMatchObject({ colour: 'sky', legacyDefinition: true })
    expect(definition.weeks[0]).toMatchObject({ mode: 'deload', legacyWeek: true })
    expect(definition.weeks[0].days[0]).toMatchObject({ legacyDay: true })
    expect(definition.weeks[0].days[0].sessions[0]).toMatchObject({ legacySession: true })
    expect(definition.weeks[0].days[0].sessions[0].routineSnapshot.excludeFromProgression).toBe(true)
    expect(S.routines[0].excludeFromProgression).toBeUndefined()
    expect(createProgrammeDefinition({ ...input, colour: 'not-a-palette-key' }, S, { id: 'programme-1' }).colour).toBe('future-colour')
    expect(createProgrammeDefinition(input, S, { id: 'programme-1' }).colour).toBe('future-colour')
    expect(createProgrammeDefinition({ ...input, colour: null }, S, { id: 'programme-1' }).colour).toBeNull()
  })

  it('seeds current, blank, and reusable sources with deep fresh identities', () => {
    const S = fresh(); S.week = { 1: 'push', 3: 'pull' }
    const source = make(S); source.colour = 'violet'; source.weeks[0].mode = 'rest'
    addProgrammeDefinitionInState(S, source)
    expect(programmeBuilderSources(S).map(item => item.value)).toEqual(['current', 'blank', 'programme:programme-1'])
    const current = programmeWeeksFromSource(S, 'current', 2)
    expect(current[0].days.map(day => day.weekday)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(current[0].days.find(day => day.weekday === 1).sessions[0].id)
      .not.toBe(current[1].days.find(day => day.weekday === 1).sessions[0].id)
    const blank = programmeWeeksFromSource(S, 'blank', 1)
    expect(blank[0].days).toHaveLength(7)
    expect(blank[0].days.every(day => day.sessions.length === 0)).toBe(true)
    const cloned = programmeWeeksFromSource(S, 'programme:programme-1', 2)
    expect(cloned[0].mode).toBe('rest')
    expect(cloned[0]).not.toBe(source.weeks[0])
    expect(cloned[0].days[0].sessions[0].id).not.toBe(source.weeks[0].days[0].sessions[0].id)
    expect(cloned[0].days[0].sessions[0].sessionTemplateId).not.toBe(source.weeks[0].days[0].sessions[0].sessionTemplateId)
    cloned[0].days[0].sessions[0].routineSnapshot.name = 'changed clone'
    expect(source.weeks[0].days[0].sessions[0].routineSnapshot.name).toBe('PUSH')
  })

  it('copies to deduplicated targets with independent identities and preserves ordered day sessions', () => {
    const S = fresh(); const weeks = programmeWeeksFromSource(S, 'blank', 3)
    const original = { id: 'occ', sessionTemplateId: 'tpl', routineId: 'push', routineSnapshot: routine('push'), marker: { value: 1 } }
    const withSessions = setProgrammeDaySessions(weeks, 0, 1, [original, { ...original, id: 'occ-2', sessionTemplateId: 'tpl-2' }])
    const copied = copyProgrammeWeekToTargets(withSessions, 0, [1, 2, 2, 0, -1, 99])
    expect(copied[0]).toBe(withSessions[0])
    for (const index of [1, 2]) {
      const sessions = copied[index].days.find(day => day.weekday === 1).sessions
      expect(sessions).toHaveLength(2)
      expect(sessions[0].id).not.toBe(original.id)
      expect(sessions[0].sessionTemplateId).not.toBe(original.sessionTemplateId)
      expect(sessions[0].id).not.toBe(sessions[1].id)
    }
    copied[1].days.find(item => item.weekday === 1).sessions[0].marker.value = 9
    expect(copied[2].days.find(item => item.weekday === 1).sessions[0].marker.value).toBe(1)
    const day = withSessions[0].days.find(item => item.weekday === 1)
    const reordered = setProgrammeDaySessions(withSessions, 0, 1, [day.sessions[1], day.sessions[0]])
    expect(reordered[0].days.find(item => item.weekday === 1).sessions.map(item => item.id)).toEqual(['occ-2', 'occ'])
    expect(cycleWeekMode({ mode: 'normal', marker: true }, 'rest')).toEqual({ mode: 'rest', marker: true })
  })

  it('creates a bounded, named definition with independent stable identities and deep routine snapshots', () => {
    const S = fresh(); const definition = make(S)
    expect(definition).toMatchObject({ id: 'programme-1', name: 'Strength block', lengthWeeks: 2, progression: 'linear' })
    const session = definition.weeks[0].days[0].sessions[0]
    expect(session).toMatchObject({ id: 'programme-1:w1:d1:s1', sessionTemplateId: 'programme-1:w1:d1:s1', routineId: 'push' })
    expect(session.routineSnapshot).not.toBe(S.routines[0])
    expect(session.routineSnapshot.prog).toBe('linear')
    expect(session.routineSnapshot.ex[0].prog).toBeUndefined()
    expect(session.routineSnapshot.prog).toBe('linear')
    const customTemplate = createProgrammeDefinition({
      name: 'Independent IDs', weeks: [{ days: [{ weekday: 1, sessions: [
        { sessionTemplateId: 'custom-template', routineId: 'push' },
      ] }] }],
    }, S, { id: 'independent' })
    expect(customTemplate.weeks[0].days[0].sessions[0]).toMatchObject({
      id: 'independent:w1:d1:s1', sessionTemplateId: 'custom-template',
    })
    S.routines[0].name = 'changed'
    expect(session.routineSnapshot.name).toBe('PUSH')
  })

  it('rejects invalid lengths, empty plans, blank identities, duplicates, and incompatible progression', () => {
    const S = fresh()
    expect(() => createProgrammeDefinition({ ...input, weeks: [] }, S)).toThrow(/at least one week/i)
    expect(() => createProgrammeDefinition({ ...input, weeks: Array.from({ length: 53 }, () => ({ days: [] })) }, S)).toThrow(/52/)
    expect(() => createProgrammeDefinition({ name: 'Empty', weeks: [{ days: [] }] }, S)).toThrow(/at least one session/i)
    expect(() => createProgrammeDefinition({ ...input, id: ' ' }, S)).toThrow(/identity/i)
    expect(() => createProgrammeDefinition({ name: 'Bad routine', weeks: [{ days: [{ weekday: 1, sessions: [{ routineSnapshot: { id: '', ex: [] } }] }] }] }, S)).toThrow(/routine identity/i)
    const sessions = [
      { id: 'one', sessionTemplateId: 'same', routineId: 'push' },
      { id: 'two', sessionTemplateId: 'same', routineId: 'pull' },
    ]
    expect(() => createProgrammeDefinition({ name: 'Dup', weeks: [{ days: [{ weekday: 1, sessions }] }] }, S)).toThrow(/unique/i)
    expect(() => createProgrammeDefinition({ name: 'Blank', weeks: [{ days: [{ weekday: 1, sessions: [{ id: '', routineId: 'push' }] }] }] }, S)).toThrow(/identity/i)
    expect(() => createProgrammeDefinition({ name: 'Mixed', progression: 'linear', weeks: [{ days: [{ weekday: 1, sessions: [{ routineId: 'push' }, { routineId: 'hold' }] }] }] }, S)).not.toThrow()
  })

  it('offers defaults independently of exercise modes and preserves overrides', () => {
    const S = fresh()
    S.routines[0].prog = ''
    S.routines[0].ex[0].prog = 'off'
    const weeks = [{ days: [{ weekday: 1, sessions: [{ routineId: 'push' }, { routineId: 'hold' }] }] }]
    expect(programmeProgressionOptions(weeks, S)).toContain('linear')
    const definition = createProgrammeDefinition({ name: 'Mixed', progression: 'double', weeks }, S)
    const snapshot = definition.weeks[0].days[0].sessions[0].routineSnapshot
    expect(snapshot.ex[0].prog).toBe('off')
    expect(snapshot.prog).toBe('')
    expect(snapshot.programmeProgression).toBe('double')
  })
})

describe('Programme cycles, projection, and settlement', () => {
  it('keeps a newly started operational schedule deeply independent from its programme snapshot', () => {
    const S = fresh(); const definition = make(S); addProgrammeDefinitionInState(S, definition)
    const cycle = startProgrammeCycleInState(S, definition.id, {
      id: 'cycle', now: '2026-02-02T08:00:00Z', timeZone: 'UTC',
    })
    const operational = cycle.snapshot.weeks
    const source = cycle.programmeSnapshot.weeks

    expect(operational).not.toBe(source)
    expect(operational[0]).not.toBe(source[0])
    expect(operational[0].days[0]).not.toBe(source[0].days[0])
    expect(operational[0].days[0].sessions[0]).not.toBe(source[0].days[0].sessions[0])
    expect(operational[0].days[0].sessions[0].routineSnapshot)
      .not.toBe(source[0].days[0].sessions[0].routineSnapshot)

    operational[0].mode = 'rest'
    operational[0].days[0].sessions[0].routineSnapshot.name = 'Operational only'
    expect(source[0].mode).toBe('normal')
    expect(source[0].days[0].sessions[0].routineSnapshot.name).toBe('PUSH')

    source[0].days[0].sessions[0].routineSnapshot.ex[0].sets = 99
    expect(operational[0].days[0].sessions[0].routineSnapshot.ex[0].sets).toBe(3)
  })

  it('keeps an edited operational schedule deeply independent from its programme snapshot', () => {
    const S = fresh(); const definition = make(S); addProgrammeDefinitionInState(S, definition)
    const cycle = startProgrammeCycleInState(S, definition.id, {
      id: 'cycle', now: '2026-02-02T08:00:00Z', timeZone: 'UTC',
    })
    const edited = structuredClone(cycle.snapshot.weeks)
    edited[0].days[0].sessions[0].routineSnapshot.name = 'Edited push'
    updateActiveProgrammeCycleInState(S, cycle.id, { weeks: edited }, { now: '2026-02-03T08:00:00Z' })
    const operational = cycle.snapshot.weeks
    const source = cycle.programmeSnapshot.weeks

    expect(operational).not.toBe(source)
    expect(operational[0]).not.toBe(source[0])
    expect(operational[0].days[0]).not.toBe(source[0].days[0])
    expect(operational[0].days[0].sessions[0]).not.toBe(source[0].days[0].sessions[0])
    expect(operational[0].days[0].sessions[0].routineSnapshot)
      .not.toBe(source[0].days[0].sessions[0].routineSnapshot)

    operational[0].mode = 'rest'
    operational[0].days[0].sessions[0].routineSnapshot.name = 'Operational only'
    expect(source[0].mode).toBe('normal')
    expect(source[0].days[0].sessions[0].routineSnapshot.name).toBe('Edited push')

    source[0].days[0].sessions[0].routineSnapshot.ex[0].sets = 99
    expect(operational[0].days[0].sessions[0].routineSnapshot.ex[0].sets).toBe(3)
  })

  it.each([
    [1, '2026-02-02T08:00:00Z', '2026-02-02'],
    [0, '2026-02-01T08:00:00Z', '2026-02-01'],
  ])('captures week start %s and uses it to materialize dates', (weekStart, now, anchor) => {
    const S = fresh(); S.weekStart = weekStart
    const definition = make(S); addProgrammeDefinitionInState(S, definition)
    const cycle = startProgrammeCycleInState(S, definition.id, { id: `cycle-${weekStart}`, now, timeZone: 'UTC' })
    expect(cycle).toMatchObject({ weekStart, week1StartDate: anchor, timeZone: 'UTC' })
    S.weekStart = weekStart === 1 ? 0 : 1
    const projected = currentProgrammeProjection(S, { now }).items
    expect(projected[0].date).toBe(weekStart === 1 ? '2026-02-02' : '2026-02-02')
  })

  it('normalizes missing legacy identities before start but rejects explicit blanks', () => {
    const S = fresh()
    S.programmes.definitions.push({ id: 'legacy', name: 'Legacy', progression: 'linear', weeks: [{ days: [{ weekday: 1, sessions: [{ routineId: 'push', routineSnapshot: routine('push') }] }] }] })
    const cycle = startProgrammeCycleInState(S, 'legacy', { id: 'cycle', now: '2026-02-02T08:00:00Z', timeZone: 'UTC' })
    expect(cycle.snapshot.weeks[0].days[0].sessions[0].sessionTemplateId).toBe('legacy:w1:d1:s1')
    cycle.status = 'completed'
    S.programmes.definitions[0].weeks[0].days[0].sessions[0].sessionTemplateId = ' '
    expect(() => startProgrammeCycleInState(S, 'legacy')).toThrow(/identity/i)
  })

  it('rejects a persisted rest-only definition before mutating cycles', () => {
    const S = fresh()
    S.programmes.definitions.push({
      id: 'rest-only', name: 'Rest only', progression: 'linear',
      weeks: [{ mode: 'rest', days: [{ weekday: 1, sessions: [{ routineId: 'push', routineSnapshot: routine('push') }] }] }],
    })
    const cyclesBefore = JSON.stringify(S.programmes.cycles)

    expect(() => startProgrammeCycleInState(S, 'rest-only', { id: 'cycle-rest-only' })).toThrow(/at least one session/i)
    expect(JSON.stringify(S.programmes.cycles)).toBe(cyclesBefore)
  })

  it('allows independent cycles, hides active definitions from ready, and gives restarts fresh identity', () => {
    const S = fresh(); const first = make(S, 'p1'); const second = make(S, 'p2')
    addProgrammeDefinitionInState(S, first); addProgrammeDefinitionInState(S, second)
    startProgrammeCycleInState(S, 'p1', { id: 'c1', now: '2026-02-02T08:00:00Z', timeZone: 'UTC' })
    startProgrammeCycleInState(S, 'p2', { id: 'c2', now: '2026-02-09T08:00:00Z', timeZone: 'UTC' })
    expect(activeProgrammeCycles(S)).toHaveLength(2)
    expect(readyProgrammeDefinitions(S)).toEqual([])
    expect(() => startProgrammeCycleInState(S, 'p1')).toThrow(/active cycle/i)
    completeProgrammeCycleInState(S, 'c1', { now: '2026-02-10T08:00:00Z', reason: 'early' })
    const restarted = startProgrammeCycleInState(S, 'p1', { id: 'c3', now: '2026-03-02T08:00:00Z', timeZone: 'UTC' })
    expect(restarted.id).toBe('c3')
    expect(restarted.status).toBe('active')
    completeProgrammeCycleInState(S, 'c3')
    expect(() => startProgrammeCycleInState(S, 'p1', { id: ' ' })).toThrow(/cycle identity/i)
    expect(() => startProgrammeCycleInState(S, 'p1', { id: 'c1' })).toThrow(/cycle identity.*unique/i)
  })

  it('projects prior unresolved, current completed/due, excludes future, and carries unresolved after the window', () => {
    const S = fresh(); const definition = make(S); addProgrammeDefinitionInState(S, definition)
    startProgrammeCycleInState(S, definition.id, { id: 'cycle', now: '2026-02-02T08:00:00Z', timeZone: 'UTC' })
    const first = currentProgrammeProjection(S, { now: '2026-02-02T12:00:00Z' }).items[0]
    S.workouts.push({ id: 'done', ...programmeWorkoutSource(first) })
    const week2 = currentProgrammeProjection(S, { now: '2026-02-10T12:00:00Z' }).cycles.cycle
    expect(week2.currentWeek).toBe(2)
    expect(week2.items.map(item => [item.weekIndex, item.status])).toEqual([[1, 'pending'], [2, 'due']])
    const afterWindow = currentProgrammeProjection(S, { now: '2026-03-10T12:00:00Z' }).cycles.cycle
    expect(afterWindow.currentWeek).toBe(2)
    expect(afterWindow.items).toHaveLength(2)
  })

  it('does not project rest weeks and freezes deload exclusion without changing configured targets', () => {
    const S = fresh()
    const definition = createProgrammeDefinition({ name: 'Modes', progression: 'linear', weeks: [
      { mode: 'rest', days: [{ weekday: 1, sessions: [{ routineId: 'push' }] }] },
      { mode: 'deload', days: [{ weekday: 2, sessions: [{ routineId: 'push' }] }] },
    ] }, S, { id: 'modes' })
    addProgrammeDefinitionInState(S, definition)
    const cycle = startProgrammeCycleInState(S, 'modes', { id: 'cycle-modes', now: '2026-02-02T08:00:00Z', timeZone: 'UTC' })
    const projected = currentProgrammeProjection(S, { now: '2026-02-10T12:00:00Z' }).items
    expect(projected).toHaveLength(1)
    expect(projected[0]).toMatchObject({ weekIndex: 2, weekday: 2 })
    expect(projected[0].routineSnapshot.excludeFromProgression).toBe(true)
    expect(projected[0].routineSnapshot.ex[0].sets).toBe(3)
    expect(cycle.colour).toBeUndefined()
    expect(() => createProgrammeDefinition({ name: 'Only rest', progression: 'linear', weeks: [
      { mode: 'rest', days: [{ weekday: 1, sessions: [{ routineId: 'push' }] }] },
    ] }, S, { id: 'only-rest' })).toThrow(/at least one session/i)
  })

  it('keeps each cycle week independent and orders deterministically by date then instance', () => {
    const S = fresh(); const one = make(S, 'p1'); const two = make(S, 'p2')
    addProgrammeDefinitionInState(S, one); addProgrammeDefinitionInState(S, two)
    startProgrammeCycleInState(S, 'p1', { id: 'c1', now: '2026-02-02T08:00:00Z', timeZone: 'UTC' })
    startProgrammeCycleInState(S, 'p2', { id: 'c2', now: '2026-02-09T08:00:00Z', timeZone: 'UTC' })
    const projection = currentProgrammeProjection(S, { now: '2026-02-10T12:00:00Z' })
    expect(projection.cycles.c1.currentWeek).toBe(2)
    expect(projection.cycles.c2.currentWeek).toBe(1)
    expect(projection.items).toEqual([...projection.items].sort((a, b) => a.date.localeCompare(b.date) || a.instanceId.localeCompare(b.instanceId)))
  })

  it('settles only exact unique instance identities and supports early completion', () => {
    const S = fresh(); const one = createProgrammeDefinition({ name: 'One', progression: 'linear', weeks: [{ days: [{ weekday: 1, sessions: [{ routineId: 'push' }] }] }] }, S, { id: 'p1' })
    addProgrammeDefinitionInState(S, one); const cycle = startProgrammeCycleInState(S, 'p1', { id: 'c1', now: '2026-02-02T08:00:00Z', timeZone: 'UTC' })
    const item = currentProgrammeProjection(S, { now: '2026-02-02T12:00:00Z' }).items[0]
    expect(programmeStartDisposition(null, item)).toBe('start')
    expect(programmeStartDisposition({ programmeInstanceId: item.instanceId }, item)).toBe('resume')
    expect(programmeStartDisposition({ id: 'classic' }, item)).toBe('blocked')
    expect(settleProgrammeWorkoutInState(S, { cycleId: 'c1', routineId: 'push' })).toBe(false)
    S.workouts.push({ id: 'w1', ...programmeWorkoutSource(item) })
    expect(settleProgrammeWorkoutInState(S, S.workouts[0], { now: '2026-02-02T13:00:00Z' })).toBe(true)
    expect(cycle).toMatchObject({ status: 'completed', completionReason: 'completed' })
  })

  it('rejects moving an active occurrence to another weekday without mutating the cycle', () => {
    const S = fresh(); const definition = make(S); addProgrammeDefinitionInState(S, definition)
    const cycle = startProgrammeCycleInState(S, definition.id, { id: 'c1', now: '2026-02-02T08:00:00Z', timeZone: 'UTC' })
    const original = structuredClone(cycle)
    const item = currentProgrammeProjection(S, { now: '2026-02-02T12:00:00Z' }).items[0]
    S.active = { id: 'active', ...programmeWorkoutSource(item) }
    const moved = structuredClone(cycle.snapshot.weeks)
    const [session] = moved[0].days[0].sessions.splice(0, 1)
    moved[0].days.push({ weekday: 5, sessions: [session] })

    expect(() => updateActiveProgrammeCycleInState(S, 'c1', { weeks: moved })).toThrow(/active occurrence/i)
    expect(cycle).toEqual(original)
  })

  it('rejects moving a completed occurrence across weeks without mutation or false settlement', () => {
    const S = fresh()
    const definition = createProgrammeDefinition({
      name: 'One', progression: 'linear',
      weeks: [{ days: [{ weekday: 1, sessions: [{ routineId: 'push' }] }] }, { days: [] }],
    }, S, { id: 'p1' })
    addProgrammeDefinitionInState(S, definition)
    const cycle = startProgrammeCycleInState(S, definition.id, { id: 'c1', now: '2026-02-02T08:00:00Z', timeZone: 'UTC' })
    const original = structuredClone(cycle)
    const item = currentProgrammeProjection(S, { now: '2026-02-02T12:00:00Z' }).items[0]
    S.workouts.push({ id: 'done', ...programmeWorkoutSource(item) })
    const moved = structuredClone(cycle.snapshot.weeks)
    const [session] = moved[0].days[0].sessions.splice(0, 1)
    moved[1].days.push({ weekday: 5, sessions: [session] })

    expect(() => updateActiveProgrammeCycleInState(S, 'c1', { weeks: moved })).toThrow(/completed occurrence/i)
    expect(cycle).toEqual(original)
    expect(cycle.status).toBe('active')
    expect(S.workouts[0].programmeInstance).toMatchObject({ weekIndex: 1, weekday: 1, date: '2026-02-02' })
  })

  it('allows moving and replacing an unresolved occurrence while retaining its identity', () => {
    const S = fresh()
    const definition = createProgrammeDefinition({
      name: 'One', progression: 'linear',
      weeks: [{ days: [{ weekday: 1, sessions: [{ routineId: 'push' }] }] }, { days: [] }],
    }, S, { id: 'p1' })
    addProgrammeDefinitionInState(S, definition)
    const cycle = startProgrammeCycleInState(S, definition.id, { id: 'c1', now: '2026-02-02T08:00:00Z', timeZone: 'UTC' })
    const original = currentProgrammeProjection(S, { now: '2026-02-02T12:00:00Z' }).items[0]
    const edited = structuredClone(cycle.snapshot.weeks)
    const [session] = edited[0].days[0].sessions.splice(0, 1)
    edited[1].days.push({ weekday: 5, sessions: [{ ...session, routineId: 'pull', routineSnapshot: routine('pull') }] })

    updateActiveProgrammeCycleInState(S, 'c1', { weeks: edited }, { now: '2026-02-03T08:00:00Z' })

    const [moved] = currentProgrammeProjection(S, { now: '2026-02-13T12:00:00Z' }).items
    expect(moved).toMatchObject({
      instanceId: original.instanceId, weekIndex: 2, weekday: 5, date: '2026-02-13', routineId: 'pull',
    })
    expect(cycle.status).toBe('active')
  })

  it('edits active-cycle name and colour without changing cycle identity or reusable definition', () => {
    const S = fresh(); const definition = make(S); addProgrammeDefinitionInState(S, definition)
    const cycle = startProgrammeCycleInState(S, definition.id, { id: 'c1', now: '2026-02-02T08:00:00Z', timeZone: 'UTC' })
    cycle.snapshot.retained = true
    updateActiveProgrammeCycleInState(S, 'c1', { name: 'Renamed cycle', colour: 'teal' }, { now: '2026-02-03T08:00:00Z' })
    expect(cycle).toMatchObject({ id: 'c1', programmeId: definition.id, name: 'Renamed cycle', colour: 'teal', snapshot: { retained: true } })
    expect(S.programmes.definitions[0].name).toBe('Strength block')
    expect(S.programmes.definitions[0].colour).toBeUndefined()
  })

  it('protects completed/current occurrences during cycle edits while preserving unchanged snapshots', () => {
    const S = fresh(); const definition = make(S); addProgrammeDefinitionInState(S, definition)
    const cycle = startProgrammeCycleInState(S, definition.id, { id: 'c1', now: '2026-02-02T08:00:00Z', timeZone: 'UTC' })
    const original = structuredClone(cycle.snapshot.weeks[0].days[0].sessions[0])
    const item = currentProgrammeProjection(S, { now: '2026-02-02T12:00:00Z' }).items[0]
    S.active = { id: 'active', ...programmeWorkoutSource(item) }
    const removed = structuredClone(cycle.snapshot.weeks); removed[0].days[0].sessions = []
    expect(() => updateActiveProgrammeCycleInState(S, 'c1', { weeks: removed })).toThrow(/active occurrence/i)
    expect(cycle.snapshot.weeks[0].days[0].sessions[0]).toEqual(original)
    S.active = null; S.workouts.push({ id: 'done', ...programmeWorkoutSource(item) })
    expect(() => updateActiveProgrammeCycleInState(S, 'c1', { weeks: removed })).toThrow(/completed occurrence/i)
  })

  it('atomically rejects protected identity changes and normal-to-rest edits', () => {
    const S = fresh(); const definition = make(S); addProgrammeDefinitionInState(S, definition)
    const cycle = startProgrammeCycleInState(S, definition.id, { id: 'c1', now: '2026-02-02T08:00:00Z', timeZone: 'UTC' })
    const item = currentProgrammeProjection(S, { now: '2026-02-02T12:00:00Z' }).items[0]
    S.active = { id: 'active', ...programmeWorkoutSource(item) }
    const original = structuredClone(cycle)
    const changedId = structuredClone(cycle.snapshot.weeks)
    changedId[0].days[0].sessions[0].id = 'different-occurrence'
    expect(() => updateActiveProgrammeCycleInState(S, 'c1', { weeks: changedId })).toThrow(/active occurrence/i)
    const rested = structuredClone(cycle.snapshot.weeks); rested[0].mode = 'rest'
    expect(() => updateActiveProgrammeCycleInState(S, 'c1', { weeks: rested })).toThrow(/active occurrence/i)
    expect(cycle).toEqual(original)
  })
})

it('does not mark an explicitly incomplete imported Programme session done or settle its cycle', () => {
  for (const flags of [{ partial: true, owed: true }, { complete: false }, { owed: true }]) {
    const S = fresh()
    const definition = createProgrammeDefinition({ name: 'One session', progression: 'linear', weeks: [{ days: [{ weekday: 1, sessions: [{ routineId: 'push' }] }] }] }, S, { id: 'one' })
    addProgrammeDefinitionInState(S, definition)
    const cycle = startProgrammeCycleInState(S, 'one', { id: 'cycle', startDate: '2026-02-02', timeZone: 'UTC', now: '2026-02-02T12:00:00Z' })
    const item = currentProgrammeProjection(S, { now: '2026-02-02T12:00:00Z' }).items[0]
    const record = { id: 'partial', ...programmeWorkoutSource(item), ...flags }
    S.workouts.push(record)
    expect(currentProgrammeProjection(S, { now: '2026-02-02T12:00:00Z' }).items[0].status).not.toBe('completed')
    expect(settleProgrammeWorkoutInState(S, record)).toBe(false)
    expect(cycle.status).toBe('active')
  }
})
it('retains deployed cycle occurrence identities and matches their completed history', () => {
  const S = fresh()
  const cycle = { id: 'legacy-cycle', programmeId: 'legacy-programme', programmeRevision: 1, status: 'active', week1StartDate: '2026-02-02', timeZone: 'UTC', lengthWeeks: 1,
    snapshot: { weeks: [{ days: [{ weekday: 1, sessions: [{ id: 'push', routine: routine('push') }] }] }] } }
  S.programmes.cycles.push(cycle)
  const projected = currentProgrammeProjection(S, { now: '2026-02-02T12:00:00Z' }).items[0]
  expect(projected).toMatchObject({ instanceId: 'pi:legacy-cycle:push', sessionTemplateId: 'push', routineId: 'push', routineSnapshot: routine('push') })
  S.workouts.push({ cycleId: cycle.id, instanceId: 'pi:legacy-cycle:push', complete: true })
  expect(currentProgrammeProjection(S, { now: '2026-02-02T12:00:00Z' }).items[0].status).toBe('completed')
})
it('preserves explicit legacy identities and disambiguates repeated template ids in authored order', () => {
  const S = fresh()
  S.programmes.cycles.push({ id: 'c', programmeId: 'p', programmeRevision: 1, status: 'active', week1StartDate: '2026-02-02', lengthWeeks: 1,
    snapshot: { weeks: [{ days: [{ weekday: 1, sessions: [{ id: 'same' }, { id: 'same' }, { id: 'explicit', instanceId: 'accepted-id' }] }] }] } })
  expect(currentProgrammeProjection(S, { now: '2026-02-02T12:00:00Z' }).items.map(x=>x.instanceId))
    .toEqual(['pi:c:w1:d1:o1:same', 'pi:c:w1:d1:o2:same', 'accepted-id'])
})

it('extends the calendar horizon without changing the current-week queue',()=>{
 const S=fresh();const definition=createProgrammeDefinition({name:'Calendar',weeks:[{days:[{weekday:1,sessions:[{routineId:'push'}]}]},{days:[{weekday:1,sessions:[{routineId:'pull'}]}]}]},S,{id:'calendar'});
 startProgrammeCycleInState(S,definition,{id:'cycle-calendar',now:'2026-12-28T12:00:00Z',timeZone:'UTC',week1StartDate:'2026-12-28'});
 const normal=currentProgrammeProjection(S,{now:'2026-12-28T12:00:00Z'});
 expect(normal.items.map(item=>item.weekIndex)).toEqual([1]);
 const calendar=currentProgrammeProjection(S,{now:'2026-12-28T12:00:00Z',calendarThrough:'2027-01-04'});
 expect(calendar.items.map(item=>item.weekIndex)).toEqual([1,2]);
 expect(calendar.cycles['cycle-calendar'].currentWeek).toBe(1);
});

it('retains completed weeks in progress without settling partial history or empty rest weeks',()=>{
 const S=fresh(),def=make(S);def.weeks.push({mode:'rest',days:[]});
 const cycle=startProgrammeCycleInState(S,def,{id:'progress',week1StartDate:'2026-02-02',timeZone:'UTC'});
 const first=currentProgrammeProjection(S,{now:'2026-02-04T12:00:00Z'}).items;
 S.workouts=first.map(item=>({programmeInstance:{cycleId:cycle.id,instanceId:item.instanceId}}));
 let result=currentProgrammeProjection(S,{now:'2026-02-10T12:00:00Z'}).cycles[cycle.id];
 expect(result.weekProgress).toEqual([{total:2,completed:2},{total:1,completed:0},{total:0,completed:0}]);
 expect(result.items.every(item=>item.weekIndex===2)).toBe(true);
 S.workouts[0].partial=true;
 result=currentProgrammeProjection(S,{now:'2026-02-10T12:00:00Z'}).cycles[cycle.id];
 expect(result.weekProgress[0].completed).toBe(1);
});


it('settles only a fully checked fresh finish after removing unneeded rows', () => {
 const S=fresh();const def=createProgrammeDefinition({name:'One',weeks:[{days:[{weekday:1,sessions:[{routineId:'push'}]}]}]},S,{id:'one'})
 addProgrammeDefinitionInState(S,def);const cycle=startProgrammeCycleInState(S,def,{id:'cycle',startDate:'2026-02-02',timeZone:'UTC'})
 const item=currentProgrammeProjection(S,{now:'2026-02-02T12:00:00Z'}).items[0]
 const active={id:'workout',...programmeWorkoutSource(item),entries:[{id:'push-ex',sets:[{done:true,w:40,r:5},{done:false,w:40,r:5}]}]}
 const partial=buildCompletedWorkout(active);S.workouts.push(partial)
 expect(partial.complete).toBe(false);expect(settleProgrammeWorkoutInState(S,partial)).toBe(false);expect(cycle.status).toBe('active')
 active.entries[0].sets.pop();const complete=buildCompletedWorkout(active);S.workouts=[complete]
 expect(complete.complete).toBe(true);expect(settleProgrammeWorkoutInState(S,complete)).toBe(true);expect(cycle.status).toBe('completed')
})
