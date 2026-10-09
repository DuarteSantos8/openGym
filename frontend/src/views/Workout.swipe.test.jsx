// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Workout, { deleteActiveSet, undoDeleteSet, copyActiveSet, removeActiveExercise } from './Workout.jsx'
import { DEF, useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { closeOpenRow } from '../lib/use-swipe-row.js'

// Swipe on sets (v1.3.11): swipe toward the start removes a set with an Undo, toward the end
// copies it. These cover the store paths the swipe, the set menu and the Undo share, the guards
// (last set, timers), and the gesture on a real rendered row.

vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), chime: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn(), unlock: vi.fn() }))
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.resolve({})), beacon: vi.fn(), appBase: () => '/' }))

globalThis.IS_REACT_ACT_ENVIRONMENT = true
const clone = value => JSON.parse(JSON.stringify(value))
const row = (w, done = false, extra = {}) => ({ w, r: 8, done, ...extra })
const entry = (id, sets, extra = {}) => ({ id, target: { sets: sets.length, reps: 8 }, sets, ...extra })

let root
let container

function setActive(entries, { cur = 0, wc, hints = { swipeSets: true }, editing = false } = {}) {
  const S = clone(DEF)
  if (wc) S.wc = { ...S.wc, ...wc }
  S.hints = hints
  S.active = {
    id: 'swipe-test', d: '2026-10-06', start: Date.now(), routineId: null,
    name: 'Swipe test', bw: null, cur, entries,
    ...(editing ? { editingWorkoutId: 'w1' } : {}),
  }
  useStore.setState({ S, user: null })
}
const sets = (k = 0) => useStore.getState().S.active.entries[k].sets
const toast = () => useUI.getState().toastMsg

function render() {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(<MemoryRouter><Workout /></MemoryRouter>))
}

function pointer(target, type, x, y = 300, pointerType = 'touch') {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(event, { pointerId: 7, pointerType, clientX: x, clientY: y })
  act(() => { target.dispatchEvent(event) })
}
const click = target => act(() => { target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) })
// A swipe from x0 to x1 on `target`, ended with the click a browser may send after a touch.
function swipe(target, x0, x1, { dy = 0, pointerType = 'touch', clickAfter = true } = {}) {
  pointer(target, 'pointerdown', x0, 300, pointerType)
  pointer(target, 'pointermove', x0 + (x1 - x0) / 2, 300 + dy / 2, pointerType)
  pointer(target, 'pointermove', x1, 300 + dy, pointerType)
  pointer(target, 'pointerup', x1, 300 + dy, pointerType)
  if (clickAfter) click(target)
}

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  document.documentElement.dir = 'ltr'
  useUI.getState().stopRest()
  useUI.getState().stopWork()
  useUI.setState({ sheets: [], toastMsg: '', toastAction: null, timer: null, work: null, swipeHint: null, setFlash: null })
  useStore.setState({ S: clone(DEF), user: null })
  root = null
  container = null
})

afterEach(() => {
  closeOpenRow(true)
  if (root) act(() => root.unmount())
  if (container) container.remove()
  useUI.getState().stopRest()
  useUI.getState().stopWork()
  vi.clearAllTimers()
  vi.useRealTimers()
  document.documentElement.dir = 'ltr'
})

