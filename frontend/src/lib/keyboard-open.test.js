// @vitest-environment happy-dom
// With the on-screen keyboard up, the bar and the live dock hide (body.kb-open, tab-shell.css).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installKeyboardClass, opensKeyboard } from './keyboard-open.js'

const field = (tag, type) => {
  const el = document.createElement(tag)
  if (type) el.setAttribute('type', type)
  document.body.appendChild(el)
  return el
}

let stop = () => {}
afterEach(() => { stop(); document.body.innerHTML = '' })

describe('which fields bring the keyboard up', () => {
  it('text-like inputs and text areas do; switches and buttons do not', () => {
    expect(opensKeyboard(field('input'))).toBe(true)
    expect(opensKeyboard(field('input', 'number'))).toBe(true)
    expect(opensKeyboard(field('textarea'))).toBe(true)
    expect(opensKeyboard(field('input', 'checkbox'))).toBe(false)
    expect(opensKeyboard(field('input', 'range'))).toBe(false)
    expect(opensKeyboard(field('button'))).toBe(false)
    const ro = field('input'); ro.readOnly = true
    expect(opensKeyboard(ro)).toBe(false)
  })
})

describe('the body class', () => {
  it('follows focus on a touch screen', async () => {
    window.matchMedia = vi.fn(() => ({ matches: true }))
    stop = installKeyboardClass(window)
    const input = field('input')
    input.focus()
    expect(document.body.classList.contains('kb-open')).toBe(true)
    input.blur()
    await new Promise(r => setTimeout(r, 0))
    expect(document.body.classList.contains('kb-open')).toBe(false)
  })

  it('stays off with a mouse and a desktop keyboard', () => {
    window.matchMedia = vi.fn(() => ({ matches: false }))
    stop = installKeyboardClass(window)
    field('input').focus()
    expect(document.body.classList.contains('kb-open')).toBe(false)
  })
})
