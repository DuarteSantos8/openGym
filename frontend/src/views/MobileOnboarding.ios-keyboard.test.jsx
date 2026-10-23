// @vitest-environment happy-dom
// TestFlight build 26, iPhone: on "Connect to my server", tapping the pairing-code field shifted
// the screen so the field ended up above the visible area; tapping out and in again fixed it.
// The sheet sat at the bottom under the keyboard, so WebKit scrolled the pinned page to reach
// the field, and the first focus landed 250 ms into the sheet's 340 ms slide-up, measured on a
// moving sheet. Now the sheet stands on the keyboard (index.css .kb-lift), scrolls the focused
// field above the keys itself, and the autofocus waits for the sheet to land.
import React, { act } from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useUI } from '../store/useUI.js'
import { _setLangState } from '../lib/i18n-core.js'
import { ConnectSheet, CfAccessSheet, SHEET_SETTLE_MS } from './MobileOnboarding.jsx'

let root, host, sheet, savedVV
const rect = (top, bottom) => () => ({ top, bottom, left: 0, right: 300, width: 300, height: bottom - top })

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  _setLangState('en', null, null, null)
  useUI.setState({ sheets: [], toastMsg: '' })
  // An 800 px screen with a 340 px keyboard up: the visual viewport is what is left.
  savedVV = Object.getOwnPropertyDescriptor(window, 'visualViewport')
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: Object.assign(new EventTarget(), { height: 460, offsetTop: 0, pageTop: 0 }) })
  host = document.createElement('div')
  sheet = document.createElement('div')
  sheet.className = 'sheet'
  host.appendChild(sheet)
  document.body.appendChild(host)
  root = createRoot(sheet)
})
afterEach(() => {
  act(() => root.unmount()); host.remove()
  if (savedVV) Object.defineProperty(window, 'visualViewport', savedVV)
  else delete window.visualViewport
  vi.useRealTimers()
})

describe('the connect sheet and the iOS keyboard', () => {
  it('does not focus a field before the sheet has finished sliding up', () => {
    vi.useFakeTimers()
    act(() => root.render(<ConnectSheet close={() => {}} />))
    const [url] = sheet.querySelectorAll('input')
    act(() => { vi.advanceTimersByTime(250) })
    expect(document.activeElement).not.toBe(url)
    expect(SHEET_SETTLE_MS).toBeGreaterThan(340)   // index.css @keyframes sheetup is .34s
    act(() => { vi.advanceTimersByTime(SHEET_SETTLE_MS) })
    expect(document.activeElement).toBe(url)
  })

  it('pairing again focuses the code field, also only once the sheet has landed', () => {
    vi.useFakeTimers()
    act(() => root.render(<ConnectSheet close={() => {}} initialUrl="https://gym.example.com" again />))
    act(() => { vi.advanceTimersByTime(SHEET_SETTLE_MS) })
    expect(document.activeElement).toBe(sheet.querySelectorAll('input')[1])
  })

  it('stands on the keyboard and scrolls the code field above it, without scrolling the page', async () => {
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    act(() => root.render(<ConnectSheet close={() => {}} />))
    expect(sheet.querySelector('.kb-lift')).not.toBeNull()
    const code = sheet.querySelectorAll('input')[1]
    // The sheet's top at 300, the code field at 520-564: under the keyboard, which starts at 460.
    sheet.getBoundingClientRect = rect(300, 800)
    code.getBoundingClientRect = rect(520, 564)
    await act(async () => {
      code.focus()
      code.dispatchEvent(new FocusEvent('focus'))
      await new Promise(r => setTimeout(r, 40))
    })
    expect(sheet.style.getPropertyValue('--picker-keyboard-bottom')).toBe('340px')
    expect(sheet.style.getPropertyValue('--picker-visual-height')).toBe('460px')
    // 564 + 16 margin past the 460 px line: the sheet itself scrolls by the difference.
    expect(sheet.scrollTop).toBe(120)
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('the Cloudflare Access sheet, three fields, does the same', () => {
    act(() => root.render(<CfAccessSheet close={() => {}} />))
    expect(sheet.querySelector('.kb-lift')).not.toBeNull()
  })

  it('index.css lifts a .kb-lift sheet the way it lifts the picker', () => {
    const css = readFileSync(resolve(__dirname, '../index.css'), 'utf8')
    expect(css).toMatch(/\.sheet:has\(\.picker-search\),\.sheet:has\(\.kb-lift\)\{\s*bottom:max\(var\(--picker-keyboard-bottom,0px\),var\(--native-kb,0px\)\);/)
  })
})
