// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SwipeCards from './SwipeCards.jsx'

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

function pointer(type, x, y = 20, target = host.querySelector('[data-testid="workout-swipe-surface"]'), pointerType = 'touch') {
  const event = new Event(type, { bubbles: true })
  Object.assign(event, { pointerId: 1, pointerType, clientX: x, clientY: y })
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

  it('resists unavailable edges and leaves controls, mouse input, and vertical scrolling alone', () => {
    render()

    pointer('pointerdown', 100)
    pointer('pointermove', 240)
    expect(host.querySelector('.workout-swipe-preview')).toBeNull()
    pointer('pointerup', 240)
    act(() => vi.advanceTimersByTime(201))

    const button = host.querySelector('button')
    pointer('pointerdown', 250, 20, button)
    pointer('pointermove', 100)
    pointer('pointerup', 100)

    pointer('pointerdown', 250, 20, undefined, 'mouse')
    pointer('pointermove', 100, 20, undefined, 'mouse')
    pointer('pointerup', 100, 20, undefined, 'mouse')

    expect(props.onNavigate).not.toHaveBeenCalled()
    expect(host.querySelector('.workout-swipe-preview')).toBeNull()
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
})
