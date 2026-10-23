// @vitest-environment happy-dom
// FlowBlock's hold and rest clocks use the formatter every other clock in the app uses (fmtSec,
// lib/history.js), which holds at "0:00". An unclamped mm:ss formatter of its own would render a
// negative `left` — the countdown's last tick, or a clock that ran past zero before the interval
// caught it — as "-1:00".
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import FlowBlock from './FlowBlock.jsx'
import { useUI } from '../store/useUI.js'
import { _setLangState } from '../lib/i18n-core.js'

vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), chime: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn(), unlock: vi.fn(), restOver: vi.fn(), countdown: vi.fn(), hush: vi.fn(), holdSession: vi.fn() }))
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})) }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const BENCH = '0025'   // barbell bench press in the library
const entries = [{ id: BENCH, target: { sets: 1, reps: 5 }, sets: [{ w: 100, r: 5, done: false }] }]
const unit = [0]
const owner = { idx: 0, i: 0, id: BENCH }   // the row a hold writes to (useUI.work.owner)

let host, root
const mount = () => act(() => root.render(
  <FlowBlock entries={entries} unit={unit} cur={0} block="flow" onResume={() => {}} onRows={() => {}} />
))
const clockText = () => host.querySelector('.flowblk-clock')?.textContent

beforeEach(() => {
  useUI.setState({ timer: null, work: null })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  useUI.setState({ timer: null, work: null })
})