describe('removing a set, and Undo', () => {
  it('removes the set, says which, and Undo puts the exact row back in its place', () => {
    const drop = row(80, true, { type: 'dropset', drops: [{ w: 60, r: 6 }], at: 5 })
    setActive([entry('1001', [row(80, true), drop, row(80)])])
    expect(deleteActiveSet(0, 1)).toBe(true)
    expect(sets()).toHaveLength(2)
    expect(toast()).toBe('Set 2 gone.')
    expect(useUI.getState().toastAction.label).toBe('Undo')

    act(() => useUI.getState().runToastAction())
    expect(sets()).toEqual([row(80, true), drop, row(80)])
    expect(useUI.getState().setFlash).toMatchObject({ idx: 0, i: 1 })
  })

  it('numbers a warm-up as a warm-up', () => {
    setActive([entry('1001', [row(40, false, { phase: 'warmup', warmup: true }), row(80), row(80)])])
    deleteActiveSet(0, 0)
    expect(toast()).toBe('Warm-up gone.')
  })

  it('keeps the last set of a live session, and lets the editor of a saved workout take it', () => {
    setActive([entry('1001', [row(80)])])
    expect(deleteActiveSet(0, 0)).toBe(false)
    expect(sets()).toHaveLength(1)
    expect(toast()).toBe('Keep at least one set, champ')

    setActive([entry('1001', [row(80, true)])], { editing: true })
    expect(deleteActiveSet(0, 0, { editing: true })).toBe(true)
    expect(sets()).toHaveLength(0)
  })

  it('stops the rest the removed set started, and Undo does not start it again', () => {
    setActive([entry('1001', [row(80, true), row(80, true), row(80)])])
    useUI.getState().startRest(90, 0, { forSet: 1 })
    deleteActiveSet(0, 1)
    expect(useUI.getState().timer).toBeNull()
    expect(toast()).toBe('Set 2 gone. Its timer stopped too.')
    act(() => useUI.getState().runToastAction())
    expect(sets()[1].done).toBe(true)
    expect(useUI.getState().timer).toBeNull()
  })

  it('keeps a rest another set started, pointed at where that set moved', () => {
    setActive([entry('1001', [row(80, true), row(80, true), row(80)])])
    useUI.getState().startRest(90, 0, { forSet: 1 })
    deleteActiveSet(0, 0)
    expect(useUI.getState().timer?.forSet).toBe(0)
    expect(toast()).toBe('Set 1 gone.')
    act(() => useUI.getState().runToastAction())
    expect(useUI.getState().timer?.forSet).toBe(1)
  })

  it('is too late once the exercise is gone, and finds an exercise that moved', () => {
    setActive([entry('1001', [row(80), row(80)]), entry('1002', [row(50), row(50)])])
    deleteActiveSet(1, 0)
    const token = { activeId: 'swipe-test', idx: 1, entryId: '1002', i: 0, row: row(50, true) }
    removeActiveExercise(0)   // 1002 is now at 0
    expect(undoDeleteSet(token)).toBe(true)
    expect(sets(0)).toEqual([row(50, true), row(50)])

    removeActiveExercise(0)
    expect(undoDeleteSet({ ...token, entryId: '1002' })).toBe(false)
    expect(toast()).toBe('Too late, that one’s gone')
  })

  it('a newer toast takes the old Undo with it, and the removal stays', () => {
    setActive([entry('1001', [row(80), row(81), row(82)])])
    deleteActiveSet(0, 0)
    copyActiveSet(0, 0)
    expect(useUI.getState().toastAction).toBeNull()
    expect(sets().map(s => s.w)).toEqual([81, 81, 82])
  })
})

describe('copying a set', () => {
  it('puts an unticked copy right below, flashes it and says so', () => {
    setActive([entry('1001', [row(80, true, { rir: 2 }), row(80)])])
    expect(copyActiveSet(0, 0)).toBe(true)
    expect(sets()).toEqual([row(80, true, { rir: 2 }), row(80, false, { rir: 2 }), row(80)])
    expect(useUI.getState().setFlash).toMatchObject({ idx: 0, i: 1 })
    expect(toast()).toBe('Copied. One more like that one.')
    expect(useUI.getState().toastAction).toBeNull()
  })
})

