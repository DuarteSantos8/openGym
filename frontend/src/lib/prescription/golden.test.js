// Golden master of the engine's behaviour: every preset driven through the same scripted
// sessions the way the app drives it (resolveProgressionContext → generatePrescription →
// summarizeActual → advanceProgression), recording what each session opens with. Recorded from
// the engine before the program rewrite; the rewrite must reproduce it, except for the entries
// listed in DELIBERATE (each one named, tested elsewhere and documented).
// Re-record only on purpose: GOLDEN_WRITE=1 npx vitest run src/lib/prescription/golden.test.js
import { readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { advanceProgression, defaultPlanRule, generatePrescription, replayProgression, resolveProgressionContext, summarizeActual } from '../../../../api/engine/index.js'

const FIXTURE = new URL('./golden.json', import.meta.url)
const DAY = 86400000
const T0 = Date.parse('2026-01-05T10:00:00Z')

// The only format-specific part: a preset's rule from flat template numbers.
const rule = (preset, { revision = 1, ...opts } = {}) => ({ ...defaultPlanRule(preset, { id: 'rule', exerciseId: 'ex', unit: 'kg', ...opts }), revision })

const kg = value => ({ mode: 'absolute', value, unit: 'kg' })
const fixed = n => ({ min: n, max: n })

// One scripted session: the per-set actuals the workout screen would hand to finish-session.
function perform(p, outcome, gen) {
  const timed = !!p.parameters.durationSeconds
  const load = (row, i) => {
    const base = row.load?.value ?? p.prefill.load?.value ?? null
    // A loaded row left at 0 reads as 0 (actualOfRow); an unloaded one has no weight at all.
    if (outcome === 'noload') return base == null ? null : 0
    if (outcome === 'add10') return 10
    if (base == null) return null
    if (outcome === 'light') return gen.assisted ? base + 5 : Math.max(0, base - 5)
    if (outcome === 'heavy') return gen.assisted ? Math.max(0, base - 5) : base + 5
    return base
  }
  const reps = (row, i, last) => {
    if (row.max) return row.reps.min + 2
    if (outcome === 'top') return row.amrap ? row.reps.min * 2 : row.reps.max
    if (outcome === 'bad') return Math.max(0, row.reps.min - 2)
    if (outcome === 'miss' && last) return Math.max(0, row.reps.min - 1)
    return row.reps.min
  }
  const seconds = last => {
    const w = p.parameters.durationSeconds
    if (outcome === 'top') return w.max
    if (outcome === 'bad' || (outcome === 'miss' && last)) return Math.max(5, p.prefill.durationSeconds - 10)
    return p.prefill.durationSeconds
  }
  const rows = p.rows.map((row, i) => {
    const last = i === p.rows.length - 1
    const w = load(row, i)
    return {
      row: i, reps: timed ? null : reps(row, i, last), load: w == null ? null : { value: w, unit: 'kg' },
      durationSeconds: timed ? seconds(last) : null, rir: outcome === 'rir0' ? 0 : null, rpeEntered: null, ...(row.max ? { max: true } : {})
    }
  })
  // Sets added mid-session have no prescribed row (session-ui-adapter actualOfRow: row Infinity).
  if (outcome === 'top') for (let k = rows.length; k < p.parameters.sets.max; k++) rows.push({ ...rows.at(-1), row: Infinity })
  return rows
}

const performanceOf = (performed, max) => performed.map(s => ({
  prescribed: Number.isFinite(s.row), ...(Number.isFinite(s.row) ? { setId: 'r' + s.row } : {}), role: 'work', status: 'completed',
  observations: [...(s.reps != null ? [{ metric: 'repetitions', unit: 'reps', value: s.reps }] : []), ...(s.durationSeconds != null ? [{ metric: 'duration', unit: 's', value: s.durationSeconds }] : [])],
  resistance: s.load ? { kind: 'external-load', value: s.load.value, unit: 'kg' } : { kind: 'bodyweight' },
  ...(s.max ? { max: true } : {}), segments: []
}))

const project = p => ({
  rows: p.rows.map(r => `${r.reps.min}-${r.reps.max}@${r.load?.value ?? '-'}${r.amrap ? ' amrap' : ''}${r.max ? ' max' : ''}`),
  prefill: [p.prefill.sets, p.prefill.reps, p.prefill.durationSeconds ?? null, p.prefill.load?.value ?? null, p.prefill.carried ? 'carried' : ''].join('|'),
  ...(p.parameters.durationSeconds ? { window: `${p.parameters.durationSeconds.min}-${p.parameters.durationSeconds.max}` } : {}),
  ...(p.trainingMax ? { tm: p.trainingMax.value } : {}),
  ...(p.warmupRows?.length ? { warmup: p.warmupRows.map(r => `${r.reps?.min ?? r.reps}@${r.load?.value}`) } : {}),
  ...(p.statusAtGeneration !== 'active' ? { status: p.statusAtGeneration } : {}),
  ...(p.provenance.deload ? { deload: `${p.provenance.deload.from}>${p.provenance.deload.to} ${p.provenance.deload.method}${p.provenance.deload.reps != null ? ' r' + p.provenance.deload.reps : ''}` } : {}),
  rest: p.parameters.restSeconds
})

// Drives one scenario the way the store does: a step is an outcome, or { edit } (a saved plan change).
function run({ preset, opts = {}, gen = {}, script }) {
  let r = rule(preset, opts)
  const profile = { workouts: [], prescriptions: {}, progression: {}, oneRepMaxes: {} }
  const out = []
  script.forEach((step, k) => {
    if (step.edit) { r = rule(preset, { ...opts, ...step.edit, revision: r.revision + 1 }); out.push({ edit: step.edit }); return }
    const ctx = resolveProgressionContext({ trackId: 't', exerciseId: 'ex', rule: r, assisted: !!gen.assisted, workouts: profile.workouts, prescriptions: profile.prescriptions, progression: profile.progression })
    const p = generatePrescription({
      id: 'p' + k, now: new Date(T0 + k * DAY).toISOString(), trackId: 't', rule: r, state: ctx.state, lastPrescription: ctx.lastPrescription,
      lastLog: ctx.baseline && { ...ctx.baseline, id: ctx.baseline.exposureId }, reset: ctx.reset, heldLoad: ctx.heldLoad, startFrom: gen.startFrom,
      oneRm: gen.oneRm ? { id: 'orm', exerciseId: 'ex', value: gen.oneRm, unit: 'kg' } : null, warmup: gen.warmup ?? null, equipment: gen.equipment ?? null,
      assisted: gen.assisted, perSide: !!gen.perSide, restPause: !!gen.restPause, restPauseReps: gen.restPauseReps ?? null
    })
    out.push(project(p))
    if (step === 'skip') return
    profile.prescriptions[p.id] = p
    const performed = perform(p, step, gen)
    const actual = summarizeActual(p, performed)
    const exposure = { exposureId: 'x' + k, exerciseId: 'ex', trackId: 't', prescriptionId: p.id, actual, performance: { sets: performanceOf(performed) }, audit: [], completedAt: new Date(T0 + k * DAY + 3600000).toISOString() }
    profile.progression.t = advanceProgression({ state: profile.progression.t || null, prescription: p, log: { id: exposure.exposureId, actual, performance: exposure.performance }, now: exposure.completedAt })
    profile.workouts.push({ id: 'w' + k, d: new Date(T0 + k * DAY).toISOString().slice(0, 10), start: T0 + k * DAY, exposures: [exposure] })
  })
  const replayed = replayProgression({ workouts: profile.workouts, trackId: 't', prescriptions: profile.prescriptions })
  return { out, live: profile.progression.t ?? null, replayed }
}

const SCENARIOS = {
  linear_basic: { preset: 'linear', opts: { load: kg(60) }, script: ['hit', 'hit', 'miss', 'miss', 'miss', 'hit', 'light', 'hit', 'heavy', 'skip', 'hit', 'rir0'] },
  linear_rir_floor: { preset: 'linear', opts: { load: kg(60), rir: { min: 2, max: 3 } }, script: ['hit', 'rir0', 'hit'] },
  linear_percent: { preset: 'linear', opts: { load: { mode: 'percent_1rm', percent: 70 }, step: { type: 'percentage_points', value: 2.5 } }, gen: { oneRm: 100 }, script: ['hit', 'hit', 'miss', 'miss', 'miss', 'hit'] },
  linear_unweighted: { preset: 'linear', opts: { load: kg(0) }, script: ['noload', 'noload', 'add10', 'hit', 'noload', 'hit'] },
  linear_edits: { preset: 'linear', opts: { load: kg(60) }, script: ['hit', 'hit', { edit: { reps: fixed(8) } }, 'hit', 'hit', { edit: { reps: fixed(8), load: kg(80) } }, 'hit', { edit: { reps: fixed(8), load: kg(80), step: { type: 'absolute', value: 5, unit: 'kg' } } }, 'hit', 'hit'] },
  linear_assisted: { preset: 'linear', opts: { load: kg(40), step: { type: 'absolute', value: 5, unit: 'kg' }, target: { mode: 'none' }, completion: [] }, gen: { assisted: true }, script: ['hit', 'hit', 'miss', 'miss', 'miss', 'hit', 'hit', 'hit', 'hit', 'hit', 'hit', 'hit', 'hit'] },
  linear_per_side: { preset: 'linear', opts: { load: kg(20), reps: fixed(10) }, gen: { perSide: true }, script: ['miss', 'miss', 'miss', 'hit'] },
  linear_rest_pause: { preset: 'linear', opts: { load: kg(50) }, gen: { restPause: true, restPauseReps: 12 }, script: ['hit', 'miss', 'miss', 'miss', 'hit'] },
  linear_target: { preset: 'linear', opts: { load: kg(60), target: kg(65), completion: [{ metric: 'target_load', target: null }] }, script: ['hit', 'hit', 'hit', 'hit', 'hit', { edit: { load: kg(60), target: kg(70), completion: [{ metric: 'target_load', target: null }] } }, 'hit', 'hit'] },
  linear_start_last: { preset: 'linear', opts: { load: kg(60) }, gen: { startFrom: 'last' }, script: ['miss', 'hit', 'bad', 'hit'] },
  linear_warmup: { preset: 'linear', opts: { load: kg(100), target: { mode: 'none' }, completion: [] }, gen: { warmup: { mode: 'smart', count: 3 }, equipment: 'barbell' }, script: ['hit', 'hit'] },
  greyskull: { preset: 'greyskull', opts: { load: kg(50) }, script: ['hit', 'top', 'miss', 'hit', 'hit', 'bad', 'hit'] },
  double: { preset: 'double', opts: { load: kg(40) }, script: ['hit', 'hit', 'hit', 'hit', 'top', 'hit', 'miss', 'bad', 'bad', 'bad', 'hit', 'top'] },
  double_per_side: { preset: 'double', opts: { load: kg(16), reps: { min: 8, max: 12 } }, gen: { perSide: true }, script: ['hit', 'hit', 'top', 'bad', 'bad', 'bad', 'hit'] },
  double_unweighted: { preset: 'double', opts: { load: kg(0) }, script: ['noload', 'noload', 'add10', 'hit', 'top'] },
  triple: { preset: 'triple', opts: { load: kg(30) }, script: ['hit', 'top', 'top', 'hit', 'miss', 'miss', 'miss', 'hit'] },
  triple_fixed_sets: { preset: 'triple', opts: { load: kg(30), sets: fixed(3) }, script: ['hit', 'top', 'hit', 'top'] },
  manual: { preset: 'autoregulated', opts: { load: kg(30), reps: { min: 8, max: 12 } }, script: ['hit', 'top', 'light', 'heavy'] },
  manual_load_range: { preset: 'autoregulated', opts: { load: kg(30) }, script: ['hit', 'heavy'] },
  autoregulated: { preset: 'autoregulated', opts: { reps: { min: 8, max: 12 }, rir: { min: 1, max: 3 } }, script: ['hit', 'rir0', 'top'] },
  duration: { preset: 'autoregulated', opts: { reps: { min: 1, max: 1 }, durationSeconds: { min: 30, max: 60 }, restSeconds: 60, completion: [{ metric: 'max_duration', target: null }] }, script: ['hit', 'top', 'miss'] },
  hold_seconds: { preset: 'hold_seconds', script: ['hit', 'top', 'top', 'miss', 'miss', 'miss', 'top', 'hit', 'top'] },
  hold_seconds_capped: { preset: 'hold_seconds', opts: { completion: [{ metric: 'max_duration', target: 35 }] }, script: ['top', 'top', 'top', 'top'] },
  ladder: { preset: 'bodyweight_ladder', script: ['hit', 'hit', 'top', 'top', 'top', 'miss', 'top', 'top', 'top', 'top', 'top', 'top', 'top'] },
  ladder_open: { preset: 'bodyweight_ladder', opts: { completion: [] }, script: ['top', 'top', 'top', 'top', 'top', 'top', 'top', 'top', 'top', 'top', 'top', 'top', 'top', 'miss', 'top'] },
  ladder_per_side: { preset: 'bodyweight_ladder', gen: { perSide: true }, script: ['hit', 'top', 'miss', 'top'] },
  ladder_rungs: { preset: 'bodyweight_ladder', opts: { rungs: ['knee', 'full', 'archer'], completion: [{ metric: 'difficulty_rung', target: null }] }, script: ['hit', 'top', 'top', 'top', 'top', { edit: { rungs: ['knee', 'full', 'archer', 'one-arm'], completion: [] } }, 'top'] },
  ladder_loaded_linear: { preset: 'bodyweight_ladder', opts: { loadedPreset: 'linear', completion: [] }, script: ['hit', 'top', 'add10', 'hit', 'hit', 'miss', 'noload', 'hit'] },
  ladder_loaded_double: { preset: 'bodyweight_ladder', opts: { loadedPreset: 'double', loadedReps: { min: 6, max: 10 }, completion: [] }, script: ['hit', 'add10', 'hit', 'top', 'hit'] },
  unloaded_ladder_linear: { preset: 'linear', opts: { load: kg(0), unloadedLadder: true, repCeiling: 12 }, script: ['noload', 'noload', 'top', 'top', 'add10', 'hit', 'noload'] },
  unloaded_ladder_declared: { preset: 'linear', opts: { load: kg(20), unloadedLadder: true, repCeiling: 12, target: { mode: 'none' }, completion: [] }, script: ['noload', 'noload', 'noload', 'noload', 'add10', 'hit', 'hit'] },
  pyramid_reps: { preset: 'pyramid_reps', opts: { setReps: [12, 10, 'max', 8], setRest: [60, 60, 120, 90], sets: fixed(4), reps: fixed(12) }, script: ['hit', 'top', 'hit'] },
  pyramid: { preset: 'pyramid', opts: { load: kg(100), target: kg(200) }, script: ['hit', 'miss', 'hit', 'heavy'] },
  reverse_pyramid_rpt: { preset: 'pyramid', opts: { load: kg(100), target: kg(200), reps: fixed(6), offsets: [{ percentOfAnchor: 100 }, { percentOfAnchor: 90, reps: 8 }, { percentOfAnchor: 80, reps: 10 }] }, script: ['hit', 'hit', 'miss', 'bad', 'hit'] },
  five_three_one: { preset: 'five_three_one', opts: { trainingMax: { mode: 'direct', value: 100, unit: 'kg' }, completion: [{ metric: 'cycle_count', target: 2 }] }, script: ['hit', 'top', 'hit', 'hit', 'hit', 'miss', 'hit', 'hit', 'hit', 'hit'] },
  five_three_one_1rm: { preset: 'five_three_one', gen: { oneRm: 120 }, script: ['hit', 'hit', 'hit', 'hit', 'hit'] },
  // The templates the configurable engine adds (recorded with it).
  top_set_backoff: { preset: 'top_set_backoff', opts: { load: kg(100) }, script: ['hit', 'miss', 'light', 'bad', 'hit'] },
  top_set_backoff_all: { preset: 'top_set_backoff', opts: { load: kg(100), scope: 'all' }, script: ['hit', 'miss', 'hit'] },
  density: { preset: 'density', opts: { load: kg(30), completion: [{ metric: 'rest_floor', target: 45 }] }, script: ['hit', 'hit', 'miss', 'hit', 'hit', 'hit', 'hit', 'hit', 'hit', 'hit', 'hit', 'hit'] },
  accumulation_intensification: { preset: 'accumulation_intensification', opts: { trainingMax: { mode: 'direct', value: 100, unit: 'kg' }, intensification: { sets: 3, reps: 4, percent: 80, successes: 2 } }, script: ['hit', 'hit', 'miss', 'hit', 'top', 'hit', 'miss', 'hit', 'hit'] },
  accumulation_then_complete: { preset: 'accumulation_intensification', opts: { trainingMax: { mode: 'direct', value: 100, unit: 'kg' }, end: 'complete', reps: { min: 10, max: 11 }, intensification: { sets: 3, reps: 4, percent: 80, successes: 1 } }, script: ['hit', 'hit', 'hit', 'hit'] }
}
// Scenario keys whose recorded behaviour the rewrite changes on purpose (see the plan, "Deliberate differences").
export const DELIBERATE = []

describe('golden master', () => {
  const results = Object.fromEntries(Object.entries(SCENARIOS).map(([name, s]) => [name, run(s)]))
  if (process.env.GOLDEN_WRITE) writeFileSync(FIXTURE, JSON.stringify(Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.out])), null, 1) + '\n')
  const golden = JSON.parse(readFileSync(FIXTURE, 'utf8'))
  for (const name of Object.keys(SCENARIOS)) {
    it(`${name}: every session opens as recorded`, () => {
      if (DELIBERATE.includes(name)) return
      if (process.env.GOLDEN_SHOW) {
        const line = x => x.edit ? 'EDIT ' + JSON.stringify(x.edit) : [x.rows.join(','), 'pre=' + x.prefill, x.window ? 'win=' + x.window : '', x.tm ? 'tm=' + x.tm : '', x.status || '', x.deload ? 'DL ' + x.deload : '', 'rest=' + x.rest].filter(Boolean).join('  ')
        const got = results[name].out, want = golden[name] ?? []
        const out = got.map((x, i) => (JSON.stringify(x) === JSON.stringify(want[i]) ? '   ' : '!! ') + line(x) + (JSON.stringify(x) === JSON.stringify(want[i]) ? '' : '\n      was ' + (want[i] ? line(want[i]) : '-')))
        if (got.some((x, i) => JSON.stringify(x) !== JSON.stringify(want[i]))) console.log('## ' + name + '\n' + out.join('\n'))
      }
      expect(results[name].out).toEqual(golden[name])
    })
    it(`${name}: replaying the history gives the live state`, () => {
      expect(results[name].replayed).toEqual(results[name].live)
    })
  }
})