describe('FlowBlock — the running clock', () => {
  it('clamps a negative hold time to 0:00 instead of going negative', () => {
    useUI.setState({ work: { owner, left: -5, total: 30, paused: false, label: '' } })
    mount()
    expect(clockText()).toBe('0:00')
  })

  it('reads an ordinary positive hold the same way', () => {
    useUI.setState({ work: { owner, left: 65, total: 90, paused: false, label: '' } })
    mount()
    expect(clockText()).toBe('1:05')
  })

  it('clamps a negative rest the same way', () => {
    useUI.setState({ timer: { forIdx: 0, left: -1, total: 15, kind: 'round' } })
    mount()
    expect(clockText()).toBe('0:00')
  })

  // A round's rest that ran out with the phone locked waits on the bar as Ready: the card offers its
  // own button again rather than reading "Rest 0:00" with nothing to press.
  it('a rest at Ready is not a countdown: the card shows the plan and its button', () => {
    const block = [{ id: '1368', sg: 'w', target: { mode: 'time', sets: 2, sec: 35, restSec: 15 }, sets: [{ sec: 35, done: true }, { sec: 35, done: false }] },
      { id: '1460', sg: 'w', target: { mode: 'time', sets: 2, sec: 40, restSec: 15 }, sets: [{ sec: 40, done: true }, { sec: 40, done: false }] }]
    useUI.setState({ timer: { forIdx: 1, left: 0, total: 15, kind: 'round', ready: true } })
    act(() => root.render(<FlowBlock entries={block} unit={[0, 1]} cur={0} block="warmup" onResume={() => {}} onRows={() => {}} />))
    expect(clockText()).toBe('0:35')
    expect(host.querySelector('.flowblk-go')?.textContent).toBe('Resume warm-up')
  })

  // A per-side hold's switch pause inside a flow block (per-side holds run in a flow too) says
  // what it is, as the bar does.
  it('calls a switch-sides pause by its name, and counts a per-side pair as one round', () => {
    const block = [{ id: '1368', sg: 'w', target: { mode: 'time', sets: 2, sec: 30, restSec: 10, side: true },
      sets: [{ sec: 30, side: 'L', done: true }, { sec: 30, side: 'R', done: false }, { sec: 30, side: 'L', done: false }, { sec: 30, side: 'R', done: false }] },
    { id: '1460', sg: 'w', target: { mode: 'time', sets: 2, sec: 40, restSec: 10 }, sets: [{ sec: 40, done: false }, { sec: 40, done: false }] }]
    useUI.setState({ timer: { forIdx: 0, left: 8, total: 10, kind: 'switch', forSet: 0 } })
    act(() => root.render(<FlowBlock entries={block} unit={[0, 1]} cur={0} block="cooldown" onResume={() => {}} onRows={() => {}} />))
    expect(host.querySelector('.flowblk-now .muted')?.textContent).toBe('Switch sides')
    expect(clockText()).toBe('0:08')
    expect(host.querySelector('.flowblk-hd').textContent).toContain('Round 1 of 2')
    expect(host.querySelector('.flowblk-mv.at')?.dataset.exidx).toBe('0')   // the same stretch, its other side
    // What the pause hands over to is the right side, not the next movement.
    expect(host.querySelector('.flowblk-next')?.textContent).toBe('Next · Right side')
    // Marked for index.css to keep the pack's own casing (the line capitalises every word, for the
    // library's lowercase names). The rule itself is not loaded here; it was checked in WebKit.
    expect(host.querySelector('.flowblk-next').classList.contains('side')).toBe(true)
  })

  // The two halves of a per-side hold read "Hold" alike; the card says which side is on the clock.
  it('names the side of a per-side hold, and still says Hold for any other', () => {
    const block = [{ id: '1368', sg: 'w', target: { mode: 'time', sets: 1, sec: 30, restSec: 10, side: true },
      sets: [{ sec: 30, side: 'L', done: true }, { sec: 30, side: 'R', done: false }] },
    { id: '1460', sg: 'w', target: { mode: 'time', sets: 1, sec: 40, restSec: 10 }, sets: [{ sec: 40, done: false }] }]
    const render = () => act(() => root.render(<FlowBlock entries={block} unit={[0, 1]} cur={0} block="cooldown" onResume={() => {}} onRows={() => {}} />))
    const said = () => [host.querySelector('.flowblk-now .muted')?.textContent, host.querySelector('.flowblk-next')?.textContent]
    useUI.setState({ work: { owner: { idx: 0, i: 1, id: '1368' }, left: 20, total: 30, paused: false, label: '' } })
    render()
    expect(said()).toEqual(['Right side', 'Next · Walking Lunge'])
    expect(host.querySelector('.flowblk-next').classList.contains('side')).toBe(false)
    useUI.setState({ work: { owner: { idx: 1, i: 0, id: '1460' }, left: 20, total: 40, paused: false, label: '' } })
    render()
    expect(said()[0]).toBe('Hold')
  })

  // The side has to be on the card whenever the block stands on a per-side row — paused,
  // or waiting on its button after a left side that ran out in a pocket — and Next may say the
  // right side only once the left one is named above it, never under a round's "Rest".
  describe('a per-side movement when nothing is being held', () => {
    const sided = (id, sets) => ({ id, sg: 'w', target: { mode: 'time', sets: sets.length / 2, sec: 30, restSec: 10, side: true },
      sets: sets.map((done, k) => ({ sec: 30, side: k % 2 ? 'R' : 'L', done })) })
    const plain = (id, sets) => ({ id, sg: 'w', target: { mode: 'time', sets: sets.length, sec: 40, restSec: 10 }, sets: sets.map(done => ({ sec: 40, done })) })
    const render = block => act(() => root.render(<FlowBlock entries={block} unit={[0, 1]} cur={0} block="cooldown" onResume={() => {}} onRows={() => {}} />))
    const said = () => [host.querySelector('.flowblk-now .muted')?.textContent, host.querySelector('.flowblk-next')?.textContent]

    it('before the block starts: the left side, then the right side next', () => {
      render([sided('1368', [false, false]), plain('1460', [false])])
      expect(said()).toEqual(['Ready · Left side', 'Next · Right side'])
    })

    it('waiting on Resume with the right side still to do', () => {
      render([sided('1368', [true, false]), plain('1460', [false])])
      expect(said()).toEqual(['Paused · Right side', 'Next · Walking Lunge'])
      expect(host.querySelector('.flowblk-go')?.textContent).toBe('Resume cool-down')
    })

    it('a paused hold keeps its side', () => {
      useUI.setState({ work: { owner: { idx: 0, i: 1, id: '1368' }, left: 12, total: 30, paused: true, label: '' } })
      render([sided('1368', [true, false]), plain('1460', [false])])
      expect(said()).toEqual(['Paused · Right side', 'Next · Walking Lunge'])
    })

    it('a round\'s rest into it says Rest, and not the right side as next', () => {
      useUI.setState({ timer: { forIdx: 1, left: 8, total: 10, kind: 'round' } })
      render([sided('1368', [true, true, false, false]), plain('1460', [true, false])])
      expect(said()).toEqual(['Rest', 'Next · Walking Lunge'])
    })

    it('a switch pause after the right side hands over to the left', () => {
      useUI.setState({ timer: { forIdx: 0, left: 8, total: 10, kind: 'switch', forSet: 1 } })
      render([sided('1368', [false, true]), plain('1460', [false])])
      expect(said()).toEqual(['Switch sides', 'Next · Left side'])
    })

    // Only an 'L' or 'R' work row of the exercise the hold belongs to has a side to name.
    it('names no side from a row that is not one', () => {
      useUI.setState({ work: { owner: { idx: 0, i: 0, id: 'not-this-exercise' }, left: 12, total: 30, paused: false, label: '' } })
      render([sided('1368', [false, false]), plain('1460', [false])])
      expect(said()).toEqual(['Hold', 'Next · Walking Lunge'])
      useUI.setState({ work: null })
      const odd = sided('1368', [false, false])
      odd.sets[0].side = 'left'
      render([odd, plain('1460', [false])])
      expect(said()).toEqual(['Ready', 'Next · Walking Lunge'])
      // A warm-up row carries no side, and is no left half for the right row after it.
      const warm = sided('1368', [false, false])
      warm.sets[0].phase = 'warmup'
      render([warm, plain('1460', [false])])
      expect(said()).toEqual(['Ready', 'Next · Walking Lunge'])
    })

    // A switch pause belongs to the movement it was started for (timer.forIdx). If the card stands on
    // another one (an earlier member that still owes the round), that one's side is not what is next.
    it('a switch pause for another movement does not name this one\'s side', () => {
      useUI.setState({ timer: { forIdx: 1, left: 8, total: 10, kind: 'switch', forSet: 0 } })
      render([sided('1368', [false, false]), sided('1460', [true, false])])
      expect(said()).toEqual(['Switch sides', 'Next · Walking Lunge'])
    })
  })

  // Settings → Get ready before each hold (useUI.startWork's prep): the movement about to start is
  // named above, and the clock is the count to it, not the hold's full length.
  it('shows the get-ready count, not the hold, while it runs', () => {
    useUI.setState({ work: { owner, left: 30, total: 30, prep: 4, prepTotal: 5, paused: false, label: '' } })
    mount()
    expect(clockText()).toBe('0:04')
    expect(host.querySelector('.flowblk-now .muted')?.textContent).toBe('Get ready')
  })
})

