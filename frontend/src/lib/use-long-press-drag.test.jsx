// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useLongPressDrag } from './use-long-press-drag.js'
import * as haptics from './haptics.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const pe = (type, x, y, id = 1) => {
  const e = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(e, { pointerId: { value: id }, clientX: { value: x }, clientY: { value: y }, button: { value: 0 } })
  return e
}
const rect = (top, h = 50) => ({ top, bottom: top + h, left: 0, right: 300, height: h, width: 300 })

let host, root, d, onReorder, onDropOn
function Harness() {
  const listRef = React.useRef(null)
  d = useLongPressDrag({ listRef, rows: ['a', 'b', 'c'], onReorder, onDropOn, nameOf: x => x.toUpperCase() })
  return (
    <div>
      <div id="t" {...d.targetProps('folder1')} />
      <div id="list" ref={listRef} style={{ overflowY: 'auto' }}>
        {['a', 'b', 'c'].map(id => <div key={id} id={id} {...d.rowProps(id)} />)}
      </div>
    </div>
  )
}
const $ = id => host.querySelector('#' + id)
const fire = (el, type, x, y, id) => act(() => { el.dispatchEvent(pe(type, x, y, id)) })

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(haptics, 'tick').mockImplementation(() => {})
  onReorder = vi.fn(); onDropOn = vi.fn()
  host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(<Harness />))
  $('t').getBoundingClientRect = () => rect(0, 40)
  ;['a', 'b', 'c'].forEach((id, i) => { $(id).getBoundingClientRect = () => rect(100 + i * 60) })
  $('list').getBoundingClientRect = () => rect(80, 400)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.runOnlyPendingTimers(); vi.useRealTimers(); vi.restoreAllMocks() })

describe('useLongPressDrag', () => {
  it('does not lift when the finger moves 9 px before the hold', () => {
    fire($('a'), 'pointerdown', 10, 120)
    fire(window, 'pointermove', 10, 129)
    act(() => { vi.advanceTimersByTime(500) })
    expect(d.lifted).toBe(null)
  })

  it('lifts at 450 ms, with a placeholder height, and ticks', () => {
    fire($('a'), 'pointerdown', 10, 120)
    act(() => { vi.advanceTimersByTime(449) })
    expect(d.lifted).toBe(null)
    act(() => { vi.advanceTimersByTime(1) })
    expect(d.lifted).toBe('a')
    expect(d.drag.height).toBe(50)
    expect(haptics.tick).toHaveBeenCalledWith('lift')
  })

  it('drops on a target: onDropOn(key, id) and an announcement', () => {
    fire($('a'), 'pointerdown', 10, 120)
    act(() => { vi.advanceTimersByTime(450) })
    fire(window, 'pointermove', 10, 20)
    expect(d.over).toEqual({ kind: 'target', key: 'folder1' })
    fire(window, 'pointerup', 10, 20)
    expect(onDropOn).toHaveBeenCalledWith('folder1', 'a')
    expect(d.lifted).toBe(null)
    expect(d.announce).toBe('Moved A to FOLDER1')
    expect(haptics.tick).toHaveBeenCalledWith('drop')
  })

  it('drops on a row: onReorder(from, to)', () => {
    fire($('a'), 'pointerdown', 10, 120)
    act(() => { vi.advanceTimersByTime(450) })
    fire(window, 'pointermove', 10, 235)
    expect(d.over).toEqual({ kind: 'row', key: 'c' })
    fire(window, 'pointerup', 10, 235)
    expect(onReorder).toHaveBeenCalledWith(0, 2)
    expect(d.announce).toBe('Moved A to C')
  })

  it('pointercancel restores and calls nothing', () => {
    fire($('a'), 'pointerdown', 10, 120)
    act(() => { vi.advanceTimersByTime(450) })
    fire(window, 'pointermove', 10, 235)
    fire(window, 'pointercancel', 10, 235)
    expect(d.lifted).toBe(null); expect(d.over).toBe(null)
    expect(onReorder).not.toHaveBeenCalled(); expect(onDropOn).not.toHaveBeenCalled()
  })

  it('a quick tap never lifts and never drops', () => {
    fire($('a'), 'pointerdown', 10, 120)
    fire(window, 'pointerup', 10, 120)
    act(() => { vi.advanceTimersByTime(500) })
    expect(d.lifted).toBe(null)
    expect(onDropOn).not.toHaveBeenCalled()
  })

  it('scrolls the list within 56 px of its top edge', () => {
    $('list').scrollTop = 100
    fire($('a'), 'pointerdown', 10, 120)
    act(() => { vi.advanceTimersByTime(450) })
    fire(window, 'pointermove', 10, 100) // 20 px under the list top (80)
    act(() => { vi.advanceTimersByTime(48) })
    expect($('list').scrollTop).toBeLessThan(100)
  })

  it('swallows the click after a lifted release, not a plain tap', () => {
    const click = vi.fn()
    $('a').addEventListener('click', click)
    fire($('a'), 'pointerdown', 10, 120)
    act(() => { vi.advanceTimersByTime(450) })
    fire(window, 'pointerup', 10, 120)
    act(() => { $('a').dispatchEvent(new Event('click', { bubbles: true, cancelable: true })) })
    expect(click).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(1) })
    act(() => { $('a').dispatchEvent(new Event('click', { bubbles: true, cancelable: true })) })
    expect(click).toHaveBeenCalledTimes(1)
  })

  it('finds a row wrapped by another element (SwipeRow)', () => {
    act(() => root.unmount())
    root = createRoot(host)
    function Wrapped() {
      const listRef = React.useRef(null)
      d = useLongPressDrag({ listRef, rows: ['a', 'b'], onReorder, onDropOn })
      return <div id="list" ref={listRef}>{['a', 'b'].map(id => <div key={id} className="swipe"><div id={id} {...d.rowProps(id)} /></div>)}</div>
    }
    act(() => root.render(<Wrapped />))
    $('a').getBoundingClientRect = () => rect(100)
    $('b').getBoundingClientRect = () => rect(160)
    fire($('a'), 'pointerdown', 10, 120)
    act(() => { vi.advanceTimersByTime(450) })
    fire(window, 'pointermove', 10, 180)
    fire(window, 'pointerup', 10, 180)
    expect(onReorder).toHaveBeenCalledWith(0, 1)
  })

  it('ignores a second finger, and held() says when a row is lifted', () => {
    fire($('a'), 'pointerdown', 10, 120)
    expect(d.held()).toBe(false)
    act(() => { vi.advanceTimersByTime(450) })
    expect(d.held()).toBe(true)
    fire(window, 'pointermove', 10, 20, 2)
    fire(window, 'pointerup', 10, 20, 2)
    expect(d.lifted).toBe('a')
    expect(onDropOn).not.toHaveBeenCalled()
    fire(window, 'pointermove', 10, 20, 1)
    fire(window, 'pointerup', 10, 20, 1)
    expect(onDropOn).toHaveBeenCalledWith('folder1', 'a')
    expect(d.held()).toBe(false)
  })

  it('clears the announcement after a moment, so a repeat is heard', () => {
    fire($('a'), 'pointerdown', 10, 120)
    act(() => { vi.advanceTimersByTime(450) })
    fire(window, 'pointermove', 10, 20)
    fire(window, 'pointerup', 10, 20)
    expect(d.announce).toBe('Moved A to FOLDER1')
    act(() => { vi.advanceTimersByTime(1500) })
    expect(d.announce).toBe('')
  })
})
