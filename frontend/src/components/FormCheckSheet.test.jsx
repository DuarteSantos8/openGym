// @vitest-environment happy-dom
// The Form check sheets, drill-agnostic. The intro: the drill's setup, the camera and the
// drill's standards, remembered, its name and the angles it works from. The result: the counted
// reps (or seconds held) big, the no-reps (or time out of line) under them, the drill's tiles, its
// one cue as a callout, and every rep's (or stretch's) rows folded away; "Use N reps" (a hold:
// "Use N s") only where there is a set to put them in. Checked with the squat (three tiles), the
// pull-up filmed from behind (two) and the plank (a hold).
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FormCheckIntro, FormCheckResult, VIEW_WORDS } from './FormCheckSheet.jsx'
import { storedStandard } from '../lib/form-check-standard.js'
import { drillById } from '../lib/form-drills/index.js'
import { film, squatSet } from '../lib/form-drills/test-kit.js'
import { armPoses, hangDrop, hangPose } from '../lib/form-drills/pull-kit.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const SQUAT = drillById('squat')
const resultOf = (reps, opts = {}, standard) => {
  const tr = SQUAT.create({ standard })
  for (const f of squatSet(reps, opts)) tr.push(f)
  return { ...tr.result(), drill: 'squat', kind: 'reps' }
}
const FULL = { min: 45, down: 2, up: 1 }, PAR = { min: 60, down: 2, up: 1 }, SHALLOW = { min: 95, down: 2, up: 1 }
// Side-on: three counted, one too shallow.
const MISSED = resultOf([FULL, SHALLOW, PAR, FULL])
// A drill with a single standard: only what the sheets read.
const ONE = { id: 'one', kind: 'reps', standards: [{ id: 'straight', label: 'Straight' }], defaultStandard: 'straight', setup: 'Side-on, the whole body in the frame.', misses: {} }
const PLANK = drillById('plank')
const PULL_UP = drillById('pull-up')
// Pull-ups filmed from behind: the chin cannot be judged, so two tiles (the hang and the tempo).
const pullUpsFromBehind = () => {
  const frames = film(armPoses(hangPose, hangDrop(), [{ top: 0.08, up: 1, down: 1.5 }, { top: 0.08, up: 1, down: 1.5 }]), { height: 1.6, dist: 2.8, yaw: -90 })
  const tr = PULL_UP.create({})
  for (const f of frames) tr.push({ ...f, joints: { ...f.joints, nose: undefined } })
  return { ...tr.result(), drill: 'pull-up', kind: 'reps' }
}
// A plank's result as plank.js builds it: 75 s in line over two stretches, 4 s with the hips sagging between.
const HELD = {
  count: 75, missed: 4, cueId: 'missed', cue: 'Out of line for 4 s: the hips sagged. Try squeezing your glutes and bracing.',
  reps: [{ counted: true, reason: null, lost: false }, { counted: false, reason: 'sag', lost: false }, { counted: true, reason: null, lost: false }],
  tiles: [{ id: 'longest', label: 'Longest hold', value: '50 s', sub: 'in line, without a break' }, { id: 'hips', label: 'Hips', value: 'In line', sub: 'on average while held' }, { id: 'out', label: 'Out of line', value: '4 s', sub: 'not counted' }],
  details: [[{ label: 'Time', value: '25 s' }], [{ label: 'Time', value: '4 s' }], [{ label: 'Time', value: '50 s' }]],
  note: 'Each row is a stretch of the hold, in line or out of it.', drill: 'plank', kind: 'hold',
}

let root, host, close
const render = (el) => act(() => root.render(el))
const result = props => render(<FormCheckResult close={close} title="Barbell squat" drill={SQUAT} {...props} />)
const button = text => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)
const tiles = () => [...host.querySelectorAll('[data-fc-tile]')].map(t => [t.dataset.fcTile, t.querySelector('.v').textContent])