// The card title-cases a name only where the language wants it, as every other name in the app
// (lib/i18n-core.js exerciseNameClass): English names are stored lower case, a German one carries
// its own capitals. With CSS capitalize on the card, "Kniebeuge mit Band" read "Kniebeuge Mit Band".
describe('FlowBlock — exercise names', () => {
  const held = id => ({ id, sg: 'g', target: { mode: 'time', sets: 1, sec: 30, restSec: 10 }, sets: [{ sec: 30, w: 0, done: false }] })
  const pair = [held('1004'), held('1005')]
  const show = () => act(() => root.render(<FlowBlock entries={pair} unit={[0, 1]} cur={0} block="flow" onResume={() => {}} onRows={() => {}} />))
  afterEach(() => _setLangState('en', null, null, null))

  it('title-cases an English name, the movement on now, its row and the next one alike', () => {
    show()
    expect(host.querySelector('.flowblk-name').classList.contains('capitalize')).toBe(true)
    expect([...host.querySelectorAll('.flowblk-mv .tt')].every(el => el.classList.contains('capitalize'))).toBe(true)
    expect(host.querySelector('.flowblk-next').textContent).toBe('Next · Band Standing Crunch')
  })

  // The card's own styles leave the casing to that class: a capitalize in them would undo it.
  it('has no capitalize of its own for a name', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    const rules = [...css.matchAll(/([^{}]*\.flowblk[^{}]*)\{([^}]*)\}/g)].filter(([, sel, body]) => /flowblk-(name|next|mv)/.test(sel) && /text-transform\s*:\s*capitalize/.test(body))
    expect(rules.map(r => r[1].trim())).toEqual([])
  })

  it('leaves a German name its own capitals everywhere on the card', () => {
    _setLangState('de', null, null, { 1004: 'Kniebeuge mit Band', 1005: 'Stehender Crunch mit Band' })
    show()
    expect(host.querySelector('.flowblk-name').classList.contains('capitalize')).toBe(false)
    expect(host.querySelector('.flowblk-name').textContent).toContain('Kniebeuge mit Band')
    expect([...host.querySelectorAll('.flowblk-mv .tt')].some(el => el.classList.contains('capitalize'))).toBe(false)
    expect(host.querySelector('.flowblk-next').textContent).toContain('Stehender Crunch mit Band')
  })
})
