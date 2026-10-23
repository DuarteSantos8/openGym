// @vitest-environment happy-dom
import React, { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ChatInput, { composerHeight, MIN_HEIGHT } from './ChatInput.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

/* The Coach's message box grows with the text up to 40% of the room above the keyboard, and opens
   into a tall editor and back. happy-dom lays nothing out, so scrollHeight is stubbed. */
describe('composerHeight', () => {
  it('as tall as the text, from one line up to 40% of the room', () => {
    expect(composerHeight({ scrollHeight: 20, visible: 800 })).toBe(MIN_HEIGHT)
    expect(composerHeight({ scrollHeight: 150, visible: 800 })).toBe(150)
    expect(composerHeight({ scrollHeight: 900, visible: 800 })).toBe(320)
  })
  it('follows the room the keyboard leaves', () => {
    expect(composerHeight({ scrollHeight: 900, visible: 400 })).toBe(160)
  })
  it('the tall editor takes 70% of the room, however short the text', () => {
    expect(composerHeight({ scrollHeight: 10, visible: 800, expanded: true })).toBe(560)
  })
  it('never below one line, whatever it is told', () => {
    expect(composerHeight({})).toBe(MIN_HEIGHT)
    expect(composerHeight({ scrollHeight: 300, visible: 50 })).toBe(MIN_HEIGHT)
  })
})

describe('ChatInput', () => {
  let host, root, scroll
  beforeEach(() => {
    scroll = 30
    vi.spyOn(HTMLTextAreaElement.prototype, 'scrollHeight', 'get').mockImplementation(() => scroll)
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
    host = document.createElement('div'); host.className = 'chat'
    document.body.appendChild(host)
    root = createRoot(host)
  })
  afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks() })

  function Harness({ onSend }) {
    const [v, setV] = useState('')
    const [x, setX] = useState(false)
    return <ChatInput value={v} onChange={setV} onSend={onSend} expanded={x} setExpanded={setX} />
  }
  const type = (el, value) => act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  const key = (el, k, shift = false) => act(() => { el.dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey: shift, bubbles: true, cancelable: true })) })

  it('grows with a long message, offers the tall editor, and Enter sends only from the small box', () => {
    const onSend = vi.fn()
    act(() => root.render(<Harness onSend={onSend} />))
    const ta = host.querySelector('textarea')
    expect(ta.style.height).toBe('44px')
    expect(host.querySelector('.composer-grow')).toBeNull()
    scroll = 200
    type(ta, 'a long message\n'.repeat(8))
    expect(ta.style.height).toBe('200px')
    expect(host.style.getPropertyValue('--composer-extra')).toBe('156px')
    const grow = host.querySelector('.composer-grow')
    expect(grow.getAttribute('aria-label')).toBe('Make the box bigger')
    act(() => grow.click())
    expect(ta.style.height).toBe('560px')
    key(ta, 'Enter')
    expect(onSend).not.toHaveBeenCalled()
    act(() => host.querySelector('.composer-grow').click())
    expect(ta.style.height).toBe('200px')
    key(ta, 'Enter', true)
    expect(onSend).not.toHaveBeenCalled()
    key(ta, 'Enter')
    expect(onSend).toHaveBeenCalledTimes(1)
  })
})
