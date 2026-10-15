// @vitest-environment happy-dom
// Fasting: the page, Home's Today card and the + sheet's Fast row, against NutriTrace faked at the
// fetch boundary (lib/nutrition/fake-nutritrace.js: fasts routes, the settings write and the hub's
// rules for them).
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { todayISO } from '../lib/format.js'
import { useNutrition } from '../lib/nutrition/store.js'
import { useDiarySelection } from '../lib/nutrition/selection.js'
import { useHubSync, resetSyncThrottle } from '../lib/nutrition/sync.js'
import { useFasting } from '../lib/nutrition/use-fasting.js'
import { createFakeNutriTrace, fixtureDay, fixtureFast, fixtureSettings } from '../lib/nutrition/fake-nutritrace.js'
import Fasting from './Fasting.jsx'
import Home from './Home.jsx'
import { openPlusSheet } from '../components/PlusSheet.jsx'

const navigate = vi.fn()
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }))
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const TODAY = todayISO()
const H = 3600 * 1000
let nt, host, root

function Sheets() {
  const sheets = useUI(s => s.sheets)
  return sheets.map(s => <div key={s.id} data-sheet="">{s.render(() => useUI.getState().closeSheet(s.id))}</div>)
}
const settle = async (ms = 0) => { for (let i = 0; i < 5; i++) await act(async () => { await new Promise(r => setTimeout(r, ms)) }) }
const mount = async el => { await act(async () => { root.render(<>{el}<Sheets /></>) }); await settle() }
const text = () => host.textContent
const button = (label, scope = host) => [...scope.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || b.textContent).trim() === label)
const click = async el => { await act(async () => { el.click() }); await settle() }
const lastSheet = () => [...host.querySelectorAll('[data-sheet]')].at(-1)
const typeInto = async (input, value) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await settle()
}
const on = (extra = {}) => ({ ...fixtureSettings(), fastingEnabled: true, fastingDefaultHours: 16, ...extra })
const running = (agoMs, goal = 16) => fixtureFast(5, new Date(Date.now() - agoMs).toISOString(), null, goal)
const finished = (id, daysAgo, hours) => {
  const end = Date.now() - daysAgo * 24 * H
  return fixtureFast(id, new Date(end - hours * H).toISOString(), new Date(end).toISOString())
}

function useFake(opts = {}) {
  nt = createFakeNutriTrace({ days: { [TODAY]: fixtureDay(TODAY) }, settings: on(), ...opts })
  vi.stubGlobal('fetch', nt.fetch)
}

beforeEach(() => {
  navigate.mockClear()
  useFake()
  useStore.setState(s => ({
    user: { id: 3, name: 'Ana' },
    pushState: vi.fn(async () => {}),
    S: { ...s.S, routines: [], workouts: [], bodyweight: [], dayPlan: {}, week: {}, active: null, checkIn: false, unit: 'kg' },
  }))
  useNutrition.getState().reset()
  useDiarySelection.getState().reset()
  useHubSync.getState().reset()
  useFasting.getState().reset()
  useUI.setState({ sheets: [], toastMsg: '', toastAction: null })
  resetSyncThrottle()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals() })

