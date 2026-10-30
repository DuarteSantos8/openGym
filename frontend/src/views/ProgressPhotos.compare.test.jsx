// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { useUI } from '../store/useUI.js'
import { openProgressCompare } from './ProgressPhotos.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const photo = (d, n) => ({ d, m: { kind: 'image', hash: String(n).padStart(64, '0'), mime: 'image/jpeg' } })

describe('before/after compare in a right-to-left language', () => {
  let root, host
  afterEach(() => {
    act(() => root?.unmount())
    host?.remove()
    document.documentElement.removeAttribute('dir')
    useUI.getState().closeAll()
  })

  it('keeps the stage left-to-right so the handle follows the finger and "before" sits on the before photo', () => {
    document.documentElement.setAttribute('dir', 'rtl')
    openProgressCompare(photo('2026-01-01', 1), photo('2026-03-01', 2))
    const sheet = useUI.getState().sheets.at(-1)
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => root.render(sheet.render(() => {})))
    act(() => host.querySelectorAll('.pp-modes button')[1].click())
    const stage = host.querySelector('.pp-compare')
    expect(stage).not.toBeNull()
    expect(stage.getAttribute('dir')).toBe('ltr')
  })
})

describe('comparing more than two photos', () => {
  let root, host
  const mount = (...photos) => {
    openProgressCompare(...photos)
    const sheet = useUI.getState().sheets.at(-1)
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => root.render(sheet.render(() => {})))
  }
  afterEach(() => {
    act(() => root?.unmount())
    host?.remove()
    useUI.getState().closeAll()
  })

  it('puts three photos in one row, earliest first, each with its date and no layout choice', () => {
    mount(photo('2026-03-01', 3), photo('2026-01-01', 1), photo('2026-02-01', 2))
    expect(host.querySelector('.pp-compare')).toBeNull()
    expect(host.querySelectorAll('.pp-cell')).toHaveLength(3)
    expect(host.querySelector('.pp-grid').style.getPropertyValue('--cols')).toBe('3')
    expect(host.querySelectorAll('.pp-caption')).toHaveLength(3)
    expect(host.querySelector('.pp-modes')).toBeNull()
  })

  it('lets a pair switch between side by side (first) and the slider', () => {
    mount(photo('2026-01-01', 1), photo('2026-03-01', 2))
    const buttons = () => [...host.querySelectorAll('.pp-modes button')]
    expect(buttons()).toHaveLength(2)
    expect(host.querySelectorAll('.pp-cell')).toHaveLength(2)
    expect(host.querySelector('.pp-handle')).toBeNull()
    act(() => buttons()[1].click())
    expect(host.querySelector('.pp-handle')).not.toBeNull()
    expect(host.querySelector('.pp-grid')).toBeNull()
  })

  it('takes the photos as one array too, and keeps five at most', () => {
    mount([1, 2, 3, 4, 5, 6].map(i => photo('2026-0' + i + '-01', i)))
    expect(host.querySelectorAll('.pp-cell')).toHaveLength(5)
  })

  it('has a share button in the bar, for a pair and for more', () => {
    mount(photo('2026-01-01', 1), photo('2026-03-01', 2))
    expect(host.querySelector('.mviewer-bar button[aria-label="Share"]')).not.toBeNull()
    act(() => root.unmount())
    host.remove()
    mount(photo('2026-01-01', 1), photo('2026-02-01', 2), photo('2026-03-01', 3))
    expect(host.querySelector('.mviewer-bar button[aria-label="Share"]')).not.toBeNull()
  })
})
