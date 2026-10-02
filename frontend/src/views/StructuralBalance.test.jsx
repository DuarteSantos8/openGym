// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import StructuralBalance from './StructuralBalance.jsx'
import Stats from './Stats.jsx'
import { buildDemoState } from '../lib/demoSeed.js'
import { TEMPLATE_LIST } from '../lib/structuralBalanceTemplates.js'

const navSpy = vi.fn()
vi.mock('react-router-dom', () => ({ useNavigate: () => navSpy }))

const clone = value => JSON.parse(JSON.stringify(value))
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mounted = []
function render(View = StructuralBalance) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  mounted.push(root)
  act(() => root.render(<View />))
  return host
}

function setDoneSet(w, r) { return { done: true, w, r } }
function workoutAt(id, start, sets) {
  return { d: new Date(start).toISOString(), start, entries: [{ id, sets }] }
}

beforeEach(() => {
  navSpy.mockClear()
  localStorage.clear()
  useUI.setState({ sheets: [] })
  const S = clone(DEF)
  S.workouts = [workoutAt('0030', Date.now(), [setDoneSet(100, 1)])] // narrowBench anchor logged
  useStore.setState({ S, user: null })
  document.body.innerHTML = ''
})

afterEach(() => {
  act(() => { mounted.splice(0).forEach(root => root.unmount()) })
})

