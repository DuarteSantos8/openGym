// @vitest-environment happy-dom
// Settings > Workout > Live widget (v2): the preview draws the real glance for the moment picked,
// every switch writes S.liveWidget (never S.liveLayout), the preview goes to a moment that shows
// the change, a switch that cannot show says why, and Per exercise type toggles one choice per
// tap, for its own kind only, once that kind has its own setup.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const state = { S: null, navs: [], toasts: [], sheets: [] }
  state.snapshot = () => ({ S: state.S, update: mut => { const next = structuredClone(state.S); mut(next); state.S = next } })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => (selector ? selector(mocks.snapshot()) : mocks.snapshot())
  useStore.getState = mocks.snapshot
  return { useStore }
})
vi.mock('../store/useUI.js', () => {
  const snap = () => ({ timer: null, toast: (m, o) => mocks.toasts.push([m, o]), openSheet: fn => mocks.sheets.push(fn) })
  const useUI = selector => (selector ? selector(snap()) : snap())
  useUI.getState = snap
  return { useUI }
})
vi.mock('react-router-dom', () => ({ useNavigate: () => (...a) => mocks.navs.push(a) }))
vi.mock('../lib/mobile.js', () => ({ MOBILE: false, nativePlatform: async () => null }))
vi.mock('@capacitor/core', () => ({ registerPlugin: () => ({}) }))

const { default: LiveWidgetSettings, LiveWidgetCustomise } = await import('./LiveWidgetSettings.jsx')
const LL = await import('../lib/live-layout.js')

let host, root
const render = async el => { await act(async () => { root.render(el) }) }
const rerender = async el => render(el)
const rowSwitch = title => [...host.querySelectorAll('.lrow')].find(r => r.querySelector('.lrow-t')?.textContent === title)?.querySelector('[role="switch"]')
const click = async el => { await act(async () => { el.click() }) }

beforeEach(() => {
  mocks.S = { unit: 'kg', restSec: 90, effort: 'rir', lang: 'en', workouts: [], routines: [], exWeights: {} }
  mocks.navs = []
  mocks.toasts = []
  mocks.sheets = []
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })

const moment = name => [...host.querySelectorAll('.gl-moments button')].find(b => b.textContent === name)
const tab = name => [...host.querySelectorAll('.gl-surface button')].find(b => b.textContent === name)
const rowOf = title => [...host.querySelectorAll('.lrow')].find(r => r.querySelector('.lrow-t')?.textContent === title)
const subOf = title => rowOf(title)?.querySelector('.lrow-s')?.textContent
const said = () => host.querySelector('.gl-stage').getAttribute('aria-label')
const flip = async title => { await click(rowSwitch(title)); await rerender(<LiveWidgetSettings />) }