describe('a hold running while rows move', () => {
  const timed = (secs, extra = {}) => entry('1002', secs.map(sec => ({ sec, w: 0, done: false })), { target: { sets: secs.length, sec: 30, mode: 'time' }, ...extra })

  it('writes what it held to its own row after a set above it was copied or removed', () => {
    setActive([timed([30, 40, 50])])
    render()
    const play = () => [...container.querySelectorAll('button[aria-label="Start set"]')]
    act(() => play()[2].click())             // hold on the 50 s row
    expect(useUI.getState().work).not.toBeNull()
    act(() => { copyActiveSet(0, 0) })       // rows: 30 30 40 50, the hold's row is now 3
    act(() => { deleteActiveSet(0, 1) })     // rows: 30 40 50, back at 2
    act(() => useUI.getState().finishWorkEarly())
    expect(sets()[2].done).toBe(true)
    expect(sets()[2].sec).toBeLessThanOrEqual(50)
    expect(sets()[0].done).toBe(false)
    expect(sets()[1].done).toBe(false)
  })

  it('stops when its own row is removed, and logs nothing anywhere', () => {
    setActive([timed([30, 40])])
    render()
    act(() => [...container.querySelectorAll('button[aria-label="Start set"]')][1].click())
    act(() => { deleteActiveSet(0, 1) })
    expect(useUI.getState().work).toBeNull()
    expect(toast()).toBe('Set 2 gone. Its timer stopped too.')
    act(() => vi.advanceTimersByTime(60_000))
    expect(sets()).toEqual([{ sec: 30, w: 0, done: false }])
  })

  it('moves the saved owner along too, so a reload brings the hold back to its own row', () => {
    setActive([timed([30, 40, 50])])
    render()
    act(() => [...container.querySelectorAll('button[aria-label="Start set"]')][2].click())
    expect(useUI.getState().work.owner).toMatchObject({ idx: 0, i: 2 })
    act(() => { copyActiveSet(0, 0) })
    expect(useUI.getState().work.owner).toMatchObject({ idx: 0, i: 3 })
    act(() => { deleteActiveSet(0, 0) })
    expect(useUI.getState().work.owner).toMatchObject({ idx: 0, i: 2 })
  })
})

describe('a timed per-side hold (an L row and an R row)', () => {
  const pair = sec => [{ sec, w: 0, done: false, side: 'L' }, { sec, w: 0, done: false, side: 'R' }]
  const sided = rows => entry('1002', rows, { target: { sets: rows.length / 2, sec: 30, mode: 'time', side: true } })

  it('removes both halves as one set, and Undo puts both back', () => {
    const rows = [...pair(30), ...pair(40)]
    setActive([sided(rows)])
    deleteActiveSet(0, 1)
    expect(sets()).toEqual(pair(40))
    expect(toast()).toBe('Set 1 gone.')
    act(() => useUI.getState().runToastAction())
    expect(sets()).toEqual(rows)
  })

  it('keeps the last pair of a live session', () => {
    setActive([sided(pair(30))])
    expect(deleteActiveSet(0, 0)).toBe(false)
    expect(sets()).toEqual(pair(30))
    expect(toast()).toBe('Keep at least one set, champ')
  })
})

