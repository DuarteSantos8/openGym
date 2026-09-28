// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { nextOpenSet, workoutKeyAction } from './workout-keys.js'
import { makeSideSet } from './workout-model.js'

const key = (k, extra = {}) => ({ key: k, target: document.body, ...extra })
const el = html => {
  const host = document.createElement('div')
  host.innerHTML = html
  document.body.appendChild(host)
  return host.firstElementChild
}

describe('workoutKeyAction (issue #133)', () => {
  it('Space and Enter tick, the arrows switch exercise', () => {
    expect(workoutKeyAction(key(' '))).toBe('tick')
    expect(workoutKeyAction(key('Spacebar'))).toBe('tick')
    expect(workoutKeyAction(key('Enter'))).toBe('tick')
    expect(workoutKeyAction(key('ArrowLeft'))).toBe('prev')
    expect(workoutKeyAction(key('ArrowRight'))).toBe('next')
    // Right to left (Arabic), the next exercise lies to the left, as a swipe brings it in.
    expect(workoutKeyAction(key('ArrowLeft'), { rtl: true })).toBe('next')
    expect(workoutKeyAction(key('ArrowRight'), { rtl: true })).toBe('prev')
  })

  it('leaves every other key alone, the vertical arrows included (they scroll a list)', () => {
    for (const k of ['a', 'Escape', 'Tab', 'ArrowUp', 'ArrowDown', 'Backspace']) expect(workoutKeyAction(key(k))).toBeNull()
  })

  it('never takes a key typed into a field', () => {
    for (const html of ['<input>', '<textarea></textarea>', '<select></select>', '<div contenteditable="true"></div>', '<div role="slider"></div>']) {
      const target = el(html)
      for (const k of [' ', 'Enter', 'ArrowLeft', 'ArrowRight']) expect(workoutKeyAction(key(k, { target })), html + ' ' + k).toBeNull()
    }
  })

  it('leaves browser and system shortcuts alone', () => {
    for (const mod of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey']) {
      expect(workoutKeyAction(key(' ', { [mod]: true }))).toBeNull()
      expect(workoutKeyAction(key('ArrowRight', { [mod]: true }))).toBeNull()
    }
  })

  it('ignores a held key, a key someone else already handled, and IME composition', () => {
    expect(workoutKeyAction(key(' ', { repeat: true }))).toBeNull()
    expect(workoutKeyAction(key(' ', { defaultPrevented: true }))).toBeNull()
    expect(workoutKeyAction(key('Enter', { isComposing: true }))).toBeNull()
  })

  it('a button someone tabbed to keeps Space and Enter for itself', () => {
    const target = el('<button>Finish</button>')
    expect(workoutKeyAction(key(' ', { target }), { tabbed: true })).toBeNull()
    expect(workoutKeyAction(key('Enter', { target }), { tabbed: true })).toBeNull()
    // the arrows mean nothing to a button, so they still switch exercise
    expect(workoutKeyAction(key('ArrowRight', { target }), { tabbed: true })).toBe('next')
  })

  it('a button that only has focus because it was clicked does not swallow the next tick', () => {
    const target = el('<button>Next</button>')
    expect(workoutKeyAction(key(' ', { target }), { tabbed: false })).toBe('tick')
    const check = el('<button role="checkbox"></button>')
    expect(workoutKeyAction(key('Enter', { target: check }), { tabbed: false })).toBe('tick')
  })

  it('tabbing onto plain page content still ticks', () => {
    expect(workoutKeyAction(key(' ', { target: el('<div>Bench press</div>') }), { tabbed: true })).toBe('tick')
  })
})

const ex = (done, extra = {}) => ({ id: 'x', sets: done.map(d => ({ w: 60, r: 5, done: d })), ...extra })

describe('nextOpenSet', () => {
  it('is the first open set of the current exercise', () => {
    expect(nextOpenSet([ex([true, false, false]), ex([false])], 0)).toEqual({ idx: 0, i: 1, current: true })
  })

  it('moves on to the next exercise with work left once the current one is finished', () => {
    expect(nextOpenSet([ex([true]), ex([true]), ex([false, false])], 0)).toEqual({ idx: 2, i: 0, current: false })
  })

  it('wraps round to an exercise skipped earlier', () => {
    expect(nextOpenSet([ex([false]), ex([true]), ex([true])], 2)).toEqual({ idx: 0, i: 0, current: false })
  })

  it('is null when every set is done, or there is nothing to tick', () => {
    expect(nextOpenSet([ex([true]), ex([true, true])], 1)).toBeNull()
    expect(nextOpenSet([], 0)).toBeNull()
    expect(nextOpenSet(undefined, 0)).toBeNull()
  })

  it('in a superset, the member whose turn it is, then its partner', () => {
    const entries = [ex([true, false], { sg: 'a' }), ex([true, false], { sg: 'a' }), ex([false])]
    expect(nextOpenSet(entries, 1)).toEqual({ idx: 1, i: 1, current: true })
    entries[1].sets[1].done = true
    expect(nextOpenSet(entries, 1)).toEqual({ idx: 0, i: 1, current: true })
  })

  it('a unilateral set is ticked a side at a time, left first', () => {
    const row = makeSideSet({ w: 20, r: 20 })
    const entries = [{ id: 'x', sets: [row] }]
    expect(nextOpenSet(entries, 0)).toEqual({ idx: 0, i: 0, side: 'L', current: true })
    row.sides.L.done = true
    expect(nextOpenSet(entries, 0)).toEqual({ idx: 0, i: 0, side: 'R', current: true })
  })

  it('reads a missing or out-of-range current exercise as the nearest one', () => {
    expect(nextOpenSet([ex([false]), ex([false])], undefined)).toEqual({ idx: 0, i: 0, current: true })
    expect(nextOpenSet([ex([true]), ex([false])], 9)).toEqual({ idx: 1, i: 0, current: true })
  })
})