describe('Live widget settings', () => {
  it('previews a moment and switches between them: three segments, not nine chips', async () => {
    await render(<LiveWidgetSettings />)
    expect([...host.querySelectorAll('.gl-moments button')].map(b => b.textContent)).toEqual(['Strength set', 'Resting', 'All done'])
    expect(host.querySelector('.gl-sample')).toBeNull()
    expect(moment('Strength set').getAttribute('aria-pressed')).toBe('true')
    expect(host.querySelector('.gl-lock .gl-big').textContent).toBe('80 kg × 8')
    await click(moment('Resting'))
    expect(host.querySelector('.gl-lock.gl-rest')).toBeTruthy()
    expect(host.querySelector('.gl-countdown').textContent).toMatch(/^\d:\d\d$/)
    await click(moment('All done'))
    expect(host.querySelector('.gl-lock.gl-done')).toBeTruthy()
  })
  it('“Your workout” leads and is picked while a workout runs', async () => {
    mocks.S.active = { id: 'w1', name: 'Push', start: Date.now() - 60e3, cur: 0, entries: [{ id: '0025', target: { mode: 'reps' }, sets: [{ w: 70, r: 5 }] }] }
    await render(<LiveWidgetSettings />)
    expect([...host.querySelectorAll('.gl-moments button')].map(b => b.textContent)).toEqual(['Your workout', 'Strength set', 'Resting', 'All done'])
    expect(moment('Your workout').getAttribute('aria-pressed')).toBe('true')
    // A switch never takes the preview away from the running workout.
    await flip('What’s next')
    expect(moment('Your workout').getAttribute('aria-pressed')).toBe('true')
  })
  it('each switch writes v2 and leaves a v1 layout alone', async () => {
    mocks.S.liveLayout = LL.presetLayout('lifter')
    const v1 = JSON.stringify(mocks.S.liveLayout)
    await render(<LiveWidgetSettings />)
    // Migrated: Lifter had − and +.
    expect(rowSwitch('Weight and reps').getAttribute('aria-checked')).toBe('true')
    await click(rowSwitch('Calories'))
    expect(mocks.S.liveWidget.show.calories).toBe(true)
    expect(mocks.S.liveWidget.buttons.adjust).toBe(true)
    expect(JSON.stringify(mocks.S.liveLayout)).toBe(v1)
  })
  it('the strip switch draws the strip under itself: no tab, the preview stays where it is', async () => {
    await render(<LiveWidgetSettings />)
    expect(host.querySelector('.gl-strip-demo')).toBeNull()
    await flip('Show a strip in the workout')
    expect(mocks.S.liveWidget.card).toBe(true)
    expect([...host.querySelectorAll('.gl-surface button')].map(b => b.textContent)).toEqual(['Lock Screen', 'Dynamic Island', 'Notification'])
    expect(tab('Lock Screen').getAttribute('aria-pressed')).toBe('true')
    // The strength moment always has an exercise after it: never "Nothing to add".
    expect(host.querySelector('.gl-strip-demo .gl-strip-name').textContent).toBe('Barbell Bent Over Row')
    expect(host.querySelector('.gl-strip-empty')).toBeNull()
  })
  it('back to the defaults, with an undo', async () => {
    mocks.S.liveWidget = { look: 'clean' }
    await render(<LiveWidgetSettings />)
    const reset = [...host.querySelectorAll('.lrow')].find(r => r.textContent === 'Back to the defaults')
    await click(reset)
    expect(mocks.S.liveWidget.look).toBe('detailed')
    const [, opts] = mocks.toasts.pop()
    await act(async () => opts.onAction())
    expect(mocks.S.liveWidget).toEqual({ look: 'clean' })
  })
  it('opens Per exercise type, which names the kinds with their own setup', async () => {
    mocks.S.liveWidget = { kinds: { hold: { b: ['pause'] }, cardio: { d: [] } } }
    await render(<LiveWidgetSettings />)
    expect(rowOf('Per exercise type').querySelector('.lrow-v').textContent).toBe('Holds, Cardio')
    await click(rowOf('Per exercise type'))
    expect(mocks.navs).toEqual([['/settings/live-custom']])
  })
})

describe('the page, top to bottom', () => {
  it('Look first (it gates the rest), then the rows by moment, then the app and the rest', async () => {
    await render(<LiveWidgetSettings />)
    expect([...host.querySelectorAll('.sect-t')].map(e => e.textContent)).toEqual(['Look', 'During a set', 'During a rest', 'The whole workout', 'In the app'])
    const titles = [...host.querySelectorAll('.lrow-t')].map(e => e.textContent)
    expect(titles).toEqual(['Weight and reps', 'Next exercise', 'Pause', 'Effort (RIR)', 'Record hints', 'Exercise picture',
      'What’s next', '+15 s on rests', 'Heart rate', 'Calories', 'Time since start', 'Show a strip in the workout', 'Per exercise type'])
  })
  it('on the web: one line instead of the status card, no master switch, no test row, no help row', async () => {
    await render(<LiveWidgetSettings />)
    expect(host.querySelector('.gl-status')).toBeNull()
    expect(host.querySelector('.gl-try')).toBeNull()
    expect(rowOf('Not showing up?')).toBeUndefined()
    expect(host.querySelector('.gl-lede').textContent).toMatch(/come with the phone apps/)
    // The old paragraph about what it follows is gone.
    expect(host.textContent).not.toMatch(/It follows the exercise and the moment by itself/)
  })
  it('a row that can do nothing on this profile is not there: effort tracking off, record hints off', async () => {
    mocks.S.effort = 'none'
    mocks.S.recordHints = false
    await render(<LiveWidgetSettings />)
    const titles = [...host.querySelectorAll('.lrow-t')].map(e => e.textContent)
    expect(titles.some(x => x.startsWith('Effort'))).toBe(false)
    expect(titles).not.toContain('Record hints')
    expect(host.textContent).not.toMatch(/Effort tracking is off/)
    // Hidden rows never write.
    expect(mocks.S.liveWidget).toBeUndefined()
  })
  it('the web rows follow the tab: Android’s words and no +15 s under Notification', async () => {
    await render(<LiveWidgetSettings />)
    expect(subOf('Weight and reps')).toMatch(/^− and \+ on the weight/)
    await click(tab('Notification'))
    expect(subOf('Weight and reps')).toMatch(/^Less weight and More weight in the notification/)
    expect(subOf('Record hints')).toBe('“2 more reps for a record”, on the Home Screen widget.')
    expect(subOf('Time since start')).toBe('A running clock in the corner while a set is up.')
    expect(rowOf('+15 s on rests')).toBeUndefined()
    expect(host.querySelector('.sect-f').textContent).toBe('Adds a progress bar and up to four extras.')
    await click(tab('Dynamic Island'))
    expect(rowOf('+15 s on rests')).toBeTruthy()
  })
})

