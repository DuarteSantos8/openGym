// @vitest-environment happy-dom
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useUI } from './store/useUI.js'
import { menuSheet } from './sheets.jsx'

// menuSheet's `sections` (v1.3.11): a long menu in groups with small headers; a group with
// nothing left in it after the falsy items are dropped goes, header and all.
let host, root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [] })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); useUI.setState({ sheets: [] }) })

const show = () => {
  const sheet = useUI.getState().sheets.at(-1)
  act(() => root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))))
}

describe('menuSheet sections', () => {
  it('renders each group with its header, skips empty ones, and runs the tapped action', () => {
    const swap = vi.fn()
    menuSheet({ title: 'Bench', sections: [
      { title: 'Today', items: [{ icon: 'swap', label: 'Swap exercise', onClick: swap }, false] },
      { title: 'Nothing here', items: [null, false] },
      { items: [{ icon: 'gear', label: 'Workout settings', accent: true, chevron: true }] },
      { items: [{ icon: 'trash', label: 'Remove exercise', danger: true }] },
    ] })
    show()
    const groups = [...host.querySelectorAll('.menu-group')]
    expect(groups.map(g => g.querySelector('.menu-sec')?.textContent ?? null)).toEqual(['Today', null, null])
    expect(groups.map(g => [...g.querySelectorAll('.menu-item .tt')].map(e => e.textContent))).toEqual([['Swap exercise'], ['Workout settings'], ['Remove exercise']])
    expect(host.querySelector('.menu-item.accent .menu-chev')).toBeTruthy()
    expect(host.querySelector('.menu-item.danger .tt').textContent).toBe('Remove exercise')
    act(() => host.querySelector('.menu-item').click())
    expect(swap).toHaveBeenCalledOnce()
    expect(useUI.getState().sheets).toEqual([])
  })

  it('still takes a flat `items` list', () => {
    menuSheet({ items: [{ label: 'One' }, null, { label: 'Two' }] })
    show()
    expect([...host.querySelectorAll('.menu-item .tt')].map(e => e.textContent)).toEqual(['One', 'Two'])
    expect(host.querySelector('.menu-sec')).toBeNull()
  })

  // v1.4.4 ("the ⋯ menu has a lot lot lot"): the rarely used rows fold under one More row.
  describe('the More fold', () => {
    const remove = { icon: 'trash', label: 'Remove exercise', danger: true }
    const fold = more => menuSheet({ title: 'Bench', sections: [
      { items: [{ label: 'Add note' }, { label: 'Swap exercise' }] },
      { more },
      { items: [remove] },
    ] })
    const labels = () => [...host.querySelectorAll('.menu-item .tt')].map(e => e.textContent)

    it('shows one More row naming what is inside, and opens the groups in its place, Remove still last', () => {
      const moveUp = vi.fn()
      fold([
        { title: 'Exercise', items: [{ label: 'Exercise settings' }, null, { label: 'How to do it' }] },
        { title: 'Order and supersets', items: [{ label: 'Move up', onClick: moveUp }] },
        { title: 'Empty', items: [false] },
      ])
      show()
      expect(labels()).toEqual(['Add note', 'Swap exercise', 'More', 'Remove exercise'])
      const more = host.querySelector('.menu-more')
      expect(more.getAttribute('role')).toBe('button')
      expect(more.getAttribute('aria-expanded')).toBe('false')
      expect(more.querySelector('.ss').textContent).toBe('Exercise settings, How to do it, Move up')
      act(() => more.click())
      // Opening it is not a pick: the sheet stays.
      expect(useUI.getState().sheets.length).toBe(1)
      expect(host.querySelector('.menu-more')).toBeNull()
      expect(labels()).toEqual(['Add note', 'Swap exercise', 'Exercise settings', 'How to do it', 'Move up', 'Remove exercise'])
      expect([...host.querySelectorAll('.menu-sec')].map(e => e.textContent)).toEqual(['Exercise', 'Order and supersets'])
      // Focus lands on the first row it revealed, for the keyboard and the screen reader.
      expect(document.activeElement?.querySelector('.tt')?.textContent).toBe('Exercise settings')
      act(() => [...host.querySelectorAll('.menu-item')].find(e => e.textContent.includes('Move up')).click())
      expect(moveUp).toHaveBeenCalledOnce()
      expect(useUI.getState().sheets).toEqual([])
    })

    it('opens from the keyboard too', () => {
      fold([{ items: [{ label: 'One' }, { label: 'Two' }] }])
      show()
      act(() => host.querySelector('.menu-more').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
      expect(labels()).toEqual(['Add note', 'Swap exercise', 'One', 'Two', 'Remove exercise'])
    })

    it('shows a lone folded row as it is, and leaves an empty fold out', () => {
      fold([{ items: [null, { label: 'Rename workout' }] }, { items: [false] }])
      show()
      expect(host.querySelector('.menu-more')).toBeNull()
      expect(labels()).toEqual(['Add note', 'Swap exercise', 'Rename workout', 'Remove exercise'])
      act(() => root.render(null))
      useUI.setState({ sheets: [] })
      fold([{ items: [null] }])
      show()
      expect(labels()).toEqual(['Add note', 'Swap exercise', 'Remove exercise'])
    })
  })
})
