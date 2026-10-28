// @vitest-environment happy-dom
/* The app tour's overlay: the first-run question and the resume question, the stops in order,
   Back / Next / Skip, a tap on the highlighted element, Escape and the focus trap, reduced motion,
   the practice workout that is never saved, the ways between screens that wait for the real tap,
   the spotlight that follows its element, and the tutorials (a plan built in a copy until Save,
   the data tutorial's pretend copy, the exercise form). The screens are stand-ins carrying the
   anchors. */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../sheets.jsx', async () => {
  const { useStore } = await import('../store/useStore.js')
  return {
    beginWorkout: vi.fn(ids => useStore.getState().update(s => {
      s.active = { id: 'run-1', d: '2026-10-26', start: Date.now(), routineIds: ids, name: 'Practice run', cur: 0, entries: [] }
    })),
  }
})

import { useStore, DEF } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { beginWorkout } from '../sheets.jsx'
import { openTour, closeTour, tourState, readTour, noteStep, SAMPLE_ROUTINE_ID, SAMPLE_WORKOUT_ID } from '../lib/tour.js'
import Tour, { _setAnchorWait } from './Tour.jsx'

const clone = o => JSON.parse(JSON.stringify(o))
const ANCHORS = ['today', 'start', 'plan-mode', 'plan-views', 'plan-menu', 'lib-search', 'lib-filters', 'set', 'tick', 'swipe', 'workout-more', 'finish', 'stats-tiles',
  'settings-look', 'settings-units', 'settings-data', 'tab-home', 'tab-plan', 'tab-stats', 'tab-library', 'settings-gear']
const TABS = { 'tab-home': '/home', 'tab-plan': '/plan', 'tab-stats': '/stats', 'tab-library': '/library', 'settings-gear': '/settings' }
let root, host, where, tapped, made
function Screens({ skip = [] }) {
  const nav = useNavigate()
  where = useLocation().pathname
  const S = useStore(s => s.S)
  const rid = where.startsWith('/plan/r/') ? where.split('/').pop() : null
  const r = rid && S.routines.find(x => x.id === rid)
  const newRoutine = () => {
    const id = 'r' + (++made)
    useStore.getState().update(s => { s.routines.push({ id, name: 'New routine', ex: [] }) })
    nav('/plan/r/' + id)
  }
  return <div>
    {ANCHORS.filter(a => !skip.includes(a)).map(a => <button key={a} data-tour={a} aria-label={'the ' + a}
      onClick={() => { tapped = a; if (TABS[a]) nav(TABS[a], { replace: true }) }}>{a}</button>)}
    {where === '/plan' && <button data-tour="plan-new" onClick={newRoutine}>new routine</button>}
    {where === '/library' && <button data-tour="lib-new" onClick={() => useUI.getState().openSheet(() => <ExForm />)}>create</button>}
    {r && <>
      <input data-tour="routine-name" aria-label="Routine name" />
      <button data-tour="routine-add" onClick={() => useUI.getState().openSheet(() => <div>picker</div>)}>add exercise</button>
      <button data-tour="routine-back" onClick={() => nav('/plan')}>back</button>
      {r.ex.length > 0 && <div data-tour="routine-ex">{r.ex.length} exercises</div>}
    </>}
  </div>
}
function ExForm() {
  return <div>
    <input data-tour="cx-name" aria-label="Exercise name" />
    <div data-tour="cx-bp">body parts</div>
    <div data-tour="cx-eq">equipment</div>
    <button data-tour="cx-save" onClick={() => useStore.getState().update(s => { (s.customEx = s.customEx || []).push({ id: 'cmine', n: 'Mine', bp: 'chest', eq: 'body weight', custom: true }) })}>Create exercise</button>
  </div>
}
function Sheets() {
  const sheets = useUI(s => s.sheets)
  return <>{sheets.map(x => <div key={x.id} className="sheet">{x.render(() => useUI.getState().closeSheet(x.id))}</div>)}</>
}
const render = async (props = {}, at = '/home') => {
  await act(async () => {
    root.render(<MemoryRouter initialEntries={[at]}><Screens {...props} /><Sheets /><Tour /></MemoryRouter>)
  })
  await settle()
}
const settle = async (ms = 150) => { await act(async () => { await new Promise(r => setTimeout(r, ms)) }) }
const card = () => document.querySelector('.tour-card')
const step = () => document.querySelector('.tour')?.getAttribute('data-step')
const btn = label => [...document.querySelectorAll('.tour-card button')].find(b => b.textContent === label)
const anchor = name => document.querySelector(`[data-tour="${name}"]`)
const click = async el => { await act(async () => { el.click() }); await settle() }
const key = async (k, opts = {}) => { await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...opts })) }); await settle(30) }
const run = async (at, flow, path) => {
  await act(async () => { openTour(flow ? { kind: 'run', at, flow } : { kind: 'run', at }) })
  await render({}, path)
}