describe('a switch answers in the preview', () => {
  it('goes to the moment that shows it, and says so to a screen reader', async () => {
    await render(<LiveWidgetSettings />)
    await click(moment('All done'))
    // A rest's switch: to Resting.
    await flip('What’s next')
    expect(moment('Resting').getAttribute('aria-pressed')).toBe('true')
    expect(host.querySelector('[aria-live="polite"]').textContent).toBe('Resting')
    // A set's switch: to the strength set.
    await flip('Pause')
    expect(moment('Strength set').getAttribute('aria-pressed')).toBe('true')
    // The whole workout shows in a rest too: stays.
    await click(moment('Resting'))
    await flip('Calories')
    expect(moment('Resting').getAttribute('aria-pressed')).toBe('true')
    // But not once everything is done.
    await click(moment('All done'))
    await flip('Heart rate')
    expect(moment('Strength set').getAttribute('aria-pressed')).toBe('true')
    // Time since start and the strip show everywhere: stay.
    await click(moment('All done'))
    await flip('Time since start')
    await flip('Show a strip in the workout')
    expect(moment('All done').getAttribute('aria-pressed')).toBe('true')
    // The look, from All done.
    await click([...host.querySelectorAll('.gl-look button')].find(b => b.textContent === 'Clean'))
    await rerender(<LiveWidgetSettings />)
    expect(moment('Strength set').getAttribute('aria-pressed')).toBe('true')
  })
  it('never changes the surface', async () => {
    await render(<LiveWidgetSettings />)
    await click(tab('Dynamic Island'))
    await flip('+15 s on rests')
    expect(tab('Dynamic Island').getAttribute('aria-pressed')).toBe('true')
  })
  it('says why not, in the switch’s own subtitle, and the switch is described by it', async () => {
    await render(<LiveWidgetSettings />)
    // Record hints: the detailed look only.
    await click([...host.querySelectorAll('.gl-look button')].find(b => b.textContent === 'Clean'))
    await rerender(<LiveWidgetSettings />)
    expect(subOf('Record hints')).toBe('Only in the detailed look.')
    const sw = rowSwitch('Record hints')
    expect(document.getElementById(sw.getAttribute('aria-describedby')).textContent).toBe('Only in the detailed look.')
    await click([...host.querySelectorAll('.gl-look button')].find(b => b.textContent === 'Detailed'))
    await rerender(<LiveWidgetSettings />)
    expect(subOf('Record hints')).toBe('“2 more reps for a record”, in the detailed look.')
    // ... and it yields to the picture.
    await flip('Exercise picture')
    expect(subOf('Record hints')).toBe('Hidden while the picture or the − and + buttons are showing.')
    await flip('Exercise picture')
    // On the island's tab: the Lock Screen only.
    await click(tab('Dynamic Island'))
    expect(subOf('Record hints')).toBe('Lock Screen only.')
    // Switched off, a row says what it does again.
    await flip('Record hints')
    expect(subOf('Record hints')).toBe('“2 more reps for a record”, in the detailed look.')
  })
  it('a button with no room says where it does fit', async () => {
    mocks.S.liveWidget = { buttons: { adjust: true, nextEx: true, pause: true, addRest: true } }
    await render(<LiveWidgetSettings />)
    // Lock Screen: Log set, the effort button, Next and Pause fit (− + sit beside the numbers).
    expect(subOf('Pause')).toBe('Pauses the whole workout, clock and all.')
    await click(tab('Dynamic Island'))
    expect(subOf('Pause')).toBe('Lock Screen only.')
    await click(tab('Notification'))
    expect(subOf('Next exercise')).toBe('No room on the notification.')
    expect(subOf('Pause')).toBe('No room on the notification.')
  })
  it('a chip cut for room says so', async () => {
    mocks.S.liveWidget = { look: 'clean', show: { calories: true } }
    await render(<LiveWidgetSettings />)
    // Clean keeps to two extras: effort and heart rate take them.
    expect(subOf('Calories')).toBe('No room right now.')
    expect(subOf('Heart rate')).toMatch(/^From your watch/)
  })
})