describe('the swipe on a rendered set row', () => {
  const swrows = () => [...container.querySelectorAll('.swrow')]
  // happy-dom lays nothing out: give rows a phone's width so the thresholds mean what they do there.
  let widthSpy
  beforeEach(() => { widthSpy = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(360) })
  afterEach(() => widthSpy.mockRestore())
  const repsPlus = k => swrows()[k].querySelectorAll('button[aria-label="Increase"]')[1]

  it('wraps every set row when on, and none when off', () => {
    setActive([entry('1001', [row(80), row(80)])])
    render()
    expect(swrows()).toHaveLength(2)
    expect(swrows()[0].hasAttribute('data-swipe-ignore')).toBe(true)
    // the two buttons behind the row are out of reach while it is shut
    for (const pane of swrows()[0].querySelectorAll('.swpane')) {
      expect(pane.getAttribute('aria-hidden')).toBe('true')
      expect(pane.hasAttribute('inert')).toBe(true)
      expect(pane.querySelector('button').tabIndex).toBe(-1)
    }
    act(() => root.unmount()); container.remove()

    setActive([entry('1001', [row(80), row(80)])], { wc: { swipeSets: false } })
    render()
    expect(swrows()).toHaveLength(0)
    expect(container.querySelector('[data-swipe-ignore]')).toBeNull()
    expect(container.querySelectorAll('.setrow')).toHaveLength(2)
  })

  it('a tap on + is a tap, a swipe that starts on + does not press it', () => {
    setActive([entry('1001', [row(80), row(80)])])
    render()
    pointer(repsPlus(0), 'pointerdown', 200)
    pointer(repsPlus(0), 'pointerup', 200)
    click(repsPlus(0))
    expect(sets()[0].r).toBe(9)

    swipe(repsPlus(0), 200, 250)    // short: opens on Copy, nothing pressed
    expect(sets()[0].r).toBe(9)
    expect(sets()).toHaveLength(2)
  })

  it('a long swipe toward the end copies, toward the start removes with Undo', () => {
    setActive([entry('1001', [row(80, true), row(70)])])
    render()
    swipe(swrows()[0], 100, 330)
    act(() => vi.advanceTimersByTime(400))
    expect(sets().map(s => [s.w, s.done])).toEqual([[80, true], [80, false], [70, false]])

    swipe(swrows()[2], 330, 60)
    act(() => vi.advanceTimersByTime(800))
    expect(sets().map(s => s.w)).toEqual([80, 80])
    expect(toast()).toBe('Set 3 gone.')
    act(() => useUI.getState().runToastAction())
    expect(sets().map(s => s.w)).toEqual([80, 80, 70])
  })

  it('mirrors in Arabic: a swipe to the right removes', () => {
    document.documentElement.dir = 'rtl'
    setActive([entry('1001', [row(80), row(70)])])
    render()
    swipe(swrows()[1], 60, 330)
    act(() => vi.advanceTimersByTime(800))
    expect(sets().map(s => s.w)).toEqual([80])
  })

  it('rubber-bands the last set back and says why', () => {
    setActive([entry('1001', [row(80)])])
    render()
    expect(swrows()[0].querySelector('.swpane.del').classList.contains('dis')).toBe(true)
    swipe(swrows()[0], 330, 60)
    act(() => vi.advanceTimersByTime(800))
    expect(sets()).toHaveLength(1)
    expect(toast()).toBe('Keep at least one set, champ')
  })

  it('leaves vertical moves, mouse drags and the screen edges alone', () => {
    setActive([entry('1001', [row(80), row(70)])])
    render()
    swipe(swrows()[1], 200, 120, { dy: 200 })        // mostly down: a scroll
    swipe(swrows()[1], 330, 60, { pointerType: 'mouse' })
    swipe(swrows()[1], 10, 300)                      // from the left edge: iOS back
    act(() => vi.advanceTimersByTime(800))
    expect(sets().map(s => s.w)).toEqual([80, 70])
  })

  it('a short swipe opens the row on a real button, and that button acts', () => {
    setActive([entry('1001', [row(80), row(70)])])
    render()
    swipe(swrows()[1], 300, 240)
    const del = swrows()[1].querySelector('.swpane.del')
    expect(del.hasAttribute('inert')).toBe(false)
    expect(del.querySelector('button').tabIndex).toBe(0)
    click(del.querySelector('button'))
    act(() => vi.advanceTimersByTime(800))
    expect(sets().map(s => s.w)).toEqual([80])
  })

  it('in Cards, a swipe on a set row never turns the card', () => {
    setActive([entry('1001', [row(80), row(70)]), entry('1002', [row(50)])])
    render()
    swipe(swrows()[0], 300, 240)
    act(() => vi.advanceTimersByTime(800))
    expect(useStore.getState().S.active.cur).toBe(0)
  })
})

