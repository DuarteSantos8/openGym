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
})