describe('StructuralBalance view', () => {
  it('renders every role of the default (Poliquin) template', () => {
    const host = render()
    const rows = host.querySelectorAll('[data-role-id]')
    expect(rows.length).toBe(9)
    expect(host.querySelector('[data-role-id="narrowBench"]').textContent).toContain('Balanced')
    expect(host.querySelector('[data-role-id="deadlift"]').textContent).toContain('No data')
  })

  it('switching templates via the Segmented control recomputes the role list', () => {
    const host = render()
    const atgButton = [...host.querySelectorAll('.seg button')].find(b => b.textContent === 'ATG')
    expect(atgButton).toBeTruthy()
    act(() => atgButton.click())

    expect(useStore.getState().S.balanceTemplate).toBe('atg')
    const rows = host.querySelectorAll('[data-role-id]')
    expect(rows.length).toBe(8)
    expect(host.querySelector('[data-role-id="nordicCurl"]')).toBeTruthy()
  })

  it('a role with no matching exercise ever logged shows "No data" without throwing', () => {
    const host = render()
    const deadlift = host.querySelector('[data-role-id="deadlift"]')
    expect(deadlift.textContent).toContain('No data')
  })

  // `.mrow .nm` is one line with an ellipsis that never reaches the label's block lines, so a
  // long label (German, Russian, Hungarian at 360 px) lost its reps and "each hand" to the clip.
  it('lets every role\'s label and exercise wrap rather than cutting them off', () => {
    const host = render()
    for (const tpl of TEMPLATE_LIST) {
      const button = [...host.querySelectorAll('.seg button')].find(b => b.textContent === tpl.label)
      act(() => button.click())
      for (const row of host.querySelectorAll('[data-role-id]')) {
        const name = row.querySelector('.nm')
        expect(name.style.whiteSpace, row.dataset.roleId).toBe('normal')
        expect(name.style.overflowWrap, row.dataset.roleId).toBe('anywhere')
        for (const line of name.children) expect(line.style.whiteSpace).not.toBe('nowrap')
      }
    }
  })

  it('falls back to the default template for a stored id that is not one, prototype names included', () => {
    for (const id of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'gone', 7, null]) {
      useStore.setState({ S: { ...useStore.getState().S, balanceTemplate: id } })
      const host = render()
      expect(host.querySelectorAll('[data-role-id]').length, String(id)).toBe(9)
      expect(host.querySelector('.seg button[aria-pressed="true"]').textContent).toBe('Poliquin')
      act(() => { mounted.splice(0).forEach(root => root.unmount()) })
      document.body.innerHTML = ''
    }
  })

  // Catalogue names are lower case ("barbell full squat"); every other list capitalises an English
  // one (exerciseNameClass), while a translated name keeps its own casing.
  it('capitalises each row\'s exercise name like the other lists, and only the name', () => {
    const host = render()
    for (const row of host.querySelectorAll('[data-role-id]')) {
      const name = row.querySelector('[data-exercise-name]')
      expect(name.classList.contains('capitalize'), row.dataset.roleId).toBe(true)
      expect(name.textContent.length).toBeGreaterThan(0)
    }
    expect(host.querySelector('[data-role-id="narrowBench"] [data-exercise-name]').textContent).toBe('barbell close-grip bench press')
  })

  it('picking a role\'s own default exercise does not mark it custom', () => {
    const host = render()
    const row = host.querySelector('[data-role-id="inclineBench"]')
    act(() => [...row.querySelectorAll('button')].find(b => b.textContent.includes('Change exercise')).click())
    const picker = useUI.getState().sheets.at(-1)
    act(() => picker.render(picker.close).props.onPick({ id: '0047' })) // barbell incline bench press, the role's default
    const after = host.querySelector('[data-role-id="inclineBench"]')
    expect(after.textContent).not.toContain('Custom')
    expect([...after.querySelectorAll('button')].some(b => b.textContent.includes('Use default exercise'))).toBe(false)
  })

  it('asks for a weigh-in on a row that only lacks one, with a way to log it', () => {
    const S = clone(DEF)
    S.balanceTemplate = 'atg'
    S.workouts = [workoutAt('0085', Date.now(), [setDoneSet(80, 12)])]
    useStore.setState({ S, user: null })
    const host = render()
    const rdl = host.querySelector('[data-role-id="romanianDeadlift"]')
    expect(rdl.dataset.status).toBe('no-data')
    expect(rdl.textContent).toContain('Log your body weight to score this lift.')
    expect(host.querySelector('[data-role-id="goodMorning"] [data-needs-bodyweight]')).toBe(null)
    const log = [...rdl.querySelectorAll('button')].find(b => b.textContent.includes('Log body weight'))
    // Two buttons side by side squeeze each other's labels onto two lines at 360 px (Hungarian):
    // the row wraps them instead.
    expect(log.parentElement.style.flexWrap).toBe('wrap')
    act(() => log.click())
    expect(useUI.getState().sheets.length).toBe(1)

    act(() => useStore.getState().update(s => { s.bodyweight.push({ d: '2026-01-01', w: 80, t: 1 }) }))
    const scored = host.querySelector('[data-role-id="romanianDeadlift"]')
    expect(scored.dataset.status).toBe('balanced')
    expect(scored.querySelector('[data-needs-bodyweight]')).toBe(null)
    expect([...scored.querySelectorAll('button')].some(b => b.textContent.includes('Log body weight'))).toBe(false)
  })

  it('says why a logged lift is not scored when its anchor never was', () => {
    const S = clone(DEF)
    S.workouts = [workoutAt('0047', Date.now(), [setDoneSet(57.5, 10)])]   // incline bench, no close-grip bench
    useStore.setState({ S, user: null })
    const host = render()
    const incline = host.querySelector('[data-role-id="inclineBench"]')
    expect(incline.dataset.status).toBe('no-data')
    expect(incline.textContent).toContain('Not scored')
    expect(incline.textContent).not.toContain('No data')
    expect(incline.querySelector('[data-needs-anchor]').textContent).toBe('Log the anchor lift to score this one.')
    const anchor = host.querySelector('[data-role-id="narrowBench"]')
    expect(anchor.textContent).toContain('No data')
    expect(anchor.querySelector('[data-needs-anchor]')).toBe(null)
    expect(host.querySelector('[data-role-id="frontSquat"] [data-needs-anchor]')).toBe(null)   // not logged either
  })

  it('the back chevron navigates to /stats', () => {
    const host = render()
    act(() => host.querySelector('.iconbtn').click())
    expect(navSpy).toHaveBeenCalledWith('/stats')
  })

  it('changing a role\'s exercise via the picker saves an override and marks it custom', () => {
    const host = render()
    const row = host.querySelector('[data-role-id="inclineBench"]')
    const changeBtn = [...row.querySelectorAll('button')].find(b => b.textContent.includes('Change exercise'))
    act(() => changeBtn.click())

    const picker = useUI.getState().sheets.at(-1)
    expect(picker).toBeTruthy()
    const pickerView = picker.render(picker.close)
    expect(pickerView.props.title).toBe('Change exercise')   // not the picker's own "Add exercise"
    act(() => pickerView.props.onPick({ id: '0043' })) // barbell full squat — deliberately not in inclineBench's whitelist

    const chosen = useStore.getState().S.balanceOverrides['poliquin:inclineBench']
    expect(chosen.id).toBe('0043')
    expect(chosen._ts).toBeGreaterThan(0)

    const updatedRow = host.querySelector('[data-role-id="inclineBench"]')
    expect(updatedRow.textContent).toContain('Custom')

    const resetBtn = [...updatedRow.querySelectorAll('button')].find(b => b.textContent.includes('Use default exercise'))
    expect(resetBtn).toBeTruthy()
    act(() => resetBtn.click())
    // Cleared as a stamped entry, so the clear can win a sync against the other device's choice.
    const cleared = useStore.getState().S.balanceOverrides['poliquin:inclineBench']
    expect(cleared.id).toBe(null)
    expect(cleared._ts).toBeGreaterThanOrEqual(chosen._ts)
    const resetRow = host.querySelector('[data-role-id="inclineBench"]')
    expect(resetRow.textContent).not.toContain('Custom')
    expect([...resetRow.querySelectorAll('button')].some(b => b.textContent.includes('Use default exercise'))).toBe(false)
  })
})

