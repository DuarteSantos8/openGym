// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
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
      <div id="t" {...d.targetProps('folder1')}><div className="ss" /></div>
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

describe('where the lifted row rides', () => {
  const lift = y => { fire($('b'), 'pointerdown', 10, 180); act(() => { vi.advanceTimersByTime(450) }); fire(window, 'pointermove', 10, y) }
  it('puts its bottom edge 20 px above the finger (16 plus the tilt)', () => {
    lift(300) // row b starts at top 160, 50 high: wanted top 300 - 20 - 50 = 230
    expect(d.drag.dy).toBe(230 - 160)
  })
  it('rides below the finger when there is no room above', () => {
    lift(120) // 120 - 20 - 50 < 0 (the page top): top at 140
    expect(d.drag.dy).toBe(140 - 160)
  })
})

describe('edge scroll', () => {
  it('does not touch the page when there is nothing above to scroll to', () => {
    $('list').scrollTop = 0
    fire($('a'), 'pointerdown', 10, 120)
    act(() => { vi.advanceTimersByTime(450) })
    const before = d.drag
    fire(window, 'pointermove', 10, 100)
    const at = d.drag
    act(() => { vi.advanceTimersByTime(160) })
    expect($('list').scrollTop).toBe(0)
    expect(d.drag).toBe(at) // no refresh from the timer
    expect(before).not.toBe(undefined)
  })
})

