import { afterEach, describe, expect, it } from 'vitest'
import { loggedExposure } from './test-fixtures.js'
import { workoutText } from './workout-text.js'
import { fmtDate } from './format.js'
import { EXIDX } from './exercises.js'
import { EXERCISE_NAME_LANGS, _setLangState, exerciseNameFor } from './i18n-core.js'

// Discord 'Improvement ideas': a past workout copied as plain text to paste anywhere.
describe('workoutText', () => {
  const names = { bench: 'barbell bench press', curl: 'dumbbell curl', pushdown: 'cable pushdown', run: 'run' }
  const nameOf = e => names[e.id] || e.id
  const w = {
    id: 'w1', d: '2026-09-03', start: 0, end: 58 * 60000, name: 'Push', vol: 1790, bw: 80,
    note: 'Felt strong.',
    entries: [
      { id: 'bench', target: { mode: 'reps' }, note: 'narrower grip', sets: [
        { w: 40, r: 8, done: true, phase: 'warmup' },
        { w: 60, r: 8, done: true },
        { w: 60, r: 6, done: true, type: 'dropset', drops: [{ w: 45, r: 6 }] },
        { w: 60, r: 8, done: false },
      ] },
      { id: 'curl', sg: 'sg1', target: { mode: 'reps' }, sets: [{ w: 12, r: 10, done: true }] },
      { id: 'pushdown', sg: 'sg1', target: { mode: 'reps' }, sets: [{ w: 20, r: 12, done: true }] },
      { id: 'run', target: { mode: 'cardio' }, sets: [{ min: 20, speed: 10, done: true }] },
    ],
  }

  it('reads as the heading, each exercise with its work sets, supersets together, then the note', () => {
    expect(workoutText(w, { unit: 'kg', nameOf })).toBe([
      `Push — ${fmtDate('2026-09-03', true, true)}`,
      '58 min · 1,790 kg · Body weight 80 kg',
      '',
      'Barbell Bench Press',
      '60×8, 60×6 ↘ 45×6',
      'narrower grip',
      '',
      'Superset',
      'Dumbbell Curl',
      '12×10',
      'Cable Pushdown',
      '20×12',
      '',
      'Run',
      '20 min @ 10 km/h',
      '',
      'Felt strong.',
    ].join('\n'))
  })

  it('leaves out what was not trained and what was never recorded', () => {
    const bare = { d: '2026-09-03', start: 5, end: 5, vol: 120, name: 'Legs', entries: [
      { id: 'bench', target: { mode: 'reps' }, sets: [{ w: 40, r: 8, done: true, phase: 'warmup' }] },
      { id: 'curl', sg: 'sg1', target: { mode: 'reps' }, sets: [{ w: 12, r: 10, done: true }] },
      { id: 'pushdown', sg: 'sg1', target: { mode: 'reps' }, sets: [{ w: 20, r: 12, done: false }] },
    ] }
    // no clock, no weigh-in, no note; an exercise with only a warm-up drops out, and a superset
    // with one member left trained is just that exercise
    expect(workoutText(bare, { unit: 'lb', nameOf })).toBe(`Legs — ${fmtDate('2026-09-03', true, true)}\n120 lb\n\nDumbbell Curl\n12×10`)
  })
})

