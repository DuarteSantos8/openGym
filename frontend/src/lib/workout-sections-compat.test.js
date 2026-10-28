// @vitest-environment happy-dom
import { expect, it } from 'vitest'
import { SECTION_PRESETS, addSection, assignSection, updateSection } from './workout-sections.js'
import { buildPlanBundle, parsePlan, mergePlan, planPrintHTML } from './plan-share.js'
import { normalizeState, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { finishWorkout } from '../sheets.jsx'
import { planHash, markStale, applyChangeSet } from './coach.js'
import { canonicalPlan as serverPlan, cleanPlan } from '../../../api/coach/core/payload.js'
import { hashPlan } from '../../../api/coach/core/plan-hash.js'
import { validateReview } from '../../../api/coach/core/validate.js'
import { buildRoutineSession as buildSessionEntries } from './session-start.js'
import { buildCompletedWorkout } from './finish-workout.js'
import { reorderRoutineUnit } from '../views/RoutineEdit.jsx'

const sample = () => {
  const r = { id: 'r', name: 'Phased workout', ex: [{ id: '0025', sets: 2, reps: 5, weight: 50 }, { id: '0047', sets: 2, reps: 8, weight: 20 }] }
  const warm = addSection(r, SECTION_PRESETS[0])
  assignSection(r, r.ex[1].occurrenceId, warm)
  return normalizeState({ routines: [r], workouts: [], unit: 'kg', week: {}, exWeights: {} })
}

it('round-trips sections through versioned sharing and restores separate preset/session snapshots', () => {
  const s = sample(), bundle = buildPlanBundle(s, 'Phases')
  expect(bundle.opengym_plan).toBe(2)
  const parsed = parsePlan(bundle)
  expect(parsed.opengym_plan).toBe(2)
  expect(parsed.routines[0].sections).toEqual(s.routines[0].sections)
  expect(planPrintHTML(s)).toContain('<h3 class="phase">Warm-up</h3>')
  const destination = normalizeState()
  mergePlan(destination, parsed, { schedule: false })
  expect(destination.routines[0].sections[0].id).not.toBe(s.routines[0].sections[0].id)
  expect(destination.routines[0].ex.map(e => e.section.countsAsWork)).toEqual([true, false])
  s.active = { id: 'active', ...buildSessionEntries(s, s.routines[0]) }
  s.sectionPresets = [{ id: 'custom', type: 'custom', label: 'Technique', countsAsWork: false }]
  const restored = normalizeState(JSON.parse(JSON.stringify(s)))
  expect(restored.active.sections).toEqual(s.active.sections)
  expect(restored.sectionPresets).toEqual(s.sectionPresets)
  bundle.routines[0].ex[0].sectionId = 'missing'
  expect(() => parsePlan(bundle)).toThrow(/phase/)
})


it('allows in-phase drag to the last position while keeping a following phase intact', () => {
  const rows = [{ id: 'a', sectionId: 'work' }, { id: 'b', sectionId: 'work' }, { id: 'c', sectionId: 'stretch' }]
  expect(reorderRoutineUnit(rows, 0, 1)).toBe(true)
  expect(rows.map(e => e.id)).toEqual(['b', 'a', 'c'])
  expect(reorderRoutineUnit(rows, 0, 2)).toBe(false)
})

it('hashes phase settings identically and prevents stale or ambiguous Coach changes', () => {
  const s = sample(), r = s.routines[0]
  expect(planHash(s)).toBe(hashPlan(serverPlan(s)))
  expect(cleanPlan(s).routines[0].sections).toEqual(r.sections)
  const proposal = { id: 'p', kind: 'review', planHash: planHash(s), changes: [{ id: 'c', type: 'sets', target: { routineId: 'r', exId: '0025' }, before: 2, after: 3, why: 'Progress', status: 'proposed' }] }
  expect(applyChangeSet(s, proposal, ['c']).applied).toBe(1)
  expect(r.ex[0].sectionId).toBe(r.sections[0].id)
  updateSection(r, r.sections[0].id, { label: 'Changed main phase' })
  expect(markStale(proposal, s).changes[0].status).toBe('stale')
  expect(() => applyChangeSet(s, proposal, ['c'])).toThrow(/phases/)
  r.ex.push({ ...r.ex[0], occurrenceId: 'second' })
  const fresh = { ...proposal, planHash: planHash(s) }
  expect(() => applyChangeSet(s, fresh, ['c'])).toThrow(/ambiguous/)
  expect(validateReview({ coach_contract: 1, changes: fresh.changes }, cleanPlan(s)).ok).toBe(false)
})

it('does not transmit arbitrary fields attached to a phase snapshot to Coach', () => {
  const s = sample()
  s.routines[0].ex[0].section.secret = 'private'
  s.routines[0].ex[0].occurrenceId = { secret: 'private' }
  expect(JSON.stringify(cleanPlan(s))).not.toContain('private')
})

it('finishes repeated exercises through the real completion path without preparation records', () => {
  const previous = useStore.getState().S
  const s = sample(), routine = s.routines[0]
  routine.ex[1].id = routine.ex[0].id
  routine.ex.push({ ...routine.ex[0], occurrenceId: 'second-work' })
  s.sound = false
  s.active = { ...buildSessionEntries(s, routine), id: 'completed-phases', name: routine.name, d: '2026-09-07', start: Date.now() - 1000 }
  s.active.entries.forEach(entry => entry.sets.forEach(row => { row.done = true; row.w = entry.section.countsAsWork ? 50 : 200 }))
  useStore.setState({ S: s, user: null })
  try {
    expect(() => finishWorkout()).not.toThrow()
    const state = useStore.getState().S, saved = state.workouts.at(-1)
    expect(state.active).toBeNull()
    expect(saved.entries).toHaveLength(3)
    expect(saved.prs).toEqual(['0025'])
    expect(saved.vol).toBe(1000)
    expect(state.exWeights['0025'].w).toBe(50)
  } finally {
    useStore.setState({ S: previous })
    useUI.setState({ sheets: [] })
  }
})

it('rejects broken phase membership and keeps imports independent of the source', () => {
  const s = sample(), original = buildPlanBundle(s, 'Phases')
  const duplicate = structuredClone(original)
  duplicate.routines[0].ex[1].occurrenceId = duplicate.routines[0].ex[0].occurrenceId
  expect(() => parsePlan(duplicate)).toThrow(/occurrence/)
  const crossed = structuredClone(original)
  crossed.routines[0].ex.forEach(entry => { entry.sg = 'same-group' })
  expect(() => parsePlan(crossed)).toThrow(/spans workout phases/)
  const injected = structuredClone(original)
  injected.routines[0].sections[0].color = 'red;url(x)'
  expect(() => parsePlan(injected)).toThrow(/colour/)
  const parsed = parsePlan(original)
  parsed.routines[0].sections[0].label = 'Recipient edit'
  expect(original.routines[0].sections[0].label).toBe('Main work')
})
