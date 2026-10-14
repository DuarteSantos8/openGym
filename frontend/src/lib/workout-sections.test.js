import { describe, expect, it } from 'vitest'
import { SECTION_PRESETS, addSection, assignSection, moveSection, reorderSection, removeSection, updateSection, countsAsWork, cleanSections, remapSections, sectionColor } from './workout-sections.js'
import { buildPlanBundle, parsePlan, mergePlan } from './plan-share.js'
import { buildRoutineSession as buildSessionEntries } from './session-start.js'
import { buildCompletedWorkout } from './finish-workout.js'
import { workoutVolume, lastEntryFor, lastDisplayEntryFor, pairAdjacent } from './history.js'
import { nextPrescription } from './progression.js'
import { best1RM } from './onerm.js'
import { fatigueOf, strengthOf } from './recovery.js'
const state = () => ({ workouts: [], exWeights: {}, unit: 'kg' })
const routine = () => ({ id: 'r', name: 'Phases', prog: 'linear', ex: [
  { id: '0025', sets: 1, reps: 5, weight: 40 }, { id: '0025', sets: 1, reps: 5, weight: 100 },
] })

describe('workout sections', () => {
  it('drops a whole phase at another phase while preserving entries and active focus', () => {
    const sections = ['a', 'empty', 'b'].map(id => ({ ...SECTION_PRESETS[2], id }))
    const first = { id: '0025', sectionId: 'a', occurrenceId: 'first', sg: 'pair', sets: [{ w: 20, r: 8, done: true }] }
    const second = { ...first, occurrenceId: 'second' }
    const last = { id: '0047', sectionId: 'b', occurrenceId: 'last', sets: [{ w: 35, r: 5, done: false }] }
    const active = { sections, entries: [first, second, last], cur: 1 }
    expect(reorderSection(active, 'a', 'b')).toBe(true)
    expect(active.sections.map(section => section.id)).toEqual(['empty', 'b', 'a'])
    expect(active.entries).toEqual([last, first, second])
    expect(active.entries[active.cur]).toBe(second)
    expect(first.sets).toEqual([{ w: 20, r: 8, done: true }])
    expect(reorderSection(active, 'a', 'empty')).toBe(true)
    expect(active.sections.map(section => section.id)).toEqual(['a', 'empty', 'b'])
    const before = structuredClone(active)
    expect(reorderSection(active, 'missing', 'a')).toBe(false)
    expect(reorderSection(active, 'a', 'a')).toBe(false)
    expect(active).toEqual(before)
  })
  it('preserves custom colour through copies, sharing and history without changing training classification', () => {
    const r = routine(), id = addSection(r, { ...SECTION_PRESETS[0], color: '#BB44EE' })
    assignSection(r, r.ex[0].occurrenceId, id)
    expect(r.sections.find(s => s.id === id).color).toBe('#bb44ee')
    const copy = remapSections(structuredClone(r))
    expect(copy.sections.at(-1).color).toBe('#bb44ee')
    const source = { ...state(), routines: [r], week: {}, customEx: [] }
    const imported = parsePlan(buildPlanBundle(source, 'Phases'))
    const target = { routines: [], week: {}, customEx: [] }
    mergePlan(target, imported)
    expect(target.routines[0].sections.at(-1).color).toBe('#bb44ee')
    const session = buildSessionEntries(source, r)
    session.entries.forEach(entry => entry.sets.forEach(set => { set.done = true }))
    const saved = buildCompletedWorkout({ ...session, start: 1 }, { end: 2 })
    updateSection(r, id, { color: '#123456' })
    expect(saved.entries.at(-1).section.color).toBe('#bb44ee')
    expect(countsAsWork(saved.entries.at(-1))).toBe(false)
  })
  it('validates colour at the shared boundary and preserves colour-free legacy metadata', () => {
    const phase = { ...SECTION_PRESETS[2], id: 'work' }
    expect(cleanSections([phase])[0]).toEqual(phase)
    for (const color of ['red', '#123', '#123456;url(x)', {}, null]) expect(() => cleanSections([{ ...phase, color }])).toThrow('Invalid phase colour')
    expect(sectionColor(phase)).toBe('#6da9ff')
    const r = routine(), id = addSection(r, { ...SECTION_PRESETS[0], color: '#123456' })
    updateSection(r, id, { color: undefined })
    expect(r.sections.at(-1)).not.toHaveProperty('color')
    expect(sectionColor(r.sections.at(-1))).toBe('#ffb340')
  })
  it('preserves a flat routine until opted in and permits a preparation-only session', () => {
    const r = routine(), before = structuredClone(r)
    buildSessionEntries(state(), r)
    expect(r).toEqual(before)
    const warm = addSection(r, SECTION_PRESETS[0])
    expect(r.sections.map(s => s.type)).toEqual(['work', 'warmup'])
    assignSection(r, r.ex[0].occurrenceId, warm)
    expect(r.ex.map(e => countsAsWork(e))).toEqual([true, false])
    const only = { ex: [] }
    addSection(only, SECTION_PRESETS[5])
    expect(only.sections).toHaveLength(1)
    only.ex.push({ id: '0025', sectionId: only.sections[0].id, mode: 'time', sets: 1, sec: 30 })
    const session = buildSessionEntries(state(), only)
    session.entries[0].sets[0].done = true
    const saved = buildCompletedWorkout({ ...session, id: 'prep-only', start: 1 }, { end: 2 })
    expect(saved.entries[0].sets[0].done).toBe(true)
    expect(workoutVolume(saved)).toBe(0)
  })
  it('moves groups intact, preserves logged rows and removes only the section', () => {
    const r = routine(); r.ex.forEach(e => { e.sg = 'pair' })
    const warm = addSection(r, SECTION_PRESETS[0]), main = r.sections[0].id
    const ids = r.ex.map(e => e.occurrenceId)
    assignSection(r, ids[0], warm)
    expect(r.ex.every(e => e.sectionId === warm)).toBe(true)
    moveSection(r, warm, -1)
    expect(r.ex.map(e => e.occurrenceId)).toEqual(ids)
    expect(removeSection(r, warm, 'missing')).toBe(false)
    removeSection(r, warm, main)
    expect(r.ex).toHaveLength(2)
    removeSection(r, main)
    expect(r.sections).toBeUndefined()
    expect(r.ex.every(countsAsWork)).toBe(true)
  })
  it('snapshots eligibility through logging without removing activity from fatigue', () => {
    const r = routine(), warm = addSection(r, SECTION_PRESETS[0])
    const prep = r.ex[0].occurrenceId
    assignSection(r, prep, warm); moveSection(r, warm, -1)
    const st = state()
    st.exWeights['0025'] = { w: 140 }
    const session = buildSessionEntries(st, r)
    expect(session.entries[0].sets[0].w).toBe(40)
    expect(session.entries[0].plan.policy).toBe('off')
    const active = { ...session, id: 'w', d: '2026-09-06', start: 1, routineId: 'r', name: 'Phases' }
    active.entries.forEach(e => e.sets.forEach(s => { s.done = true }))
    active.entries[0].sets[0].w = 200 // prep must never win a strength record
    const saved = buildCompletedWorkout(active, { end: 2 })
    const history = { ...st, workouts: [saved] }
    expect(workoutVolume(saved)).toBe(saved.entries[1].sets[0].w * 5)
    expect(lastEntryFor(history, '0025').sets[0].w).toBe(saved.entries[1].sets[0].w)
    expect(lastEntryFor(history, '0025', r.ex[0])).toBeNull()
    expect(lastDisplayEntryFor(history, '0025', r.ex[0]).sets[0].w).toBe(200)
    expect(lastDisplayEntryFor(history, '0025', { ...r.ex[0], occurrenceId: 'new-copy' })).toBeNull()
    expect(lastDisplayEntryFor(history, '0025', 'copied-routine', { ...r.ex[0], occurrenceId: 'new-copy' })).toBeNull()
    expect(best1RM(history, '0025').w).toBe(saved.entries[1].sets[0].w)
    expect(nextPrescription(history, r.ex[0], r).policy).toBe('off')
    const prepOnly = { ...saved, entries: [saved.entries[0]] }
    expect(Object.values(fatigueOf([prepOnly], 2)).some(v => v > 0)).toBe(true)
    expect(Object.values(strengthOf([prepOnly], 2)).every(v => v === 0.5)).toBe(true)
    updateSection(r, warm, { label: 'Changed', countsAsWork: true })
    expect(saved.entries[0].section.label).toBe('Warm-up')
    expect(countsAsWork(saved.entries[0])).toBe(false)
  })
  it('validates metadata and copies independent identities', () => {
    expect(() => cleanSections([{ id: 'a' }])).toThrow()
    const r = routine(); addSection(r, SECTION_PRESETS[2])
    const copy = remapSections(structuredClone(r))
    expect(copy.sections[0].id).not.toBe(r.sections[0].id)
    expect(copy.ex[0].sectionId).toBe(copy.sections[0].id)
    expect(copy.ex[0].occurrenceId).not.toBe(r.ex[0].occurrenceId)
  })
  it('does not pair across a phase boundary', () => {
    const rows = [{ id: 'a', sectionId: 'a' }, { id: 'b', sectionId: 'b' }]
    expect(pairAdjacent(rows, 0, 1)).toEqual(rows)
  })
  it('keeps repeated work occurrences distinct after exercise order changes', () => {
    const r = routine(); addSection(r, SECTION_PRESETS[2])
    const session = buildSessionEntries(state(), r)
    session.entries.forEach((entry, i) => { entry.sets[0] = { done: true, w: i ? 80 : 40, r: 5 } })
    const history = { ...state(), workouts: [buildCompletedWorkout({ ...session, start: 1 }, { end: 2 })] }
    r.ex.reverse()
    expect(lastEntryFor(history, '0025', r.ex[0]).sets[0].w).toBe(80)
    expect(lastEntryFor(history, '0025', r.ex[1]).sets[0].w).toBe(40)
  })
  it('keeps per-exercise warm-up sets separate from whole-workout phases', () => {
    const r = routine(); r.ex[1].warmupSets = 1
    const prep = addSection(r, SECTION_PRESETS[0]); assignSection(r, r.ex[0].occurrenceId, prep)
    const session = buildSessionEntries(state(), r)
    const work = session.entries.find(e => e.section.countsAsWork)
    expect(work.sets.filter(s => s.warmup === true)).toHaveLength(1)
    expect(work.sets.filter(s => !s.warmup)).toHaveLength(1)
    expect(session.entries.find(e => e.sectionId === prep).sets).toHaveLength(1)
  })
})