beforeEach(() => {
  localStorage.clear()
  _setAnchorWait(120)
  useStore.setState({ S: clone(DEF), user: null, ready: true })
  useUI.getState().closeAll()
  // Every stand-in anchor sits somewhere on screen; a test moves one by giving it a box of its own.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    return this.dataset?.tour ? { top: 200, left: 20, width: 120, height: 40, bottom: 240, right: 140, x: 20, y: 200 } : { top: 0, left: 0, width: 0, height: 0, bottom: 0, right: 0, x: 0, y: 0 }
  })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  tapped = null
  made = 0
})
afterEach(async () => {
  await act(async () => { closeTour() })
  await act(async () => root.unmount())
  host.remove()
  useStore.getState().leaveTourSandbox()
  useUI.getState().closeAll()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('the first-run question', () => {
  it('asks once: the card takes focus, Skip closes it and it is never asked again', async () => {
    await act(async () => { openTour({ kind: 'offer' }) })
    await render()
    expect(card().textContent).toContain('Want a 1-minute tour?')
    expect(document.activeElement).toBe(card())
    expect(readTour().offered).toBeGreaterThan(0)
    await click(btn('Skip'))
    expect(tourState()).toBe(null)
    expect(card()).toBe(null)
  })
  it('Show me starts the tour on Home, and Escape is a no as well', async () => {
    await act(async () => { openTour({ kind: 'offer' }) })
    await render()
    await click(btn('Show me'))
    expect(step()).toBe('today')
    expect(where).toBe('/home')
    await act(async () => { openTour({ kind: 'offer' }) })
    await settle()
    await key('Escape')
    expect(tourState()).toBe(null)
  })
  it('a tour closed halfway is picked up where it was, once', async () => {
    noteStep('lib-search')
    await act(async () => { openTour({ kind: 'resume', at: 'lib-search' }) })
    await render()
    expect(card().textContent).toContain('Finish the tour?')
    expect(readTour().resumeAsked).toBe(true)
    await click(btn('Continue'))
    expect(step()).toBe('lib-search')
    expect(where).toBe('/library')
  })
})

describe('the stops', () => {
  it('goes from stop to stop, back as well, with a counter', async () => {
    await run(null)
    expect(step()).toBe('today')
    expect(card().textContent).toMatch(/Step 1 of \d+/)
    expect(btn('Back')).toBeUndefined()
    await click(btn('Next'))
    expect(step()).toBe('go-plan')
    await click(btn('Back'))
    expect(step()).toBe('today')
    expect(readTour().at).toBe('today')
  })
  it('describes the highlighted element for a screen reader and moves focus to the card each time', async () => {
    await run('plan-menu')
    expect(card().getAttribute('role')).toBe('dialog')
    expect(card().querySelector('.tour-sr').textContent).toContain('the plan-menu')
    expect(document.activeElement).toBe(card())
  })
  it('Tab stays inside the card, Escape ends the tour and marks it seen', async () => {
    await run('plan-mode')
    const buttons = [...card().querySelectorAll('button')]
    buttons.at(-1).focus()
    await key('Tab')
    expect(document.activeElement).toBe(buttons[0])
    await key('Tab', { shiftKey: true })
    expect(document.activeElement).toBe(buttons.at(-1))
    await key('Escape')
    expect(tourState()).toBe(null)
    expect(readTour().done).toBeGreaterThan(0)
    expect(readTour().at).toBe(null)
  })
  it('the dimmed screen takes the taps and the scrolling: the highlighted element is covered unless the stop asks for it', async () => {
    await run('plan-mode')
    // four panes around the hole plus one over it
    expect(document.querySelectorAll('.tour-block').length).toBe(5)
    const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 120 })
    await act(async () => { document.querySelector('.tour-block').dispatchEvent(wheel) })
    expect(wheel.defaultPrevented).toBe(true)
    const touch = new Event('touchmove', { bubbles: true, cancelable: true })
    await act(async () => { card().dispatchEvent(touch) })
    expect(touch.defaultPrevented).toBe(true)
  })
  it('a missing optional stop is passed over in the direction of travel', async () => {
    useStore.setState({ S: { ...clone(DEF), restSec: 90 } })
    await run('tick')
    expect(step()).toBe('tick')
    await click(btn('Next'))   // no tick, so no rest timer: the rest stop has nothing to show
    await settle(300)
    expect(step()).toBe('swipe')
  })
  it('the closing card offers the tutorials, and Let’s go ends it and goes Home', async () => {
    await run('done', null, '/settings')
    expect(card().textContent).toContain('Want more?')
    expect([...card().querySelectorAll('.tour-tut')].map(b => b.querySelector('.tour-tut-t').textContent))
      .toEqual(['Build your first plan', 'Create your own exercise', 'Edit your data', 'Export & import'])
    expect(document.querySelector('.tour-hole')).toBe(null)
    await click(btn('Let’s go'))
    expect(tourState()).toBe(null)
    expect(where).toBe('/home')
  })
  it('a tutorial from the closing card runs from its start, and the tour counts as seen', async () => {
    await run('done', null, '/settings')
    await click(card().querySelector('.tour-tut'))
    expect(tourState()).toEqual({ kind: 'run', at: null, flow: 'plan' })
    expect(readTour().done).toBeGreaterThan(0)
    expect(step()).toBe('p-intro')
    expect(card().textContent).toContain('This one is for real')
  })
  it('with reduced motion the spotlight jumps instead of gliding', async () => {
    vi.stubGlobal('matchMedia', q => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} }))
    await run('plan-mode')
    expect(document.querySelector('.tour-hole').style.transition).toBe('none')
  })
})