beforeEach(() => {
  localStorage.clear()
  close = vi.fn()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('FormCheckIntro', () => {
  it('shows the drill setup and its standards, the default first, and remembers the pick', () => {
    const onStart = vi.fn()
    render(<FormCheckIntro title="Barbell squat" drill={SQUAT} close={close} onStart={onStart} />)
    expect(host.querySelector('[data-fc-setup]').textContent).toBe(SQUAT.setup)
    expect(host.textContent).not.toContain('stand side-on')
    const depth = host.querySelector('[data-fc-standard]')
    expect([...depth.querySelectorAll('button')].map(b => [b.textContent, b.getAttribute('aria-pressed')]))
      .toEqual([['Parallel', 'true'], ['Below parallel', 'false'], ['Any depth', 'false']])
    act(() => button('Below parallel').click())
    act(() => button('Front camera').click())
    act(() => button('Start').click())
    expect(onStart).toHaveBeenCalledWith('front', 'below')
    expect(storedStandard('squat')).toBe('below')
  })

  it('opens on the standard picked last time', () => {
    render(<FormCheckIntro title="Barbell squat" drill={SQUAT} close={close} onStart={vi.fn()} />)
    act(() => button('Any depth').click())
    act(() => root.unmount())
    root = createRoot(host)
    render(<FormCheckIntro title="Barbell squat" drill={SQUAT} close={close} onStart={vi.fn()} />)
    expect(button('Any depth').getAttribute('aria-pressed')).toBe('true')
  })

  it('offers no choice for a drill with one standard, and names it', () => {
    const onStart = vi.fn()
    render(<FormCheckIntro title="Plank" drill={ONE} close={close} onStart={onStart} />)
    const std = host.querySelector('[data-fc-standard]')
    expect(std.querySelectorAll('button')).toHaveLength(0)
    expect(std.textContent).toBe('Counts fromStraight')
    act(() => button('Start').click())
    expect(onStart).toHaveBeenCalledWith('back', 'straight')
  })

  it('names the drill and the angles it works from, best first', () => {
    render(<FormCheckIntro title="Barbell squat" drill={SQUAT} close={close} onStart={vi.fn()} />)
    expect(host.querySelector('[data-fc-drill] b').textContent).toBe('Squat')
    expect(host.querySelector('[data-fc-views]').textContent).toBe('Works from: side, front, at an angle')
    expect(host.querySelector('[data-fc-aloud]').textContent).toMatch(/^Each rep is counted aloud\./)
    act(() => root.unmount())
    root = createRoot(host)
    render(<FormCheckIntro title="Chin-up" drill={PULL_UP} close={close} onStart={vi.fn()} />)
    expect(host.querySelector('[data-fc-drill] b').textContent).toBe('Pull-up and chin-up')
    expect(host.querySelector('[data-fc-views]').textContent).toBe('Works from: front, side, at an angle')
    expect([...host.querySelectorAll('[data-fc-standard] button')].map(b => b.textContent)).toEqual(PULL_UP.standards.map(x => x.label))
  })

  it('for a hold: the plank, side-on only, every 10 seconds said aloud, its two lines to pick from', () => {
    render(<FormCheckIntro title="Front plank" drill={PLANK} close={close} onStart={vi.fn()} />)
    expect(host.querySelector('[data-fc-drill] b').textContent).toBe('Plank')
    expect(host.querySelector('[data-fc-views]').textContent).toBe('Works from: side')
    expect(host.querySelector('[data-fc-setup]').textContent).toContain('turned sideways')
    expect(host.querySelector('[data-fc-aloud]').textContent).toMatch(/^Every 10 seconds held is said aloud\./)
    expect([...host.querySelectorAll('[data-fc-standard] button')].map(b => b.textContent)).toEqual(['Straight line', 'Strict line'])
  })
})

it('has the camera angles\' words in every language pack', async () => {
  const packs = import.meta.glob('../locales/*.js', { eager: true })
  expect(Object.keys(packs).length).toBe(25)
  for (const [file, mod] of Object.entries(packs)) {
    const missing = Object.values(VIEW_WORDS).filter(w => !(w in mod.default))
    expect({ file, missing }).toEqual({ file, missing: [] })
  }
})

describe('FormCheckResult', () => {
  it('leads with the counted reps, big, and how many did not count right under them', () => {
    result({ result: MISSED })
    expect(host.querySelector('[data-fc-count]').textContent).toBe('3')
    expect(host.querySelector('[data-fc-hero]').textContent).toContain('Counted reps')
    const missed = host.querySelector('[data-fc-missed]')
    expect(missed.textContent).toBe('1 did not count')
    expect(missed.closest('[data-fc-hero]')).toBeTruthy()
    result({ result: resultOf([FULL, FULL]) })
    expect(host.querySelector('[data-fc-missed]')).toBeNull()
  })

  it('renders the drill tiles as they come, side-on and from the front', () => {
    result({ result: MISSED })
    expect(tiles().map(x => x[0])).toEqual(['depth', 'tempo', 'consistency'])
    expect(tiles()[0][1]).toBe('3 of 4')
    result({ result: resultOf([{ ...FULL, cave: 1 }, FULL], { yaw: 90 }) })
    expect(tiles()).toContainEqual(['knees', '1 of 2'])
  })

  it('puts the one cue in a callout card, a warning for no-reps', () => {
    result({ result: MISSED })
    const cue = host.querySelector('[data-fc-cue]')
    expect(cue.classList.contains('fc-callout')).toBe(true)
    expect(cue.textContent).toBe('Reps that did not count: 1. The hip stayed above the knee.')
  })

  it('folds every rep away until "Every rep" is tapped, each with the drill rows and a no-rep marked', () => {
    result({ result: MISSED })
    const toggle = button('Every rep')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(host.querySelectorAll('[data-fc-rep]')).toHaveLength(0)
    act(() => toggle.click())
    const rows = [...host.querySelectorAll('[data-fc-rep]')]
    expect(rows).toHaveLength(4)
    expect(rows[0].textContent).toContain('Rep 1')
    expect(rows[0].textContent).toContain('Depth Below parallel')
    expect(rows[0].textContent).toMatch(/Tempo Down \d(\.\d)? s · up \d(\.\d)? s/)
    expect(rows[0].textContent).toContain('Knee angle')
    expect(rows[1].classList.contains('missed')).toBe(true)
    expect(rows[1].textContent).toContain('Not counted: too shallow')
    expect(rows[2].textContent).not.toContain('Not counted')
    expect(host.querySelector('[data-fc-note]').textContent).toBe('Filmed from the side: depth, tempo, knee angle and torso lean.')
  })

  it('still notes a rep where the camera lost the lifter', () => {
    result({ result: resultOf([FULL, FULL, FULL], { gap: [5900, 6400] }) })
    act(() => button('Every rep').click())
    const rows = [...host.querySelectorAll('[data-fc-rep]')].map(r => r.textContent)
    expect(rows[1]).toContain('Camera lost you')
    expect(rows[0]).not.toContain('Camera lost you')
  })

  it('offers "Use N reps" with the counted reps only, and only with somewhere to put them', () => {
    const onUse = vi.fn()
    result({ result: MISSED, onUse })
    expect(button('Use 4 reps')).toBeUndefined()
    act(() => button('Use 3 reps').click())
    expect(onUse).toHaveBeenCalledWith(3)
    expect(close).toHaveBeenCalled()
    result({ result: MISSED, onUse: null })
    expect(button('Use 3 reps')).toBeUndefined()
  })

  it('with nothing at all: a zero, the cue, no tiles, no rows and only Close', () => {
    result({ result: resultOf([]), onUse: vi.fn() })
    expect(host.querySelector('[data-fc-count]').textContent).toBe('0')
    expect(host.querySelectorAll('[data-fc-tile]')).toHaveLength(0)
    expect(button('Every rep')).toBeUndefined()
    expect(host.querySelector('[data-fc-cue]').textContent).toBe('No reps were counted. Get your whole body in the frame and try again.')
    expect([...host.querySelectorAll('button')].map(b => b.textContent.trim())).toEqual(['Close'])
  })

  it('with every rep missed: no tempo to show, the depth tile and the rows still there', () => {
    result({ result: resultOf([SHALLOW]), onUse: vi.fn() })
    expect(host.querySelector('[data-fc-missed]').textContent).toBe('1 did not count')
    expect(tiles()).toEqual([['depth', '0 of 1']])
    expect(button('Every rep')).toBeTruthy()
    expect(button('Use 0 reps')).toBeUndefined()
  })

  it('renders a drill with two tiles: pull-ups filmed from behind', () => {
    result({ result: pullUpsFromBehind(), drill: PULL_UP, title: 'Chin-up' })
    expect(host.querySelector('[data-fc-count]').textContent).toBe('2')
    expect(tiles().map(x => x[0])).toEqual(['hang', 'tempo'])
    act(() => button('Every rep').click())
    expect(host.querySelectorAll('[data-fc-rep]')).toHaveLength(2)
  })

  it('shows a hold under a minute as seconds held, and "Use N s"', () => {
    const held = { count: 42, missed: 0, reps: [], tiles: [{ id: 'hips', label: 'Hips', value: 'In line', sub: 'on average while held' }], cue: 'The line held steady through the hold.', cueId: 'steady', details: [] }
    const onUse = vi.fn()
    result({ result: held, drill: PLANK, title: 'Front plank', onUse })
    expect(host.querySelector('[data-fc-count]').textContent).toBe('42')
    expect(host.querySelector('[data-fc-hero]').textContent).toContain('Seconds held in position')
    expect(tiles()).toEqual([['hips', 'In line']])
    expect(button('Use 42 reps')).toBeUndefined()
    act(() => button('Use 42 s').click())
    expect(onUse).toHaveBeenCalledWith(42)
  })

  it('shows a hold of a minute or more as m:ss, the time out of line under it, and every stretch', () => {
    result({ result: HELD, drill: PLANK, title: 'Front plank', onUse: vi.fn() })
    const count = host.querySelector('[data-fc-count]')
    expect(count.textContent).toBe('1:15')
    expect(count.getAttribute('aria-label')).toBe('1 minute 15 seconds')
    expect(host.querySelector('[data-fc-hero]').textContent).toContain('Held in position')
    expect(host.querySelector('[data-fc-missed]').textContent).toBe('4 s out of line')
    expect(tiles().map(x => x[0])).toEqual(['longest', 'hips', 'out'])
    expect(button('Every rep')).toBeUndefined()
    act(() => button('Every stretch').click())
    const rows = [...host.querySelectorAll('[data-fc-rep]')].map(r => r.textContent)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toContain('Stretch 1')
    expect(rows[1]).toContain('Not counted: hips sagging')
    expect(host.querySelector('[data-fc-note]').textContent).toBe('Each row is a stretch of the hold, in line or out of it.')
    expect(button('Use 75 s')).toBeTruthy()
  })

  it('leaves "Use N s" out for an exercise whose sets are not timed, and says why', () => {
    result({ result: HELD, drill: PLANK, onUse: null, useNote: 'This exercise’s sets are not timed, so the seconds are not put into a set.' })
    expect(button('Use 75 s')).toBeUndefined()
    expect(host.querySelector('[data-fc-use-note]').textContent).toContain('not timed')
    expect([...host.querySelectorAll('.fc-actions button')].map(b => b.textContent.trim())).toEqual(['Close'])
  })
})
