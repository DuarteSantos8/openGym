// @vitest-environment happy-dom
// The sheet a set's number opens: W, the set's number, F and remove, the current one checked, and
// the rest of a set's options one row further down.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SetTypeSheet from './SetTypeSheet.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
let host, root, onPick, onRemove, onMore, close
const rows = () => [...host.querySelectorAll('.settype-item')]
const press = el => act(() => el.click())
function open(props = {}) {
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  act(() => root.render(<SetTypeSheet num={2} current="normal" canWarmup canFailure canRemove
    onPick={onPick} onRemove={onRemove} onMore={onMore} close={close} {...props} />))
}
beforeEach(() => { onPick = vi.fn(); onRemove = vi.fn(); onMore = vi.fn(); close = vi.fn() })
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('SetTypeSheet', () => {
  it('shows W, the set number, F and the cross, with the current type checked', () => {
    open()
    expect(rows().map(r => r.querySelector('.settype-g').textContent)).toEqual(['W', '2', 'F', ''])
    expect(rows().map(r => r.querySelector('.tt').textContent)).toEqual(['Warm-up set', 'Normal set', 'Set to failure', 'Remove the set'])
    expect(rows()[1].classList.contains('on')).toBe(true)
    expect(rows()[0].classList.contains('on')).toBe(false)
  })

  it('a tap picks the type and closes the sheet', () => {
    open()
    press(rows()[2])
    expect(close).toHaveBeenCalled()
    expect(onPick).toHaveBeenCalledWith('failure')
    press(rows()[3])
    expect(onRemove).toHaveBeenCalled()
  })

  it('greys out what the set cannot become, and has no F on cardio', () => {
    open({ canWarmup: false, canRemove: false, canFailure: false })
    expect(rows()).toHaveLength(3)
    expect(rows()[0].classList.contains('disabled')).toBe(true)
    press(rows()[0])
    expect(onPick).not.toHaveBeenCalled()
    expect(rows()[2].classList.contains('disabled')).toBe(true)
  })

  it('opens the set’s other options, or has no such row when there are none', () => {
    open()
    press(host.querySelector('.menu-item:not(.settype-item)'))
    expect(onMore).toHaveBeenCalled()
    act(() => root.unmount()); host.remove()
    open({ onMore: null })
    expect(host.querySelector('.menu-item:not(.settype-item)')).toBeNull()
  })
})