describe('the ways between screens', () => {
  it('points at the real tab and waits for the tap, then goes on on the new screen', async () => {
    await run('go-plan')
    expect(where).toBe('/home')
    expect(card().textContent).toContain('Tap Plan')
    expect(btn('Next')).toBeUndefined()
    expect(btn('Show me')).toBeTruthy()
    // the hole lets the tap through: no pane over it
    expect(document.querySelectorAll('.tour-block').length).toBe(4)
    await settle(300)
    expect(step()).toBe('go-plan')   // it waits
    await click(anchor('tab-plan'))
    expect(tapped).toBe('tab-plan')
    expect(where).toBe('/plan')
    expect(step()).toBe('plan-mode')
    // Back takes the tour to the screen the way started from, to be shown again
    await click(btn('Back'))
    expect(step()).toBe('go-plan')
    expect(where).toBe('/home')
  })
  it('Show me taps it for you', async () => {
    await run('go-stats')
    await click(btn('Show me'))
    expect(tapped).toBe('tab-stats')
    expect(where).toBe('/stats')
    expect(step()).toBe('stats')
  })
  it('Settings is shown the way it is reached: Home first, then the gear', async () => {
    await run('stats', null, '/stats')
    await click(btn('Next'))
    await settle(300)
    expect(step()).toBe('go-home')
    await click(anchor('tab-home'))
    expect(step()).toBe('go-settings')
    await click(anchor('settings-gear'))
    expect(where).toBe('/settings')
    expect(step()).toBe('look')
  })
})

describe('the spotlight follows its element', () => {
  it('moves with a scroll, speaks from the middle while it is off screen, and brings it back', async () => {
    let top = 200
    await run('today')
    const el = anchor('today')
    el.getBoundingClientRect = () => ({ top, left: 20, width: 200, height: 50, bottom: top + 50, right: 220, x: 20, y: top })
    el.scrollIntoView = vi.fn()
    await settle(80)
    expect(parseFloat(document.querySelector('.tour-hole').style.top)).toBe(194)
    top = 400
    await settle(80)
    expect(parseFloat(document.querySelector('.tour-hole').style.top)).toBe(394)
    // scrolled away: no hole pointing at nothing, the card in the middle, and the element comes back
    top = 5000
    await settle(100)
    expect(document.querySelector('.tour-hole')).toBe(null)
    expect(card().classList.contains('tour-center')).toBe(true)
    expect(el.scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: 'center' }))
    top = 300   // the scroll lands
    await settle(100)
    expect(parseFloat(document.querySelector('.tour-hole').style.top)).toBe(294)
    expect(card().classList.contains('tour-center')).toBe(false)
  })
  it('waits while the user is still scrolling before bringing it back', async () => {
    let top = 5000
    await run('today')
    const el = anchor('today')
    el.getBoundingClientRect = () => ({ top, left: 20, width: 200, height: 50, bottom: top + 50, right: 220, x: 20, y: top })
    el.scrollIntoView = vi.fn(() => { top = 200 })
    for (let k = 0; k < 6; k++) {
      await act(async () => { document.dispatchEvent(new Event('scroll')) })
      await settle(100)
    }
    expect(el.scrollIntoView).not.toHaveBeenCalled()
    await settle(800)
    expect(el.scrollIntoView).toHaveBeenCalled()
  })
})