describe('the Fasting page', () => {
  it('is off until you turn it on: that saves the setting and shows the plans', async () => {
    useFake({ settings: fixtureSettings() })
    await mount(<Fasting />)
    expect(text()).toContain('Fasting is off')
    await click(button('Turn on fasting'))
    expect(nt.writes()).toEqual([expect.objectContaining({ method: 'PUT', path: '/nt/api/settings', body: { key: 'fastingEnabled', value: true } })])
    expect(text()).toContain('Start a fast')
    expect([...host.querySelectorAll('[role="radio"]')].map(b => b.textContent)).toEqual(['14:10', '16:8', '18:6', '20:4', 'OMAD', 'Custom'])
  })

  it('starts a fast on the chosen plan and counts the time fasted', async () => {
    useFake({ settings: on({ fastingDefaultHours: 18 }) })
    await mount(<Fasting />)
    // The plan used last is the one selected.
    expect(button('18:6').getAttribute('aria-checked')).toBe('true')
    await click(button('20:4'))
    await click(button('Start fast'))
    expect(nt.writes().find(r => r.path === '/nt/api/fasts/start').body).toEqual({ goal_hours: 20 })
    // Remembered as the next default, as NutriTrace's widget does.
    expect(nt.writes().find(r => r.path === '/nt/api/settings').body).toEqual({ key: 'fastingDefaultHours', value: 20 })
    expect(host.querySelector('.fast-clock').textContent).toMatch(/^0:00:0\d$/)
    expect(text()).toContain('20h 0m to go')
    expect(button('End fast')).toBeTruthy()
  })

  it('custom hours outside 1 to 168 are refused before any request', async () => {
    await mount(<Fasting />)
    await click(button('Custom'))
    await typeInto(host.querySelector('input[aria-label="Goal in hours"]'), '200')
    await click(button('Start fast'))
    expect(host.querySelector('[role="alert"]').textContent).toBe('Enter a goal between 1 and 168 hours.')
    expect(nt.writes()).toEqual([])
  })

  it('a running fast shows time fasted, time left and when the goal falls; the goal reached says so', async () => {
    useFake({ fasts: [running(3.5 * H)] })
    await mount(<Fasting />)
    expect(host.querySelector('.fast-clock').textContent).toMatch(/^3:30:\d\d$/)
    expect(text()).toContain('12h 30m to go')
    expect(host.querySelector('[role="progressbar"]').getAttribute('aria-valuenow')).toBe('22')
    useFasting.getState().reset()
    useFake({ fasts: [running(17 * H)] })
    await mount(<Fasting key="again" />)
    expect(text()).toContain('Goal reached')
    expect(text()).toContain('1h 0m past your goal')
  })

  it('ends the running fast after a confirmation, and it lands in the history', async () => {
    useFake({ fasts: [running(17 * H)] })
    await mount(<Fasting />)
    await click(button('End fast'))
    expect(lastSheet().textContent).toContain('End your fast?')
    expect(nt.writes()).toEqual([])
    await click(button('End fast', lastSheet()))
    expect(nt.writes()).toEqual([expect.objectContaining({ method: 'POST', path: expect.stringMatching(/^\/nt\/api\/fasts\/5\/end$/) })])
    expect(text()).toContain('Start a fast')
    expect(host.querySelectorAll('.lrow').length).toBe(1)
    expect(text()).toContain('17h 0m')
  })

  it('moves the start of the running fast, and refuses a future start', async () => {
    useFake({ fasts: [running(3 * H)] })
    await mount(<Fasting />)
    await click(button('Change start time'))
    const input = lastSheet().querySelector('input[type="datetime-local"]')
    const pad = n => String(n).padStart(2, '0')
    const local = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}` }
    await typeInto(input, local(Date.now() + 2 * H))
    await click(button('Save', lastSheet()))
    expect(lastSheet().textContent).toContain('The start cannot be in the future.')
    expect(nt.writes()).toEqual([])
    await typeInto(input, local(Date.now() - 5 * H))
    await click(button('Save', lastSheet()))
    const patch = nt.writes().find(r => r.method === 'PATCH')
    expect(patch.path).toBe('/nt/api/fasts/5')
    expect(new Date(patch.body.start_at).getTime()).toBeLessThan(Date.now() - 4.9 * H)
    expect(host.querySelector('.fast-clock').textContent).toMatch(/^5:0\d:\d\d$/)
  })

  it('lists finished fasts with the insights, and removes one after a confirmation', async () => {
    useFake({ fasts: [finished(1, 1, 17), finished(2, 2, 12)] })
    await mount(<Fasting />)
    expect(host.querySelectorAll('.lrow').length).toBe(2)
    expect(text()).toContain('Average fast')
    expect(text()).toContain('14.5 h')
    await click([...host.querySelectorAll('.lrow button')][0])
    await click(button('Remove', lastSheet()))
    expect(nt.writes().at(-1)).toMatchObject({ method: 'DELETE', path: '/nt/api/fasts/1' })
    expect(host.querySelectorAll('.lrow').length).toBe(1)
  })

  it('says why a fast did not start, and keeps the plan', async () => {
    await mount(<Fasting />)
    nt.failNext('POST', '/nt/api/fasts/start', 'offline')
    await click(button('Start fast'))
    expect(host.querySelector('[role="alert"]').textContent).toBe('Not saved: no connection. Try again when you are back online.')
    await click(button('Start fast'))
    expect(button('End fast')).toBeTruthy()
  })

  it('a start that finds a fast already running elsewhere shows that fast, not an error', async () => {
    await mount(<Fasting />)
    nt.state.fasts.push(running(2 * H, 18))
    await click(button('Start fast'))
    expect(host.querySelector('[role="alert"]')).toBeNull()
    expect(text()).toContain('16h 0m to go')
    // The other device's fast is not announced as started here.
    expect(useUI.getState().toastMsg).toBe('A fast is already running')
  })

  it('a fast started or ended on another device shows up when the app comes back to the front', async () => {
    await mount(<Fasting />)
    expect(button('Start fast')).toBeTruthy()
    nt.state.fasts.push(running(2 * H))
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    await settle()
    expect(button('End fast')).toBeTruthy()
    nt.state.fasts[0].end_at = new Date().toISOString()
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    await settle()
    expect(button('Start fast')).toBeTruthy()
  })

  it('opening the page re-reads fasts a stale cache holds', async () => {
    await mount(<Fasting />)
    act(() => root.render(<div />))
    nt.state.fasts.push(running(2 * H))
    await mount(<Fasting />)
    expect(button('End fast')).toBeTruthy()
  })

  it('moving the start of a fast that was ended elsewhere leaves it out of the running slot', async () => {
    useFake({ fasts: [running(3 * H)] })
    await mount(<Fasting />)
    nt.state.fasts[0].end_at = new Date().toISOString()
    await click(button('Change start time'))
    const pad = n => String(n).padStart(2, '0')
    const d = new Date(Date.now() - 4 * H)
    await typeInto(lastSheet().querySelector('input[type="datetime-local"]'), `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`)
    await click(button('Save', lastSheet()))
    expect(useFasting.getState().active).toBeNull()
    expect(useFasting.getState().history.map(f => f.id)).toContain(5)
  })

  it('starting a fast puts the plan in the cached settings, so the next screen defaults to it', async () => {
    await mount(<Fasting />)
    await click(button('18:6'))
    await click(button('Start fast'))
    expect(useNutrition.getState().settings.data.fastingDefaultHours).toBe(18)
  })

  it('names a history delete button by its date and gives it a 44px target', async () => {
    useFake({ fasts: [finished(1, 1, 17)] })
    await mount(<Fasting />)
    const del = host.querySelector('.lrow button')
    expect(del.getAttribute('aria-label')).toMatch(/^Delete fast /)
    expect(del.classList.contains('fast-remove')).toBe(true)
  })

  it('needs the web app and a signed-in person', async () => {
    useStore.setState({ user: null })
    await mount(<Fasting />)
    expect(text()).toContain('Fasting lives in the web app')
    expect(nt.requests).toEqual([])
  })
})

describe('fasting on Home and in the + sheet', () => {
  it('Home shows the running fast on the Today card and opens the page', async () => {
    useFake({ fasts: [running(3.5 * H)] })
    await mount(<Home />)
    const row = host.querySelector('.today-fast')
    expect(row.textContent).toContain('Fasting for 3h 30m')
    expect(row.textContent).toContain('12h 30m to go')
    await click(row)
    expect(navigate).toHaveBeenCalledWith('/food/fasting')
  })

  it('shows nothing about fasting while it is off, or while no fast runs', async () => {
    useFake({ settings: fixtureSettings(), fasts: [running(3 * H)] })
    await mount(<Home />)
    expect(host.querySelector('.today-fast')).toBeNull()
    expect(nt.requests.some(r => r.path.includes('/fasts'))).toBe(false)
    useFasting.getState().reset()
    useFake({ fasts: [] })
    await mount(<Home key="idle" />)
    expect(host.querySelector('.today-fast')).toBeNull()
  })

  it('the + sheet starts a fast on the last plan in one tap', async () => {
    useFake({ settings: on({ fastingDefaultHours: 18 }) })
    await mount(<div />)
    await act(async () => { openPlusSheet('/home') })
    await settle()
    expect(lastSheet().textContent).toContain('Fast')
    await click(button('Start a 18 hour fast', lastSheet()))
    expect(nt.writes().find(r => r.path === '/nt/api/fasts/start').body).toEqual({ goal_hours: 18 })
    expect(useUI.getState().sheets.length).toBe(0)
  })

  it('the + sheet shows the time fasted while one runs, and opens the page', async () => {
    useFake({ fasts: [running(2 * H)] })
    await mount(<div />)
    await act(async () => { openPlusSheet('/home') })
    await settle()
    const row = [...lastSheet().querySelectorAll('.lrow')].find(r => r.textContent.startsWith('Fasting'))
    expect(row.textContent).toContain('2h 0m')
  })

  it('the + sheet has no Fast row while fasting is off', async () => {
    useFake({ settings: fixtureSettings() })
    await mount(<div />)
    await act(async () => { openPlusSheet('/home') })
    await settle()
    expect([...lastSheet().querySelectorAll('.lrow-t')].map(n => n.textContent)).not.toContain('Fast')
  })
})