describe('Per exercise type', () => {
  const row = name => [...host.querySelectorAll('.lrow')].find(r => r.querySelector('.lrow-t')?.textContent.startsWith(name))
  const sw = name => row(name)?.querySelector('[role="switch"]')
  it('follows the main page until “Own setup” is on; then one tap toggles one choice, for this kind only', async () => {
    await render(<LiveWidgetCustomise />)
    expect(row('Own setup for Strength')).toBeTruthy()
    expect(sw('Own setup for Strength').getAttribute('aria-checked')).toBe('false')
    expect(host.querySelector('.sect-f').textContent).toMatch(/^Follows the main page/)
    // No lists yet: nothing to pick before the switch.
    expect(row('Notes')).toBeUndefined()
    const before = host.querySelector('.gl-stage').getAttribute('aria-label')
    await click(sw('Own setup for Strength'))
    await rerender(<LiveWidgetCustomise />)
    // Seeded with exactly what the kind shows now: the preview says the same.
    expect(mocks.S.liveWidget.kinds.lift).toEqual({ d: ['effort', 'partner', 'record'], b: ['next'] })
    expect(host.querySelector('.gl-stage').getAttribute('aria-label').replace('Superset', 'Strength set')).toMatch(before.split(':')[1].split(',')[0])
    expect(host.querySelector('.sect-f').textContent).toBe('These picks replace the main page’s switches for Strength.')
    expect(sw('Notes').getAttribute('aria-checked')).toBe('false')
    await click(sw('Notes'))
    expect(mocks.S.liveWidget.kinds.lift.d).toContain('notes')
    await rerender(<LiveWidgetCustomise />)
    expect(sw('Notes').getAttribute('aria-checked')).toBe('true')
    // A pick that waits for something says so, instead of a dead switch.
    expect(row('Notes').querySelector('.lrow-s').textContent).toBe('When the exercise has a note.')
    await click(sw('Pause'))
    expect(mocks.S.liveWidget.kinds.lift.b).toContain('pause')
    expect(mocks.S.liveWidget.kinds.hold).toBeUndefined()
    expect(host.querySelector('button button')).toBeNull()
    // Off again: the kind's picks go, with a way back.
    await rerender(<LiveWidgetCustomise />)
    await click(sw('Own setup for Strength'))
    expect(mocks.S.liveWidget.kinds.lift).toBeUndefined()
    const [msg, opts] = mocks.toasts.pop()
    expect(msg).toBe('Back to the defaults.')
    await act(async () => opts.onAction())
    expect(mocks.S.liveWidget.kinds.lift.b).toContain('pause')
  })
  it('buttons that are drawn never claim “No room”', async () => {
    mocks.S.liveWidget = { kinds: { lift: { d: [], b: ['wDown', 'wUp', 'rDown', 'rUp', 'effort', 'next', 'warm', 'addSet', 'pause'] } } }
    await render(<LiveWidgetCustomise />)
    const drawn = [...host.querySelectorAll('.gl-lock .gl-btn')].map(b => b.getAttribute('aria-label'))
    for (const name of ['Warm-up', 'Add set', 'Pause', 'Next exercise']) {
      const note = row(name).querySelector('.lrow-s')?.textContent || ''
      if (drawn.includes(name)) expect(note, name).not.toMatch(/No room/)
      else expect(note, name).toBe('No room on the Lock Screen.')
    }
    // Something is cut (nine picks, four places), and something picked late is still drawn or said.
    expect(host.textContent).toMatch(/No room on the Lock Screen\./)
  })
  it('rows that can do nothing are not there: effort tracking off, record hints off', async () => {
    mocks.S.effort = 'none'
    mocks.S.recordHints = false
    mocks.S.liveWidget = { kinds: { lift: { d: [], b: [] } } }
    await render(<LiveWidgetCustomise />)
    const titles = [...host.querySelectorAll('.lrow-t')].map(e => e.textContent)
    expect(titles).toEqual(['Own setup for Strength', 'Superset partner', 'Equipment', 'Notes', 'Less weight', 'More weight', 'One rep less', 'One rep more', 'Next exercise', 'Warm-up', 'Add set', 'Pause'])
  })
})