describe('the practice workout', () => {
  it('the Start button is the tour’s: a practice session nothing saves, gone when the tour moves on', async () => {
    useStore.getState().update(s => { s.routines = [{ id: 'mine', name: 'Mine', ex: [] }] }, false)
    const real = useStore.getState().S
    const saved = localStorage.getItem('gym_state_v1')
    await run('start', null, '/library')
    expect(card().textContent).toContain('Tap it for a practice run')
    await click(anchor('start'))
    expect(tapped).toBe(null)   // the app's own Start never heard of it
    expect(step()).toBe('set')
    expect(beginWorkout).toHaveBeenCalledWith([SAMPLE_ROUTINE_ID], null)
    const st = useStore.getState()
    expect(st.tourSandbox).toBe(true)
    expect(st.S.active.tour).toBe(true)
    expect(st.S.routines.map(r => r.id)).toEqual(['mine', SAMPLE_ROUTINE_ID])
    expect(localStorage.getItem('gym_state_v1')).toBe(saved)
    // Back to the Library: the sample is thrown away
    await click(btn('Back'))
    expect(useStore.getState().tourSandbox).toBe(false)
    expect(useStore.getState().S).toBe(real)
  })
  it('tapping the tick goes on, and skipping mid-workout drops the sample and leaves the workout', async () => {
    await run('tick')
    expect(useStore.getState().tourSandbox).toBe(true)
    await act(async () => { anchor('tick').click() })
    expect(tapped).toBe('tick')
    await settle(600)
    expect(step()).not.toBe('tick')
    await click(document.querySelector('.tour-skip'))
    expect(useStore.getState().tourSandbox).toBe(false)
    expect(useStore.getState().S.active).toBeFalsy()
    expect(where).toBe('/home')
  })
  it('the practice is over before the way to Stats, on Home', async () => {
    await run('finish')
    await click(btn('Next'))
    expect(step()).toBe('go-stats')
    expect(useStore.getState().tourSandbox).toBe(false)
    expect(where).toBe('/home')
  })
})

describe('Build your first plan', () => {
  // From Home to the new routine's Save card: Plan tab, New routine, a name, an exercise.
  const toSave = async () => {
    await run(null, 'plan')
    expect(step()).toBe('p-intro')
    await click(btn('Next'))
    expect(step()).toBe('p-go')
    await click(anchor('tab-plan'))
    // already on the Routines side: straight to New routine, in the copy
    expect(step()).toBe('p-new')
    expect(useStore.getState().tourSandbox).toBe(true)
    await click(anchor('plan-new'))
    expect(where).toBe('/plan/r/r1')
    expect(step()).toBe('p-name')
    // the name field takes typing: no pane over it
    expect(document.querySelectorAll('.tour-block').length).toBe(4)
    await click(btn('Next'))
    expect(step()).toBe('p-add')
    await click(anchor('routine-add'))
    await settle(300)
    expect(step()).toBe('p-pick')
    // the picker is the user's: no dimmer, a bar
    expect(document.querySelector('.tour-block')).toBe(null)
    expect(document.querySelector('.tour-bar')).toBeTruthy()
    await act(async () => {
      useStore.getState().update(s => { s.routines.find(r => r.id === 'r1').ex.push({ id: '0025', sets: 3, reps: 8, weight: 20 }) })
      useUI.getState().closeAll()
    })
    await settle(400)
    expect(step()).toBe('p-row')
    await click(btn('Next'))
    expect(step()).toBe('p-save')
  }
  it('builds the routine in a copy: quit before Save and nothing is left behind', async () => {
    useStore.getState().update(s => { s.routines = [{ id: 'mine', name: 'Mine', ex: [] }] }, false)
    const real = useStore.getState().S
    const saved = localStorage.getItem('gym_state_v1')
    await toSave()
    expect(card().textContent).toContain('This is your real plan now')
    expect(localStorage.getItem('gym_state_v1')).toBe(saved)
    await click(document.querySelector('.tour-skip'))
    expect(tourState()).toBe(null)
    expect(useStore.getState().tourSandbox).toBe(false)
    expect(useStore.getState().S).toBe(real)
    expect(useStore.getState().S.routines.map(r => r.id)).toEqual(['mine'])
    expect(localStorage.getItem('gym_state_v1')).toBe(saved)
    // the routine's screen had nothing left to show: back to Plan
    expect(where).toBe('/plan')
  })
  it('quitting halfway (Escape on the name) leaves nothing either, and keeps no resume point', async () => {
    await run(null, 'plan')
    await click(btn('Next'))
    await click(anchor('tab-plan'))
    await click(anchor('plan-new'))
    expect(step()).toBe('p-name')
    await key('Escape')
    expect(useStore.getState().S.routines).toEqual([])
    expect(readTour().at).toBeUndefined()
    expect(readTour().tutorials).toBeUndefined()
  })
  it('Save puts it in the real plan, and then it shows the way back to give it a day', async () => {
    await toSave()
    await click(btn('Save plan'))
    const st = useStore.getState()
    expect(st.tourSandbox).toBe(false)
    expect(st.S.routines.map(r => r.id)).toEqual(['r1'])
    expect(st.S.routines[0].ex).toHaveLength(1)
    expect(step()).toBe('p-back')
    await click(anchor('routine-back'))
    expect(where).toBe('/plan')
  })
  it('Save waits for an exercise, and closing the picker empty goes back to Add exercise', async () => {
    await run(null, 'plan')
    await click(btn('Next'))
    await click(anchor('tab-plan'))
    await click(anchor('plan-new'))
    await click(btn('Next'))
    await click(anchor('routine-add'))
    await settle(300)
    expect(step()).toBe('p-pick')
    await act(async () => { useUI.getState().closeAll() })
    await settle(500)
    expect(step()).toBe('p-add')
  })
})

