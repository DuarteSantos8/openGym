// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SwipeCards, { cardAxis, cardCommits } from './SwipeCards.jsx'

let host
let root
let props

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  props = {
    index: 0,
    count: 3,
    revision: { id: 'session' },
    onNavigate: vi.fn(),
    renderPreview: direction => <div>Adjacent {direction}</div>,
  }
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
})

const render = () => act(() => root.render(
  <SwipeCards {...props}><div>Current card<button>Set control</button></div></SwipeCards>,
))

function pointer(type, x, y = 20, target = host.querySelector('[data-testid="workout-swipe-surface"]'), pointerType = 'touch', timeStamp) {
  const event = new Event(type, { bubbles: true })
  Object.assign(event, { pointerId: 1, pointerType, clientX: x, clientY: y })
  if (timeStamp != null) Object.defineProperty(event, 'timeStamp', { value: timeStamp })
  act(() => target.dispatchEvent(event))
}

describe('SwipeCards', () => {
  it('shows an inert adjacent card while keeping navigation pending until the animation completes', () => {
    render()
    pointer('pointerdown', 250)
    pointer('pointermove', 100)

    const preview = host.querySelector('.workout-swipe-preview')
    expect(preview.textContent).toContain('Adjacent 1')
    expect(preview.getAttribute('aria-hidden')).toBe('true')
    expect(preview.hasAttribute('inert')).toBe(true)
    expect(props.onNavigate).not.toHaveBeenCalled()

    pointer('pointerup', 100)
    expect(props.onNavigate).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(201))
    expect(props.onNavigate).toHaveBeenCalledExactlyOnceWith(1)
    expect(host.querySelector('.workout-swipe-preview')).toBeNull()
  })

  it('cancels short, vertical, interrupted, and stale gestures without navigating', () => {
    render()

    pointer('pointerdown', 200)
    pointer('pointermove', 170)
    pointer('pointerup', 170)
    act(() => vi.advanceTimersByTime(201))

    pointer('pointerdown', 200)
    pointer('pointermove', 170, 100)
    pointer('pointerup', 170, 100)

    pointer('pointerdown', 250)
    pointer('pointermove', 100)
    pointer('pointercancel', 100)
    act(() => vi.advanceTimersByTime(201))

    pointer('pointerdown', 250)
    pointer('pointermove', 100)
    pointer('pointerup', 100)
    props = { ...props, revision: { id: 'changed' } }
    render()
    act(() => vi.advanceTimersByTime(201))

    expect(props.onNavigate).not.toHaveBeenCalled()
    expect(host.querySelector('.workout-swipe-preview')).toBeNull()
  })

  it('resists unavailable edges and leaves mouse input alone', () => {
    render()

    pointer('pointerdown', 100)
    pointer('pointermove', 240)
    expect(host.querySelector('.workout-swipe-preview')).toBeNull()
    pointer('pointerup', 240)
    act(() => vi.advanceTimersByTime(201))

    pointer('pointerdown', 250, 20, undefined, 'mouse')
    pointer('pointermove', 100, 20, undefined, 'mouse')
    pointer('pointerup', 100, 20, undefined, 'mouse')

    expect(props.onNavigate).not.toHaveBeenCalled()
    expect(host.querySelector('.workout-swipe-preview')).toBeNull()
  })

  // #431: buttons, fields, the tick and the animation cover most of a card, and a swipe that
  // started on any of them did nothing. It turns the card now, and the control does not act.
  it('turns the card from a swipe that starts on a control, and swallows the click it leaves', () => {
    const clicked = vi.fn()
    act(() => root.render(
      <SwipeCards {...props}><div>Current card<button onClick={clicked}>Set control</button></div></SwipeCards>,
    ))
    const button = host.querySelector('button')
    pointer('pointerdown', 250, 20, button)
    pointer('pointermove', 100, 20, button)
    pointer('pointerup', 100, 20, button)
    act(() => button.click())
    expect(clicked).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(201))
    expect(props.onNavigate).toHaveBeenCalledExactlyOnceWith(1)

    // A plain tap is still a tap.
    pointer('pointerdown', 250, 20, button)
    pointer('pointerup', 250, 20, button)
    act(() => button.click())
    expect(clicked).toHaveBeenCalledTimes(1)
  })

  it('leaves sliders, chip rows, set rows and a field being typed in alone', () => {
    act(() => root.render(
      <SwipeCards {...props}><div>
        <input type="range" />
        <div className="chips"><span className="chip">Chip</span></div>
        <div data-swipe-ignore=""><span className="row">Set row</span></div>
        <input className="field" />
      </div></SwipeCards>,
    ))
    const field = host.querySelector('.field')
    field.focus()
    for (const target of [host.querySelector('input[type="range"]'), host.querySelector('.chip'), host.querySelector('.row'), field]) {
      pointer('pointerdown', 250, 20, target)
      pointer('pointermove', 100, 20, target)
      pointer('pointerup', 100, 20, target)
      act(() => vi.advanceTimersByTime(201))
    }
    expect(props.onNavigate).not.toHaveBeenCalled()
  })

  it('a tap does not hold up the swipe that follows it', () => {
    render()
    pointer('pointerdown', 250)
    pointer('pointerup', 250)
    pointer('pointerdown', 250)
    pointer('pointermove', 100)
    pointer('pointerup', 100)
    act(() => vi.advanceTimersByTime(201))
    expect(props.onNavigate).toHaveBeenCalledExactlyOnceWith(1)
  })

  it('a short quick flick turns the card, the same distance slowly does not', () => {
    render()
    pointer('pointerdown', 250, 20, undefined, 'touch', 0)
    pointer('pointermove', 235, 20, undefined, 'touch', 16)
    pointer('pointermove', 210, 20, undefined, 'touch', 32)
    pointer('pointerup', 205, 20, undefined, 'touch', 48)
    act(() => vi.advanceTimersByTime(201))
    expect(props.onNavigate).toHaveBeenCalledExactlyOnceWith(1)

    props.onNavigate.mockClear()
    pointer('pointerdown', 250, 20, undefined, 'touch', 1000)
    pointer('pointermove', 235, 20, undefined, 'touch', 1200)
    pointer('pointermove', 210, 20, undefined, 'touch', 1400)
    pointer('pointerup', 205, 20, undefined, 'touch', 1600)
    act(() => vi.advanceTimersByTime(201))
    expect(props.onNavigate).not.toHaveBeenCalled()
  })

  it('a diagonal that leans sideways is watched, then turns the card', () => {
    render()
    pointer('pointerdown', 250, 20)
    pointer('pointermove', 240, 29)       // 10 across, 9 down: too close to call yet
    expect(host.querySelector('.workout-swipe-preview')).toBeNull()
    pointer('pointermove', 200, 50)
    expect(host.querySelector('.workout-swipe-preview')).toBeTruthy()
    pointer('pointerup', 150, 60)
    act(() => vi.advanceTimersByTime(201))
    expect(props.onNavigate).toHaveBeenCalledExactlyOnceWith(1)
  })

  it('cancels a pending commit when timer or timed-work ownership changes', () => {
    props = { ...props, timerKey: 'rest:0', workKey: null }
    render()
    pointer('pointerdown', 250)
    pointer('pointermove', 100)
    pointer('pointerup', 100)
    props = { ...props, timerKey: 'rest:1' }
    render()
    act(() => vi.advanceTimersByTime(201))
    expect(props.onNavigate).not.toHaveBeenCalled()

    pointer('pointerdown', 250)
    pointer('pointermove', 100)
    pointer('pointerup', 100)
    props = { ...props, workKey: 'work:0' }
    render()
    act(() => vi.advanceTimersByTime(201))
    expect(props.onNavigate).not.toHaveBeenCalled()
  })

  it('keeps dragging when pointer capture transfers from a child to the surface', () => {
    render()
    pointer('pointerdown', 250)
    pointer('pointermove', 100)
    pointer('lostpointercapture', 100, 20, host.querySelector('.workout-swipe-card > div'))
    expect(host.querySelector('.workout-swipe-preview')).toBeTruthy()
    pointer('pointerup', 100)
    act(() => vi.advanceTimersByTime(201))
    expect(props.onNavigate).toHaveBeenCalledExactlyOnceWith(1)
  })

  // In Arabic the exercises run from right to left like the text, so the next card lies to the
  // left and comes in with a swipe to the right — the mirror of every gesture above.
  describe('right to left', () => {
    beforeEach(() => { document.documentElement.dir = 'rtl' })
    afterEach(() => { document.documentElement.dir = '' })

    it('a swipe to the right brings the next card in from the left', () => {
      props = { ...props, index: 1 }
      render()
      pointer('pointerdown', 100)
      pointer('pointermove', 250)
      const preview = host.querySelector('.workout-swipe-preview')
      expect(preview.textContent).toContain('Adjacent 1')
      expect(preview.style.transform).toContain('-100%')
      pointer('pointerup', 250)
      act(() => vi.advanceTimersByTime(201))
      expect(props.onNavigate).toHaveBeenCalledExactlyOnceWith(1)
    })

    it('a swipe to the left goes back to the previous card', () => {
      props = { ...props, index: 1 }
      render()
      pointer('pointerdown', 250)
      pointer('pointermove', 100)
      expect(host.querySelector('.workout-swipe-preview').textContent).toContain('Adjacent -1')
      pointer('pointerup', 100)
      act(() => vi.advanceTimersByTime(201))
      expect(props.onNavigate).toHaveBeenCalledExactlyOnceWith(-1)
    })
  })
})

describe('cardAxis', () => {
  it('waits for 8 px, gives anything as vertical as it is sideways to the scroll', () => {
    expect(cardAxis(7, 0)).toBeNull()
    expect(cardAxis(8, 0)).toBe('x')
    expect(cardAxis(9, 9)).toBe('y')
    expect(cardAxis(2, 10)).toBe('y')
  })
  it('locks a clearly sideways move at once and a leaning diagonal by 24 px', () => {
    expect(cardAxis(12, 10)).toBe('x')
    expect(cardAxis(-12, 10)).toBe('x')
    expect(cardAxis(11, 10)).toBeNull()
    expect(cardAxis(24, 23)).toBe('x')
  })
})

describe('cardCommits', () => {
  it('turns past 70 px, or on a flick past 30 px the way the card moved', () => {
    expect(cardCommits(-70, 0)).toBe(true)
    expect(cardCommits(-69, 0)).toBe(false)
    expect(cardCommits(-30, 0, -0.4)).toBe(true)
    expect(cardCommits(-29, 0, -2)).toBe(false)
    expect(cardCommits(-40, 0, 0.5)).toBe(false)    // flicked back the other way
    expect(cardCommits(80, 90)).toBe(false)          // ended up more vertical than sideways
  })
})
