// @vitest-environment happy-dom
// Android 15 draws the app edge to edge, and then adjustResize no longer shrinks the window for the
// soft keyboard: innerHeight and visualViewport stayed at 915 with the keys up, and the Connect to
// my server address, code and Connect button, and the body-weight field, sat under the keyboard
// (Android QA, v1.3.9). MainActivity passes the covered height as --native-kb; these check the page
// side: the sheets lift by it, the focused field is scrolled above it, and with no variable (older
// Android, iOS, a browser) nothing changes.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { nativeKeyboardHeight, visibleBottom, revealAboveKeyboard, startNativeKeyboard, NATIVE_KEYBOARD_EVENT } from './native-keyboard.js'
import { sheetKeyboardInsets } from './use-sheet-keyboard.js'

const read = rel => readFileSync(new URL(rel, import.meta.url), 'utf8')
const root = () => document.documentElement

function setKeyboard(px) {
  // what MainActivity.keyboardScript runs
  root().style.setProperty('--native-kb', `${px}px`)
  if (px > 0) root().setAttribute('data-native-kb', '')
  else root().removeAttribute('data-native-kb')
  window.dispatchEvent(new CustomEvent(NATIVE_KEYBOARD_EVENT, { detail: { height: px } }))
}

const rect = (top, height) => ({ top, bottom: top + height, height, left: 0, right: 400, width: 400, x: 0, y: top })

let viewport
beforeEach(() => {
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 915 })
  viewport = { height: 915, offsetTop: 0, addEventListener() {}, removeEventListener() {} }
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport })
})
afterEach(() => {
  root().style.removeProperty('--native-kb')
  root().removeAttribute('data-native-kb')
  document.body.innerHTML = ''
})

describe('the keyboard height the app passes', () => {
  it('reads 0 with no variable, and the passed height with one', () => {
    expect(nativeKeyboardHeight()).toBe(0)
    setKeyboard(336.5)
    expect(nativeKeyboardHeight()).toBe(336.5)
    setKeyboard(0)
    expect(nativeKeyboardHeight()).toBe(0)
  })

  it('the visible bottom is the smaller of the visual viewport and the layout viewport less the keyboard', () => {
    expect(visibleBottom()).toBe(915)
    setKeyboard(336)          // Android 15: the viewport does not move, the variable does
    expect(visibleBottom()).toBe(579)
    setKeyboard(0)
    viewport.height = 600     // older Android / iOS: the viewport shrinks, no variable
    expect(visibleBottom()).toBe(600)
  })

  it('sheets lift by the larger of the visual-viewport inset and the native one', () => {
    expect(sheetKeyboardInsets(window)).toEqual({ bottomInset: 0, visualHeight: 915 })
    setKeyboard(336)
    expect(sheetKeyboardInsets(window)).toEqual({ bottomInset: 336, visualHeight: 579 })
    setKeyboard(0)
    viewport.height = 600
    expect(sheetKeyboardInsets(window)).toEqual({ bottomInset: 315, visualHeight: 600 })
  })
})

describe('keeping the focused field above the keyboard', () => {
  function sheetWithField(fieldTop, sheetTop = 300, sheetHeight = 615) {
    const sheet = document.createElement('div')
    sheet.className = 'sheet'
    const input = document.createElement('input')
    sheet.appendChild(input)
    document.body.appendChild(sheet)
    let scrollTop = 0
    Object.defineProperty(sheet, 'scrollTop', { configurable: true, get: () => scrollTop, set: v => { scrollTop = v } })
    sheet.getBoundingClientRect = () => rect(sheetTop, sheetHeight)
    input.getBoundingClientRect = () => rect(fieldTop - scrollTop, 44)
    return { sheet, input }
  }

  it('scrolls the sheet, not the page, until the field clears the keys', () => {
    setKeyboard(336)
    const { sheet, input } = sheetWithField(800, 200, 379)   // sheet already lifted onto the keys: 200..579
    const moved = revealAboveKeyboard(input)
    expect(moved).toBe(800 + 44 - (579 - 16))
    expect(sheet.scrollTop).toBe(moved)
    expect(input.getBoundingClientRect().bottom).toBeLessThanOrEqual(579 - 16)
  })

  it('leaves a field that is already clear alone', () => {
    setKeyboard(336)
    const { sheet, input } = sheetWithField(260, 200, 379)
    expect(revealAboveKeyboard(input)).toBe(0)
    expect(sheet.scrollTop).toBe(0)
  })

  it('does it on focus and when the keyboard comes up, only while the app passes a height', async () => {
    const stop = startNativeKeyboard()
    try {
      const { sheet, input } = sheetWithField(700, 200, 379)
      input.focus()
      await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)))
      expect(sheet.scrollTop).toBe(0)           // no keyboard variable: the system handles it
      setKeyboard(336)
      await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)))
      expect(sheet.scrollTop).toBe(700 + 44 - (579 - 16))
    } finally {
      stop()
    }
  })
})

describe('the two halves agree', () => {
  const css = read('../index.css')
  const activity = read('../../android/app/src/main/java/ch/duartesantos/opengym/MainActivity.java')

  it('the app passes the IME inset as --native-kb and fires the event', () => {
    expect(activity).toMatch(/WindowInsetsCompat\.Type\.ime\(\)/)
    expect(activity).toContain("'--native-kb'")
    expect(activity).toContain("data-native-kb")
    expect(activity).toContain(NATIVE_KEYBOARD_EVENT)
    // still only from Android 15 on: older versions resize the window themselves
    expect(activity).toMatch(/Build\.VERSION\.SDK_INT < 35/)
  })

  it('every sheet stands on the keyboard and the picker takes the larger lift', () => {
    expect(css).toMatch(/:root\[data-native-kb\] \.sheet\{\s*bottom:max\(var\(--picker-keyboard-bottom,0px\),var\(--native-kb,0px\)\);/)
    expect(css).toMatch(/\.sheet:has\(\.picker-search\)\{\s*bottom:max\(var\(--picker-keyboard-bottom,0px\),var\(--native-kb,0px\)\);/)
    expect(css).toMatch(/max-height:min\(90vh,calc\(100dvh - var\(--sat\) - 8px - var\(--native-kb,0px\)\)\)/)
  })

  it('the tab bar is left under the keyboard', () => {
    const tabbar = css.match(/#tabbar\{[^}]*\}/)[0]
    expect(tabbar).not.toMatch(/native-kb/)
    expect(css).not.toMatch(/data-native-kb\][^{]*#tabbar/)
  })
})
