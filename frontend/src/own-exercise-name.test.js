// P10 (1.4.5 UX round): a custom exercise called "am Turm" showed as "Am Turm" in the English
// UI, because it shared the catalogue's title-casing. A name the user typed is shown exactly as
// typed, wherever it appears: as an element (exerciseNameClass) and as plain text
// (exerciseNameText: toasts, the share card, the workout as text, the watch, the Live Activity).
// The catalogue keeps its rule (#290).
import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { registerCustom, EXIDX, isCustomEx } from './lib/exercises.js'
import { exerciseNameClass, exerciseNameFor } from './lib/i18n-core.js'
import { exerciseNameText } from './lib/format.js'
import { shareCardModel } from './lib/share-card.js'
import { workoutText } from './lib/workout-text.js'

const read = f => readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8')
const BENCH = Object.values(EXIDX).find(e => e.n === 'barbell bench press')
afterEach(() => registerCustom([]))

describe('own exercise names are shown as typed', () => {
  it('as an element and as text, with or without the custom flag on the stored entry', () => {
    // a plan import before 1.3.8 stored its exercises without the flag (isCustomEx)
    registerCustom([{ id: 'c-turm', n: 'am Turm', bp: 'back', eq: 'cable', custom: true }, { id: 'c-old', n: 'iPhone curl von unten', bp: 'arms', eq: 'cable' }])
    for (const id of ['c-turm', 'c-old']) {
      const ex = EXIDX[id]
      expect(isCustomEx(ex)).toBe(true)
      expect(exerciseNameClass(ex), id).toBe('')
      expect(exerciseNameText(ex), id).toBe(ex.n)
    }
    expect(exerciseNameText(EXIDX['c-turm'])).toBe('am Turm')
  })

  it('the catalogue keeps its title-casing (#290)', () => {
    expect(exerciseNameClass(BENCH)).toBe('capitalize')
    expect(exerciseNameText(BENCH)).toBe('Barbell Bench Press')
    expect(exerciseNameFor(BENCH)).toBe('barbell bench press')
  })

  it('the share card and the workout as text write it as typed, next to a title-cased catalogue lift', () => {
    registerCustom([{ id: 'c-turm', n: 'am Turm', bp: 'back', eq: 'cable', custom: true }])
    const sets = [{ w: 40, r: 10, done: true }, { w: 40, r: 9, done: true }]
    const w = { id: 'w1', d: '2026-11-10', start: Date.parse('2026-11-10T18:00:00'), end: Date.parse('2026-11-10T19:00:00'), name: 'Pull',
      entries: [{ id: 'c-turm', target: { mode: 'reps', sets: 2, reps: 10, weight: 40 }, sets }, { id: BENCH.id, target: { mode: 'reps', sets: 2, reps: 10, weight: 40 }, sets }] }
    const S = { unit: 'kg', workouts: [w], routines: [], customEx: [EXIDX['c-turm']] }
    const nameOf = e => exerciseNameFor(EXIDX[e.id])
    const card = shareCardModel(w, { state: S, unit: 'kg', nameOf })
    expect(card.lifts.map(l => l.name)).toEqual(['am Turm', 'Barbell Bench Press'])
    const text = workoutText(w, { state: S, unit: 'kg', nameOf })
    expect(text).toContain('am Turm')
    expect(text).not.toContain('Am Turm')
    expect(text).toContain('Barbell Bench Press')
  })

  it('no stylesheet title-cases a name that arrives already cased', () => {
    const css = read('./index.css')
    for (const sel of ['.cp-name', '.cp-st-n', '.cp-after']) {
      const rule = css.match(new RegExp(sel.replace('.', '\\.') + '\\{[^}]*\\}'))?.[0] || ''
      expect(rule, sel).toBeTruthy()
      expect(rule, sel).not.toMatch(/capitalize/)
    }
    expect(css).not.toMatch(/\.cp-next-l li span:first-child\{text-transform:capitalize\}/)
    expect(read('./views/FocusView.css')).not.toMatch(/\.focus-card-header h2\{[^}]*capitalize/)
    // the views that hard-coded it take the class per exercise now
    expect(read('./views/FocusView.jsx')).toMatch(/<h2 className=\{exerciseNameClass\(ex\)\}>/)
    expect(read('./views/Workout.jsx')).not.toMatch(/textTransform: 'capitalize'/)
    expect(read('./coach.css')).toMatch(/\.pcard-ex-n\.nocap,\.ins-row-n\.nocap\{text-transform:none\}/)
  })
})