// A combined session can pair the last exercise of one routine with the first of the next. The
// detail sheet splits the workout by routine first and shows those two apart, each in its own
// section; the copied text paired them over the flat list and wrote "Superset" above them.
describe('workoutText in a combined session', () => {
  const nameOf = e => e.id
  const row = (id, rid, sg) => ({ id, rid, ...(sg ? { sg } : {}), target: { mode: 'reps' }, sets: [{ w: 20, r: 10, done: true }] })
  const at = entries => ({ d: '2026-09-03', start: 0, end: 0, name: 'Push + Pull', vol: 0, routineIds: ['A', 'B'], entries })

  it('pairs a superset only inside one routine\'s section, as the detail sheet does', () => {
    const text = workoutText(at([row('press', 'A'), row('fly', 'A', 'x'), row('row', 'B', 'x'), row('curl', 'B')]), { unit: 'kg', nameOf })
    expect(text).not.toContain('Superset')
    expect(text.split('\n\n').slice(1)).toEqual(['Press\n20×10', 'Fly\n20×10', 'Row\n20×10', 'Curl\n20×10'])
  })

  it('keeps a superset inside one routine together, and lists each routine\'s exercises in its section', () => {
    // the curl was added to routine A late in the session, after routine B's exercises
    const text = workoutText(at([row('press', 'A', 'y'), row('fly', 'A', 'y'), row('row', 'B'), row('curl', 'A')]), { unit: 'kg', nameOf })
    expect(text.split('\n\n').slice(1)).toEqual(['Superset\nPress\n20×10\nFly\n20×10', 'Curl\n20×10', 'Row\n20×10'])
  })
})

// Cardio speed in the profile's unit, as the detail sheet above the button shows it (lib/speed.js).
describe('workoutText speed unit', () => {
  it('writes a run in mph when the profile shows mph, and in km/h by default', () => {
    const w = { d: '2026-09-03', start: 0, end: 0, name: 'Run', entries: [
      { id: 'run', target: { mode: 'cardio' }, sets: [{ min: 20, speed: 16.09344, done: true }] },
    ] }
    const nameOf = () => 'run'
    expect(workoutText(w, { unit: 'lb', nameOf, speedUnit: 'mph' }).split('\n').at(-1)).toBe('20 min @ 10 mph')
    expect(workoutText(w, { unit: 'kg', nameOf }).split('\n').at(-1)).toBe('20 min @ 16.1 km/h')
  })
})

// Copy as text has no CSS to title-case with, so it capitalises itself wherever the screen does
// (exerciseNameClass): every translated pack stored lower-case, and not German's own casing.
describe('workoutText exercise names per language', () => {
  const packs = import.meta.glob('../exercise-names/*.js', { eager: true, import: 'default' })
  const w = { id: 'w2', d: '2026-09-03', start: 0, end: 0, name: 'Push', vol: 0,
    entries: [{ id: '0025', target: { mode: 'reps' }, sets: [{ w: 60, r: 8, done: true }] }] }
  const nameLine = () => workoutText(w, { unit: 'kg', nameOf: e => exerciseNameFor(EXIDX[e.id]) }).split('\n\n')[1].split('\n')[0]
  afterEach(() => _setLangState('en', {}, null, null))

  it('keeps German as the pack writes it and title-cases the lower-case packs', () => {
    const expected = {
      de: 'Bankdrücken mit Langhantel', es: 'Press De Banca Con Barra', fr: 'Développé Couché À La Barre',
      it: 'Panca Piana Con Bilanciere', 'pt-BR': 'Supino Com Barra', ru: 'Жим Штанги Лёжа', hu: 'Fekvenyomás Rúddal',
    }
    for (const lang of EXERCISE_NAME_LANGS) {
      _setLangState(lang, {}, null, packs[`../exercise-names/${lang}.js`], false)
      expect(nameLine(), lang).toBe(expected[lang])
    }
    _setLangState('en', {}, null, null)
    expect(nameLine()).toBe('Barbell Bench Press')
  })
})

// A saved workout of the generic engine holds exposures, not entries: the same text comes out of them.
describe('workoutText of a saved workout with exposures', () => {
  it('lists each exercise\'s completed work sets and leaves the warm-up out', () => {
    const w = { d: '2026-09-03', start: 0, end: 0, vol: 0, name: 'Push', exposures: [
      loggedExposure('bench', [{ role: 'warmup', w: 40, r: 8 }, { w: 60, r: 5 }, { w: 60, r: 4 }, { w: 60, r: 3, done: false }]),
    ] }
    const text = workoutText(w, { unit: 'kg', nameOf: () => 'Bench', prescriptions: {} })
    expect(text.split('\n\n')[1]).toBe('Bench\n60×5, 60×4')
  })
})
