// @vitest-environment happy-dom
// P4 (1.4.5): controls that repeat down a list say what they act on. A routine used to have a
// "Move up" per exercise and a workout a "Decrease" per set, all with one name for a screen
// reader. The pieces every screen shares are checked here; the screens check their own lists
// (Workout.test.jsx, RoutineEdit.move.test.jsx, Plan.rotation.test.jsx, the weigh-in tests).
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nameIn, said } from './lib/a11y-name.js'
import { _setLangState, LANGS, DERIVED_LOCALES } from './lib/i18n-core.js'
import { LRI, FSI, PDI } from './lib/bidi.js'
import { Stepper, Segmented } from './components/ui.jsx'
import SwipeRow from './components/SwipeRow.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const packs = import.meta.glob('./locales/*.js', { eager: true, import: 'default' })
const pack = code => packs[`./locales/${code}.js`]

let host, root
beforeEach(() => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host) })
afterEach(() => { act(() => root.unmount()); host.remove(); _setLangState('en', {}, null, null) })
const names = sel => [...host.querySelectorAll(sel)].map(el => el.getAttribute('aria-label'))

describe('nameIn: the thing first, then the control', () => {
  it('joins the two, and hands back the one it has when the other is missing', () => {
    expect(nameIn('Set 2', 'Reps')).toBe('Set 2: Reps')
    expect(nameIn('Set 2', nameIn('Reps', 'Increase'))).toBe('Set 2: Reps: Increase')
    expect(nameIn('', 'Reps')).toBe('Reps')
    expect(nameIn(null, 'Reps')).toBe('Reps')
    expect(nameIn('Set 2', '')).toBe('Set 2')
    expect(nameIn(undefined, undefined)).toBe('')
  })
  it('uses the language’s own colon', () => {
    _setLangState('fr', pack('fr'), null, null)
    expect(nameIn('Série 2', 'Répétitions')).toBe('Série 2 : Répétitions')
    _setLangState('zh', pack('zh'), null, null)
    expect(nameIn('第 2 组', '次数')).toBe('第 2 组：次数')
  })
  it('isolates the inserted name in a right-to-left language, and leaves it alone elsewhere', () => {
    expect(said('Barbell Curl')).toBe('Barbell Curl')
    expect(said(null)).toBe('')
    for (const code of ['ar', 'fa']) {
      _setLangState(code, pack(code), null, null)
      // A Latin name is a left-to-right run of its own, so it cannot turn the words around it.
      expect(said('Barbell Curl')).toBe(LRI + 'Barbell Curl' + PDI)
      expect(said('تمرين')).toBe(FSI + 'تمرين' + PDI)
      const name = nameIn('Barbell Curl', 'More')
      expect(name.startsWith(LRI + 'Barbell Curl' + PDI)).toBe(true)
      expect(name.endsWith('More')).toBe(true)
    }
  })
})

describe('the sentences the names are built from', () => {
  // English is the key; every pack has to carry each of them with its placeholders, in its own
  // word order. check-locales.mjs guards the placeholders in general; this pins the handful P4 uses.
  const KEYS = ['{0}: {1}', 'Remove {0}', 'Delete {0}', 'Move {0} up', 'Move {0} down', 'Move {0}', 'Add “{0}” to my plan',
    'Set {0}', 'Set {0} ({1})', 'Warm-up {0}', 'Set {0} done', 'Drop {0}', 'Burst {0}', 'Mini-set {0}',
    'Decrease', 'Increase', 'Done', 'Remove', 'Delete', 'Copy set', 'Details', 'Edit', 'More', 'Plan', 'Unpair', 'Superset {0} / {1}', 'Body part', 'Exercise type', 'Weight stack', 'Estimated 1RM']
  const real = Object.keys(LANGS).filter(c => c !== 'en' && !DERIVED_LOCALES[c])
  it('are in every language pack, placeholders intact', () => {
    expect(real).toHaveLength(25)
    const marks = s => [...String(s).matchAll(/\{\d+\}/g)].map(m => m[0]).sort().join(' ')
    for (const code of real) {
      for (const key of KEYS) {
        const v = pack(code)?.[key]
        expect(typeof v === 'string' && v.trim() !== '', `${code}: ${key}`).toBe(true)
        expect(marks(v), `${code}: ${key}`).toBe(marks(key))
      }
    }
  })
  it('keep the thing in front of the control in every language', () => {
    for (const code of real) {
      const v = pack(code)['{0}: {1}']
      expect(v.indexOf('{0}'), code).toBeLessThan(v.indexOf('{1}'))
    }
  })
})

describe('Stepper', () => {
  it('names its − and + after its label, so three steppers in a sheet are three pairs of names', () => {
    act(() => root.render(<>
      <Stepper label="Sets" value={3} onChange={() => {}} />
      <Stepper label="Reps" value={8} onChange={() => {}} />
      <Stepper label="Weight (kg)" value={60} onChange={() => {}} />
    </>))
    const all = names('button')
    expect(all).toEqual(['Sets: Decrease', 'Sets: Increase', 'Reps: Decrease', 'Reps: Increase', 'Weight (kg): Decrease', 'Weight (kg): Increase'])
    expect(names('input')).toEqual(['Sets', 'Reps', 'Weight (kg)'])
    // the label on screen is the same as ever
    expect([...host.querySelectorAll('.stp-l')].map(l => l.textContent)).toEqual(['Sets', 'Reps', 'Weight (kg)'])
  })
  it('says the row it is in when a list repeats it (`of`)', () => {
    act(() => root.render(<>
      {[1, 2].map(n => <Stepper key={n} label="Rest (s)" of={`Set ${n}`} value={60} onChange={() => {}} />)}
    </>))
    expect(names('button')).toEqual(['Set 1: Rest (s): Decrease', 'Set 1: Rest (s): Increase', 'Set 2: Rest (s): Decrease', 'Set 2: Rest (s): Increase'])
    expect(names('input')).toEqual(['Set 1: Rest (s)', 'Set 2: Rest (s)'])
    expect([...host.querySelectorAll('.stp-l')].map(l => l.textContent)).toEqual(['Rest (s)', 'Rest (s)'])
  })
  it('keeps a plain Decrease and Increase when it has no label at all', () => {
    act(() => root.render(<Stepper value={3} onChange={() => {}} />))
    expect(names('button')).toEqual(['Decrease', 'Increase'])
  })
})

describe('Segmented', () => {
  it('says whose it is when a page has the same choice on several cards (`of`)', () => {
    const options = [{ value: 30, label: '1M' }, { value: 0, label: 'All' }]
    act(() => root.render(<>
      <Segmented of="Body weight" options={options} value={30} onChange={() => {}} />
      <Segmented of="Effort" options={options} value={0} onChange={() => {}} />
      <Segmented options={options} value={0} onChange={() => {}} />
    </>))
    expect(names('button')).toEqual(['Body weight: 1M', 'Body weight: All', 'Effort: 1M', 'Effort: All', null, null])
    expect([...host.querySelectorAll('button')].map(b => b.textContent)).toEqual(['1M', 'All', '1M', 'All', '1M', 'All'])
  })
})

describe('SwipeRow', () => {
  it('gives the two actions the name the list hands it and keeps the words on the pane', () => {
    act(() => root.render(<>
      <SwipeRow onDelete={() => {}} onCopy={() => {}} deleteLabel="Remove" copyLabel="Duplicate" deleteName="Remove Squat" copyName="Squat: Duplicate"><span>Squat</span></SwipeRow>
      <SwipeRow onDelete={() => {}} deleteLabel="Remove" deleteName="Remove Curl"><span>Curl</span></SwipeRow>
      <SwipeRow onDelete={() => {}}><span>Plain</span></SwipeRow>
    </>))
    expect(names('.swpane button')).toEqual(['Squat: Duplicate', 'Remove Squat', 'Remove Curl', null])
    expect([...host.querySelectorAll('.swpane button')].map(b => b.textContent.trim())).toEqual(['Duplicate', 'Remove', 'Remove', 'Delete'])
  })
})