describe('the way in from Stats', () => {
  it('is a card like the others that opens the screen, once there is a workout to read', () => {
    const host = render(Stats)
    const card = [...host.querySelectorAll('.card')].find(c => c.querySelector('h2')?.textContent === 'Structural balance')
    expect(card).toBeTruthy()
    expect(card.textContent).toContain('See which lift is holding back the rest.')
    const open = [...card.querySelectorAll('button')].find(b => b.textContent.includes('Open'))
    act(() => open.click())
    expect(navSpy).toHaveBeenCalledWith('/structural-balance')
  })

  it('is not offered before the first workout', () => {
    useStore.setState({ S: clone(DEF), user: null })
    const host = render(Stats)
    expect(host.textContent).not.toContain('Structural balance')
  })
})

// The demo build (VITE_DEMO=1) boots a guest on the seeded example profile and has no server:
// every template has to render against that profile, and score what it logs.
describe('on the demo profile', () => {
  it('renders every template and scores the lifts the example history has', () => {
    useStore.setState({ S: Object.assign(clone(DEF), buildDemoState()), user: null })
    const host = render()
    const scored = {}
    for (const tpl of TEMPLATE_LIST) {
      const button = [...host.querySelectorAll('.seg button')].find(b => b.textContent === tpl.label)
      act(() => button.click())
      const rows = [...host.querySelectorAll('[data-role-id]')]
      expect(rows.map(r => r.dataset.roleId)).toEqual(tpl.roles.map(r => r.id))
      scored[tpl.id] = rows.filter(r => r.dataset.status !== 'no-data').map(r => r.dataset.roleId)
    }
    expect(scored.thibaudeauPowerlifting).toEqual(expect.arrayContaining(['squat', 'bench']))
    expect(scored.atg).toEqual(expect.arrayContaining(['romanianDeadlift', 'atgDips']))
    expect(host.textContent).not.toContain('NaN')
    expect(host.textContent).not.toContain('undefined')
  })
})