describe('over another list', () => {
  it('rides below the finger, since that list\'s caption is above it', () => {
    const a = document.createElement('div'); a.setAttribute('data-drop-area', 'other'); a.getBoundingClientRect = () => rect(300, 200); host.appendChild(a)
    fire($('a'), 'pointerdown', 10, 120)
    act(() => { vi.advanceTimersByTime(450) })
    fire(window, 'pointermove', 10, 400)
    expect(d.over).toEqual({ kind: 'target', key: 'other' })
    expect(d.drag.dy).toBe(420 - 100)
  })

  describe('motion', () => {
    afterEach(() => { document.documentElement.classList.remove('reduce-motion') })

    it('dips the row at 120 ms of the hold (data-cue) and clears it at the lift', () => {
      fire($('a'), 'pointerdown', 10, 120)
      act(() => { vi.advanceTimersByTime(119) })
      expect($('a').hasAttribute('data-cue')).toBe(false)
      act(() => { vi.advanceTimersByTime(1) })
      expect($('a').hasAttribute('data-cue')).toBe(true)
      act(() => { vi.advanceTimersByTime(330) })
      expect(d.lifted).toBe('a')
      expect($('a').hasAttribute('data-cue')).toBe(false)
    })

    it('a scroll away from the cue lets go of it', () => {
      fire($('a'), 'pointerdown', 10, 120)
      act(() => { vi.advanceTimersByTime(130) })
      fire(window, 'pointermove', 10, 140)
      expect($('a').hasAttribute('data-cue')).toBe(false)
    })

    it('reads the row layout again only after the finger moved 2 px', () => {
      fire($('a'), 'pointerdown', 10, 120)
      act(() => { vi.advanceTimersByTime(450) })
      const spy = vi.spyOn($('b'), 'getBoundingClientRect')
      fire(window, 'pointermove', 10, 121)
      expect(spy).not.toHaveBeenCalled()
      fire(window, 'pointermove', 10, 123)
      expect(spy).toHaveBeenCalled()
    })

    it('a reorder drop settles the row from where it was let go (transform, 280 ms)', () => {
      fire($('a'), 'pointerdown', 10, 120)
      act(() => { vi.advanceTimersByTime(450) })
      fire(window, 'pointermove', 10, 235)
      let reads = 0
      $('a').getBoundingClientRect = () => rect(reads++ < 2 ? 200 : 100) // lifted at 200, home at 100
      fire(window, 'pointerup', 10, 235)
      expect($('a').style.transition).toContain('transform 280ms')
      act(() => { $('a').dispatchEvent(new Event('transitionend')) })
      expect($('a').style.transition).toBe('')
    })

    it('a store write that renders before the lift clears still settles the row', () => {
      let n = 0; const subs = new Set()
      const store = { get: () => n, sub: f => { subs.add(f); return () => subs.delete(f) } }
      onReorder = vi.fn(() => { n++; flushSync(() => subs.forEach(f => f())) }) // a sync-lane render, ahead of the hook's own state
      function Store() {
        React.useSyncExternalStore(store.sub, store.get)
        return <Harness />
      }
      act(() => root.render(<Store />))
      ;['a', 'b', 'c'].forEach((id, i) => { $(id).getBoundingClientRect = () => rect(100 + i * 60) })
      fire($('a'), 'pointerdown', 10, 120)
      act(() => { vi.advanceTimersByTime(450) })
      fire(window, 'pointermove', 10, 175) // over b
      let reads = 0
      $('a').getBoundingClientRect = () => rect(reads++ < 2 ? 200 : 100)
      fire(window, 'pointerup', 10, 175)
      expect(onReorder).toHaveBeenCalled()
      expect($('a').style.transition).toContain('transform 280ms')
    })

    it('a drop into a folder flies a copy and ticks the target, then cleans up', () => {
      const anim = { onfinish: null }
      const animate = vi.fn(() => anim)
      window.Element.prototype.animate = animate
      fire($('a'), 'pointerdown', 10, 120)
      act(() => { vi.advanceTimersByTime(450) })
      fire(window, 'pointermove', 10, 20)
      fire(window, 'pointerup', 10, 20)
      expect(animate).toHaveBeenCalled()
      expect(document.querySelector('.drag-ghost')).not.toBeNull()
      expect(document.querySelector('.drag-slot-ghost')).not.toBeNull()
      act(() => { vi.advanceTimersByTime(200) })
      expect($('t').querySelector('.ss').classList.contains('drop-tick')).toBe(true)
      expect(document.querySelector('.drag-ghost').getAttribute('aria-hidden')).toBe('true')
      expect(document.querySelector('.drag-ghost').inert).toBe(true)
      act(() => { anim.onfinish() })
      expect(document.querySelector('.drag-ghost')).toBeNull()
      delete window.Element.prototype.animate
    })

    it('a drop into a list with no target of its own ticks nothing in it', () => {
      const area = document.createElement('div'); area.setAttribute('data-drop-area', 'loose')
      area.innerHTML = '<div><span class="ss">x</span></div>'
      host.appendChild(area)
      window.Element.prototype.animate = vi.fn(() => ({}))
      const a = document.querySelector('[data-drop-area="loose"]')
      a.getBoundingClientRect = () => rect(500, 200)
      fire($('a'), 'pointerdown', 10, 120)
      act(() => { vi.advanceTimersByTime(450) })
      fire(window, 'pointermove', 10, 550)
      fire(window, 'pointerup', 10, 550)
      act(() => { vi.advanceTimersByTime(300) })
      expect(a.querySelector('.ss').classList.contains('drop-tick')).toBe(false)
      area.remove(); delete window.Element.prototype.animate
    })

    it('Reduce Motion: no cue, no flight, no transform transition, a 120 ms fade instead', () => {
      document.documentElement.classList.add('reduce-motion')
      const animate = window.Element.prototype.animate = vi.fn()
      fire($('a'), 'pointerdown', 10, 120)
      act(() => { vi.advanceTimersByTime(200) })
      expect($('a').hasAttribute('data-cue')).toBe(false)
      act(() => { vi.advanceTimersByTime(250) })
      fire(window, 'pointermove', 10, 235)
      fire(window, 'pointerup', 10, 235)
      expect($('a').style.transition).toBe('')
      expect($('a').style.transform).toBe('')
      expect($('a').classList.contains('drop-fade')).toBe(true)
      fire($('a'), 'pointerdown', 10, 120)
      act(() => { vi.advanceTimersByTime(450) })
      fire(window, 'pointermove', 10, 20)
      fire(window, 'pointerup', 10, 20)
      expect(animate).not.toHaveBeenCalled()
      delete window.Element.prototype.animate
      expect(document.querySelector('.drag-ghost')).toBeNull()
    })
  })
})