describe('TestFlight 67 and after: the page itself', () => {
  it('the preview sits in a sticky block, with the moments under it', async () => {
    await render(<LiveWidgetSettings />)
    const sticky = host.querySelector('.gl-sticky')
    expect(sticky).toBeTruthy()
    expect(sticky.querySelector('.gl-stage')).toBeTruthy()
    expect(sticky.querySelector('.gl-moments')).toBeTruthy()
    // The switches are outside it, so they scroll under it.
    expect(sticky.querySelector('[role="switch"]')).toBeNull()
  })
  it('the stage is one image that says what is on it, buttons included, no clock', async () => {
    await render(<LiveWidgetSettings />)
    const stage = host.querySelector('.gl-stage')
    expect(stage.getAttribute('role')).toBe('img')
    expect(said()).toMatch(/^Lock Screen, Strength set: Barbell Bench Press, 80 kg × 8, Set 3 of 4/)
    expect(said()).toMatch(/Buttons: Next exercise, Log set\.$/)
    expect(said()).not.toMatch(/\d:\d\d/)
    // The two controls are named by what they pick.
    const groups = [...host.querySelectorAll('.seg[role="group"]')].map(g => document.getElementById(g.getAttribute('aria-labelledby')).textContent)
    expect(groups).toEqual(['Preview on', 'Preview a moment'])
  })
  it('switching "Time since start" or "Effort" on changes what the preview says', async () => {
    const lockText = () => host.querySelector('.gl-lock').textContent
    await render(<LiveWidgetSettings />)
    expect(host.querySelector('.gl-elapsed')).toBeNull()
    await flip('Time since start')
    expect(host.querySelector('.gl-elapsed')).toBeTruthy()
    expect(said()).toMatch(/Last set: RIR 2/)
    await flip('Effort (RIR)')
    expect(lockText()).not.toMatch(/Last set/)
  })
  it('Strength set and Resting look different', async () => {
    await render(<LiveWidgetSettings />)
    await click(moment('Strength set'))
    expect(host.querySelector('.gl-countdown')).toBeNull()
    await click(moment('Resting'))
    expect(host.querySelector('.gl-countdown')).toBeTruthy()
    expect(host.querySelector('.gl-lock .gl-kicker').textContent).toBe('Rest')
  })
  it('everything on: steppers, no record line, Log set as an icon', async () => {
    mocks.S.liveWidget = { v: 2, look: 'detailed', show: { heart: true, next: true, elapsed: true, picture: true, effort: true, record: true, calories: true }, buttons: { adjust: true, addRest: true, nextEx: true, pause: true }, card: false, kinds: {} }
    await render(<LiveWidgetSettings />)
    expect(host.querySelectorAll('.gl-lock .gl-step').length).toBe(2)
    expect(host.querySelector('.gl-lock .gl-note')).toBeNull()
    const log = host.querySelector('.gl-lock .gl-primary')
    expect(log.getAttribute('aria-label')).toBe('Log set')
    expect(log.textContent).toBe('')
  })
  it('the island says which view is which', async () => {
    await render(<LiveWidgetSettings />)
    await click(tab('Dynamic Island'))
    expect([...host.querySelectorAll('.gl-cap')].map(e => e.textContent)).toEqual(['While you use other apps', 'When you touch and hold it'])
  })
  it('kinds with their own picks are named on the main page, before the buttons’ footer', async () => {
    mocks.S.liveWidget = { kinds: { hold: { b: ['pause'] } } }
    await render(<LiveWidgetSettings />)
    const foot = [...host.querySelectorAll('.sect')].find(x => x.querySelector('.sect-t')?.textContent === 'During a set').querySelector('.sect-f').textContent
    expect(foot).toMatch(/^Holds use their own picks from Per exercise type.* Log set is always there/)
  })
  it('strength with its own setup: the set’s switches carry no note that would blame room', async () => {
    mocks.S.liveWidget = { look: 'clean', kinds: { lift: { d: ['record'], b: [] } } }
    await render(<LiveWidgetSettings />)
    expect(subOf('Record hints')).toBe('“2 more reps for a record”, in the detailed look.')
  })
})