describe('Edit your data', () => {
  it('runs on a pretend copy: the real data is never written, and is back as it was', async () => {
    useStore.getState().update(s => { s.workouts = [{ id: 'w-real', name: 'Real', d: '2026-10-01', entries: [] }] }, false)
    const real = useStore.getState().S
    const saved = localStorage.getItem('gym_state_v1')
    await run(null, 'edit')
    expect(step()).toBe('e-intro')
    const st = useStore.getState()
    expect(st.tourSandbox).toBe(true)
    expect(st.S.workouts.map(w => w.id)).toEqual(['w-real', SAMPLE_WORKOUT_ID])
    expect(st.S.bodyweight).toHaveLength(1)
    // poking at the copy
    await act(async () => { useStore.getState().update(s => { s.workouts = [] }) })
    await click(btn('Next'))
    // already Home, and no weigh-in card in this stand-in: on to Stats (polled: the skip past a
    // missing anchor takes longer than 400 ms on a slow CI runner)
    await vi.waitFor(async () => { await settle(50); expect(step()).toBe('e-go-stats') }, { timeout: 5000 })
    expect(localStorage.getItem('gym_state_v1')).toBe(saved)
    await click(document.querySelector('.tour-skip'))
    expect(useStore.getState().tourSandbox).toBe(false)
    expect(useStore.getState().S).toBe(real)
    expect(localStorage.getItem('gym_state_v1')).toBe(saved)
  })
  it('the last card says so: the copy is gone by then', async () => {
    await run('e-done', 'edit')
    expect(useStore.getState().tourSandbox).toBe(false)
    expect(card().textContent).toContain('exactly as you left it')
    await click(btn('Done'))
    expect(readTour().tutorials.edit).toBeGreaterThan(0)
  })
})

describe('Create your own exercise', () => {
  const toForm = async () => {
    await run(null, 'custom')
    await click(btn('Next'))
    expect(step()).toBe('c-go')
    await click(anchor('tab-library'))
    expect(step()).toBe('c-new')
    await click(anchor('lib-new'))
    await settle(300)
    expect(step()).toBe('c-name')
  }
  it('walks the real form, and Next past Create makes nothing', async () => {
    await toForm()
    for (const id of ['c-bp', 'c-eq', 'c-save']) {   // no media field in the stand-in: passed over
      await click(btn('Next'))
      await settle(150)
      expect(step()).toBe(id)
    }
    await click(btn('Next'))
    await settle(300)
    expect(step()).toBe('c-done')
    expect(useStore.getState().S.customEx).toEqual([])
    expect(document.querySelector('.sheet')).toBe(null)
  })
  it('the form’s own Create makes it, and the tour follows', async () => {
    await toForm()
    for (let k = 0; k < 3; k++) await click(btn('Next'))
    expect(step()).toBe('c-save')
    await click(anchor('cx-save'))
    await settle(300)
    expect(useStore.getState().S.customEx.map(c => c.id)).toEqual(['cmine'])
    expect(step()).not.toBe('c-save')
  })
  it('closing the form goes back to the row that opens it', async () => {
    await toForm()
    await act(async () => { useUI.getState().closeAll() })
    await settle(500)
    expect(step()).toBe('c-new')
  })
})
