// @vitest-environment happy-dom
// The edge swipe back installed on a page with a back button, and the swipes that were there
// first: a set row, the workout's swipe cards and a slider still get every touch that does not
// start in the edge, and a touch that does is the page's, not theirs.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SwipeRow from '../components/SwipeRow.jsx'
import SwipeCards from '../components/SwipeCards.jsx'
import { Slider } from '../components/ui.jsx'
import { installEdgeSwipeBack } from './edge-swipe-back.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const pe = (type, x, t = 0, y = 100) => {
  const e = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(e, { pointerId: { value: 1 }, pointerType: { value: 'touch' }, clientX: { value: x }, clientY: { value: y }, timeStamp: { value: t }, button: { value: 0 } })
  return e
}

let app, host, root, stop, back, widthDesc
beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { value: 400, configurable: true })
  widthDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get() { return 360 }, configurable: true })
  window.matchMedia = vi.fn(() => ({ matches: false }))
  document.documentElement.dir = 'ltr'
  app = document.createElement('div'); app.id = 'app'
  back = document.createElement('button'); back.setAttribute('data-back', ''); back.onclick = vi.fn()
  host = document.createElement('div')
  app.append(back, host); document.body.append(app)
  root = createRoot(host)
  stop = installEdgeSwipeBack(window, { enabled: true })
})
afterEach(() => {
  stop()
  act(() => root.unmount()); app.remove()
  if (widthDesc) Object.defineProperty(HTMLElement.prototype, 'clientWidth', widthDesc); else delete HTMLElement.prototype.clientWidth
  vi.useRealTimers()
})

const drag = async (el, xs) => {
  let t = 0
  await act(async () => { el.dispatchEvent(pe('pointerdown', xs[0], t)) })
  for (const x of xs.slice(1)) await act(async () => { el.dispatchEvent(pe('pointermove', x, t += 20)) })
  await act(async () => { el.dispatchEvent(pe('pointerup', xs[xs.length - 1], t + 20)) })
  await act(async () => { await new Promise(r => setTimeout(r, 900)) })
}

describe('next to the swipes that were there first', () => {
  it('a set row still deletes from a swipe that starts mid-row; from the edge it is the page\'s', async () => {
    const onDelete = vi.fn(), onCopy = vi.fn()
    await act(async () => { root.render(<SwipeRow onDelete={onDelete} onCopy={onCopy}><span>row</span></SwipeRow>) })
    const row = host.querySelector('.swrow')
    await drag(row, [340, 316, 291, 256, 180, 100, 30])
    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(back.onclick).not.toHaveBeenCalled()

    await drag(row, [6, 30, 120, 200, 260])            // a copy swipe would go right; this one is the edge
    expect(onCopy).not.toHaveBeenCalled()
    expect(back.onclick).toHaveBeenCalledTimes(1)
  })

  it('the workout cards still turn from a swipe that starts on the card', async () => {
    vi.useFakeTimers()
    const onNavigate = vi.fn()
    act(() => root.render(<SwipeCards index={1} count={3} revision={{ id: 's' }} onNavigate={onNavigate} renderPreview={d => <div>card {d}</div>}><div>current</div></SwipeCards>))
    const surface = host.querySelector('[data-testid="workout-swipe-surface"]')
    act(() => { surface.dispatchEvent(pe('pointerdown', 250, 0, 20)) })
    act(() => { surface.dispatchEvent(pe('pointermove', 100, 50, 20)) })
    act(() => { surface.dispatchEvent(pe('pointerup', 100, 100, 20)) })
    act(() => vi.advanceTimersByTime(300))
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith(1)   // one card on
    expect(back.onclick).not.toHaveBeenCalled()
  })

  it('a slider still follows the finger', async () => {
    const onChange = vi.fn()
    act(() => root.render(<Slider value={80} min={0} max={300} step={1} onChange={onChange} />))
    const el = host.querySelector('.sld')
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ left: 50, right: 350, width: 300, top: 0, bottom: 20, height: 20, x: 50, y: 0 })
    act(() => { el.dispatchEvent(pe('pointerdown', 300)) })
    expect(onChange).toHaveBeenLastCalledWith(250)
    act(() => { window.dispatchEvent(pe('pointermove', 320)) })
    expect(onChange).toHaveBeenLastCalledWith(270)
    act(() => { window.dispatchEvent(pe('pointerup', 320)) })
    expect(back.onclick).not.toHaveBeenCalled()
  })
})