describe('the swipe on a timed per-side pair', () => {
  const pair = sec => [{ sec, w: 0, done: false, side: 'L' }, { sec, w: 0, done: false, side: 'R' }]
  const sided = rows => entry('1002', rows, { target: { sets: rows.length / 2, sec: 30, mode: 'time', side: true } })
  const swrows = () => [...container.querySelectorAll('.swrow')]
  let widthSpy
  beforeEach(() => { widthSpy = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(360) })
  afterEach(() => widthSpy.mockRestore())

  it('slides the L and R rows together, as the one set it deletes', () => {
    setActive([sided([...pair(30), ...pair(40)])])
    render()
    // one swipe per pair, each holding both of its rows
    expect(swrows()).toHaveLength(2)
    for (const sw of swrows()) expect(sw.querySelector('.swfront').querySelectorAll('.setrow')).toHaveLength(2)
    expect(container.querySelectorAll('.setrow')).toHaveLength(4)
    swipe(swrows()[0].querySelector('.swfront'), 330, 60)
    act(() => vi.advanceTimersByTime(800))
    expect(sets()).toEqual(pair(40))
  })

  it('copies the pair from either row, and draws both rows without swiping', () => {
    setActive([sided(pair(30))])
    render()
    const right = swrows()[0].querySelectorAll('.setrow')[1]
    swipe(right, 100, 330)
    act(() => vi.advanceTimersByTime(400))
    expect(sets()).toEqual([...pair(30), ...pair(30)])
    act(() => root.unmount()); container.remove()

    setActive([sided(pair(30))], { wc: { swipeSets: false } })
    render()
    expect(swrows()).toHaveLength(0)
    expect(container.querySelectorAll('.setrow')).toHaveLength(2)
  })
})

describe('the swipe panes’ words', () => {
  // QA 10-06: the Copy pane used the noun a copied routine is named with ("Kopie", "Copie").
  const packs = import.meta.glob('../locales/*.js', { eager: true, import: 'default' })
  it('the copy pane says the verb in every pack where the noun is another word', () => {
    const verb = { de: 'Kopieren', fr: 'Copier', es: 'Copiar', pt: 'Copiar', pl: 'Kopiuj', ru: 'Копировать', uk: 'Копіювати', tr: 'Kopyala' }
    for (const [lang, want] of Object.entries(verb)) expect(packs[`../locales/${lang}.js`]['Copy set'], lang).toBe(want)
    for (const [path, pack] of Object.entries(packs)) if (!/(ar|hi|it)\.js$/.test(path) && pack['Copy set']) expect(pack['Copy set'], path).not.toBe(pack.Copy)
  })
  it('renders the copy pane with that key', () => {
    setActive([entry('1001', [row(80), row(80)])])
    render()
    expect(container.querySelector('.swpane.cp b').textContent).toBe('Copy set')
  })
})

describe('the one-time hint', () => {
  it('nudges the first unticked set once per person, with a chip', () => {
    setActive([entry('1001', [row(80, true), row(80)])], { hints: {} })
    render()
    expect(container.querySelector('.swhint')).toBeNull()
    act(() => vi.advanceTimersByTime(700))
    expect(useStore.getState().S.hints.swipeSets).toBe(true)
    expect(useUI.getState().swipeHint).toMatchObject({ idx: 0, i: 1 })
    expect(container.querySelector('.swhint').textContent).toBe('Psst: swipe a set. Left deletes, right copies.')
    act(() => vi.advanceTimersByTime(6100))
    expect(container.querySelector('.swhint')).toBeNull()
  })

  it('gives way to a real swipe while it is still nudging the row', () => {
    const widthSpy = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(360)
    try {
      setActive([entry('1001', [row(80, true), row(70)])], { hints: {} })
      render()
      act(() => vi.advanceTimersByTime(700))
      expect(useUI.getState().swipeHint).toMatchObject({ idx: 0, i: 1 })
      act(() => vi.advanceTimersByTime(100))    // mid-nudge
      const hinted = container.querySelectorAll('.swrow')[1]
      swipe(hinted, 100, 330)
      act(() => vi.advanceTimersByTime(400))
      expect(sets().map(s => [s.w, s.done])).toEqual([[80, true], [70, false], [70, false]])
    } finally { widthSpy.mockRestore() }
  })

  it('stays away with swiping off, or once seen', () => {
    setActive([entry('1001', [row(80)])], { hints: {}, wc: { swipeSets: false } })
    render()
    act(() => vi.advanceTimersByTime(700))
    expect(useStore.getState().S.hints.swipeSets).toBeUndefined()
    act(() => root.unmount()); container.remove()

    setActive([entry('1001', [row(80)])], { hints: { swipeSets: true } })
    render()
    act(() => vi.advanceTimersByTime(700))
    expect(useUI.getState().swipeHint).toBeNull()
  })
})
