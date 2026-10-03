import { expect, it } from 'vitest'
import { migrateProfileV1ToV2, validateCanonicalProfile } from '../../../api/migration/profile-migration.js'
import { LIB_BY_ID } from '../../../api/coach/core/library.js'
import { contentHash, currentOneRm, replayProgression } from '../../../api/engine/index.js'
import { convertStateUnit, convertPlanRuleUnit } from './units.js'
import { mergeStates } from './sync-merge.js'
import { buildPlanBundle, parsePlan } from './plan-share.js'
const log = (id, weight = 60, day = 1, reps = 5) => ({ id, _ts: day, d: `2026-01-${String(day).padStart(2, '0')}`, start: Date.UTC(2026, 0, day), entries: [{ id: '0025', rid: 'r', planned: { sets: 3, reps: 5 }, target: { sets: 3, reps: 5, weight }, sets: Array.from({ length: 3 }, () => ({ w: weight, r: reps, done: true })) }] })
const legacy = (over = {}) => ({ unit: 'kg', _ts: 1, routines: [{ id: 'r', ex: [{ id: '0025', sets: 3, reps: 5, weight: 60, prog: 'linear' }] }], workouts: [log('w')], ...over })
const migrated = over => migrateProfileV1ToV2(legacy(over), LIB_BY_ID).profile
it('A23: canonical units keep dictionaries, hashes, labels and history valid', () => {
  const original = migrated(); original.coach = { snapshots: [{ routines: original.routines }] }
  const out = convertStateUnit(original, 'lb')
  expect(validateCanonicalProfile(out)).toEqual({ ok: true, errors: [] })
  expect(out.workouts[0]).not.toHaveProperty('entries')
  expect(out.workouts[0].exposures[0].performance.sets[0].resistance).toMatchObject({ value: 132.5, unit: 'lb' })
  const p = Object.values(out.prescriptions)[0], { contentHash: hash, ...body } = p
  expect(hash).toBe(contentHash(body)); expect(p.rows[0].load).toEqual({ value: 132.5, unit: 'lb' })
  expect(Object.values(out.oneRepMaxes)[0].unit).toBe('lb')
  expect(Object.values(out.progression)[0].lastActual.load.unit).toBe('lb')
  expect(out.coach.snapshots[0].routines[0].ex[0].rule.parameters.load.unit).toBe('lb')
  expect(original.workouts[0].exposures[0].performance.sets[0].resistance.unit).toBe('kg')
})
it('A23: relabelling changes canonical labels while retaining numbers', () => {
  const out = convertStateUnit(migrated(), 'lb', { convert: false })
  expect(Object.values(out.prescriptions)[0].rows[0].load).toEqual({ value: 60, unit: 'lb' })
  expect(out.routines[0].ex[0].rule.parameters.load).toEqual({ mode: 'absolute', value: 60, unit: 'lb' })
  expect(out.workouts[0].exposures[0].actual.load).toEqual({ value: 60, unit: 'lb' })
  expect(validateCanonicalProfile(out).ok).toBe(true)
})
it('A23: allowed loads and load completion thresholds convert', () => {
  const rule = migrated().routines[0].ex[0].rule
  rule.rounding = { mode: 'allowed_values', allowedValues: [20, 40, 60] }; rule.completion = [{ metric: 'training_max', target: 100 }]
  rule.special = { trainingMax: { mode: 'direct', value: 80, unit: 'kg' }, endOfCycleIncrement: { value: 2.5, unit: 'kg' } }
  const out = convertPlanRuleUnit(rule, 'kg', 'lb')
  expect(out.rounding).toEqual({ mode: 'allowed_values', allowedValues: [44, 88, 132.5] })
  expect(out.completion[0].target).toBe(220.5); expect(out.special.endOfCycleIncrement).toEqual({ value: 5.5, unit: 'lb' })
})
it('A24: merge deduplicates both audits including original malformed values', () => {
  const a = migrated(), b = migrated({ routines: [{ id: 'b', ex: [{ id: '0025', prog: 'wave' }] }], workouts: [] })
  b.migrationAudit.discarded = [{ path: 'workouts[4]', value: { broken: true } }]
  const out = mergeStates(a, b)
  expect(out.migrationAudit.unsupported).toEqual(b.migrationAudit.unsupported)
  expect(out.migrationAudit.discarded).toEqual(b.migrationAudit.discarded)
  expect(mergeStates(out, b).migrationAudit).toEqual(out.migrationAudit)
})
it('A25: a retained edited workout resolves its own prescription', () => {
  const a = migrated({ _ts: 20, workouts: [log('w', 40)] }), b = migrated({ _ts: 10, workouts: [{ ...log('w', 20), _ts: 30 }] })
  const out = mergeStates(a, b), x = out.workouts[0].exposures[0]
  expect(out.prescriptions[x.prescriptionId].rows[0].load.value).toBe(20); expect(validateCanonicalProfile(out).ok).toBe(true)
})
it('A25: independent histories retain their strongest derived 1RM', () => {
  const out = mergeStates(migrated({ workouts: [log('light', 60)] }), migrated({ workouts: [log('heavy', 100, 2)] }))
  expect(currentOneRm(out.oneRepMaxes, '0025').value).toBe(116.7); expect(validateCanonicalProfile(out).ok).toBe(true)
})
it('A46: interleaved merged misses replay all retained logs', () => {
  const out = mergeStates(migrated({ workouts: [log('w1', 60, 1, 3), log('w3', 60, 3, 3)] }), migrated({ workouts: [log('w2', 60, 2, 3)] }))
  const trackId = Object.keys(out.progression)[0]
  expect(out.progression[trackId].stalls).toBe(3); expect(out.progression[trackId].readyToDeload).toBe(true)
  expect(out.progression[trackId]).toEqual(replayProgression({ workouts: out.workouts, prescriptions: out.prescriptions, trackId }))
})
it('A49: canonical and legacy shared plans retain execution and warmup settings', () => {
  const flags = { side: true, bodyweight: false, assisted: true, excludeFromProgression: true, warmupRestSec: 35 }
  const routines = [{ id: 'r', ex: [{ id: '0025', sets: 3, reps: 5, weight: 60, prog: 'linear', ...flags }] }]
  const profile = migrated({ workouts: [], routines }); Object.assign(profile.routines[0].ex[0], flags)
  expect(parsePlan(buildPlanBundle(profile, 'flags')).routines[0].ex[0]).toMatchObject(flags)
  expect(parsePlan({ opengym_plan: 1, ...legacy({ workouts: [], routines }) }).routines[0].ex[0]).toMatchObject(flags)
})
it('A25: repeated divergent-copy merges reuse remapped frozen ids', () => {
  const a = migrated({ workouts: [log('w', 40)] }), b = migrated({ workouts: [{ ...log('w', 20), _ts: 30 }] })
  const once = mergeStates(a, b), twice = mergeStates(once, b)
  expect(Object.keys(twice.prescriptions)).toEqual(Object.keys(once.prescriptions))
  expect(twice.workouts).toEqual(once.workouts)
})
it('A23: each preset keeps a valid frozen prescription when converting units', async () => {
  const { PRESET_IDS, defaultPlanRule, generatePrescription, validatePlanRule } = await import('../../../api/engine/index.js')
  for (const preset of PRESET_IDS) {
    const rule = defaultPlanRule(preset, { id: preset, exerciseId: '0025', routineId: 'r', unit: 'kg' })
    const oneRm = { id: 'rm', exerciseId: '0025', value: 100, unit: 'kg', source: 'manual', capturedAt: '2026-01-01T00:00:00.000Z' }
    const p = generatePrescription({ id: preset, now: oneRm.capturedAt, trackId: preset, rule, oneRm, warmup: { mode: 'smart', count: 2 } })
    const profile = { engineSchemaVersion: 2, unit: 'kg', routines: [{ id: 'r', ex: [{ occurrenceId: preset, exerciseId: '0025', rule }] }], workouts: [], prescriptions: { [preset]: p }, oneRepMaxes: { rm: oneRm }, progression: {} }
    const converted = convertStateUnit(profile, 'lb')
    expect(validatePlanRule(converted.routines[0].ex[0].rule).ok, preset).toBe(true)
    expect(validateCanonicalProfile(converted), preset).toEqual({ ok: true, errors: [] })
    if (preset === 'five_three_one') expect(converted.prescriptions[preset].special.endOfCycleIncrement).toEqual({ value: 5.5, unit: 'lb' })
  }
})
it('A23: hold stall duration is preserved during a load-unit conversion', () => {
  const profile = migrated({ routines: [{ id: 'r', ex: [{ id: '0025', mode: 'time', sec: 45, sets: 1, prog: 'time' }] }], workouts: [{ id: 'w', start: 1, entries: [{ id: '0025', rid: 'r', target: { mode: 'time', sets: 1, sec: 45 }, sets: [{ done: true, sec: 30 }] }] }] })
  expect(Object.values(convertStateUnit(profile, 'lb').progression)[0].stallLoad).toBe(45)
})
