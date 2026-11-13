// @vitest-environment happy-dom
// P3: number fields show and accept the language's decimal separator. One component carries every
// number field in the app (NumberField, and Stepper around it), so this runs the same checks over
// it in five languages instead of screen by screen.
import React, { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NumberField, Stepper, numWidthCh } from './ui.jsx'
import { setLang } from '../lib/i18n.js'
import { _setLangState } from '../lib/i18n-core.js'
import { fmtNum, fmtWeight } from '../lib/format.js'
import { convertExact, EXACT_VIEW } from '../lib/units.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let host, root, changes
beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  changes = []
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  _setLangState('en', null, null, null)
})

const setValue = (el, value) => Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set.call(el, value)
// One keystroke at a time, the way a keypad delivers it.
const typeKeys = (el, keys) => { for (const k of keys) act(() => { setValue(el, el.value + k); el.dispatchEvent(new Event('input', { bubbles: true })) }) }
const clear = el => act(() => { setValue(el, ''); el.dispatchEvent(new Event('input', { bubbles: true })) })
const paste = (el, text) => act(() => {
  el.dispatchEvent(new Event('paste', { bubbles: true, cancelable: true }))
  setValue(el, text)
  el.dispatchEvent(new Event('input', { bubbles: true }))
})
const blur = el => act(() => el.dispatchEvent(new FocusEvent('focusout', { bubbles: true })))

function Field({ start = 72.5, ...props }) {
  const [v, setV] = useState(start)
  return <NumberField value={v} onChange={n => { changes.push(n); setV(n) }} aria-label="Weight (kg)" {...props} />
}
function Step({ start = 72.5, ...props }) {
  const [v, setV] = useState(start)
  return <Stepper value={v} step={2.5} onChange={n => { changes.push(n); setV(n) }} ariaLabel="Weight" {...props} />
}
const mount = el => { act(() => root.render(el)); return host.querySelector('input') }

const CASES = [['en', '.'], ['de', ','], ['ru', ','], ['fr', ','], ['ar', '.']]

describe.each(CASES)('number field in %s', (lang, sep) => {
  beforeEach(() => _setLangState(lang, {}, null, null))

  it('shows a stored number with the separator the text beside it uses', () => {
    const input = mount(<Field />)
    expect(input.value).toBe('72' + sep + '5')
    expect(input.value).toBe(fmtNum(72.5))
    expect(fmtWeight(72.5, 'kg')).toContain(input.value)
    // Showing a number changes nothing in the store.
    expect(changes).toEqual([])
  })

  it.each([',', '.'])('takes "%s" typed as the decimal key and stores the same number', key => {
    const input = mount(<Field />)
    clear(input)
    typeKeys(input, '82' + key + '5')
    expect(changes.at(-1)).toBe(82.5)
    expect(input.value).toBe('82' + sep + '5')
    blur(input)
    expect(input.value).toBe('82' + sep + '5')
    expect(changes.at(-1)).toBe(82.5)
  })

  it('keeps a half-typed number on screen ("33" then the separator)', () => {
    const input = mount(<Field />)
    clear(input)
    typeKeys(input, '33,')
    expect(input.value).toBe('33' + sep)
    expect(changes.at(-1)).toBe(33)
    typeKeys(input, '5')
    expect(changes.at(-1)).toBe(33.5)
  })

  it('reads a pasted "1.234,5" and "1,234.5" as 1234.5, never 1.2345 or 12345', () => {
    const input = mount(<Field />)
    for (const text of ['1.234,5', '1,234.5']) {
      clear(input)
      paste(input, text)
      expect(changes.at(-1)).toBe(1234.5)
      expect(input.value).toBe('1234' + sep + '5')
    }
  })

  // Dictation or autofill over a selected number: no paste event, and the field does not get
  // longer by more than a character, so only the text handed over in one piece gives it away.
  it('reads a number put in whole over a selection like a paste', () => {
    const input = mount(<Field start={1234.5} />)
    act(() => {
      const b = new Event('beforeinput', { bubbles: true, cancelable: true })
      Object.defineProperty(b, 'data', { value: '1,234.5' })
      input.dispatchEvent(b)
      setValue(input, '1,234.5')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(changes.at(-1)).toBe(1234.5)
  })

  it('keeps stepping with + and - and shows the result in the same notation', () => {
    const input = mount(<Step />)
    const [minus, plus] = host.querySelectorAll('button')
    act(() => plus.click())
    expect(changes.at(-1)).toBe(75)
    expect(input.value).toBe('75')
    act(() => minus.click()); act(() => minus.click())
    expect(changes.at(-1)).toBe(70)
    clear(input)
    typeKeys(input, '71,25')
    expect(changes.at(-1)).toBe(71.25)
    act(() => plus.click())
    expect(changes.at(-1)).toBe(73.75)
    expect(input.value).toBe('73' + sep + '75')
  })

  it('is a decimal keypad field that still carries its name', () => {
    const input = mount(<Field />)
    expect(input.type).toBe('text')
    expect(input.getAttribute('inputmode')).toBe('decimal')
    expect(input.getAttribute('aria-label')).toBe('Weight (kg)')
    const whole = mount(<Field decimal={false} start={8} />)
    expect(whole.getAttribute('inputmode')).toBe('numeric')
    const stepped = mount(<Step />)
    expect(stepped.getAttribute('aria-label')).toBe('Weight')
  })

  it('keeps a lb value exact through the kg round trip, whatever the separator', () => {
    function Lb() {
      const [kg, setKg] = useState(convertExact(45, 'lb', 'kg'))
      return <NumberField value={convertExact(kg, 'kg', 'lb', EXACT_VIEW)} step={2.5} onChange={n => { const k = convertExact(n, 'lb', 'kg'); changes.push(k); setKg(k) }} />
    }
    const input = mount(<Lb />)
    expect(input.value).toBe('45')
    clear(input)
    typeKeys(input, '47,5')
    expect(changes.at(-1)).toBe(convertExact(47.5, 'lb', 'kg'))
    expect(convertExact(changes.at(-1), 'kg', 'lb', EXACT_VIEW)).toBe(47.5)
    blur(input)
    expect(input.value).toBe('47' + sep + '5')
  })

  it('sizes a fitted field the same for a comma as for a point', () => {
    const input = mount(<Field fit />)
    expect(input.style.width).toBe('3.5ch')
  })
})

describe('number field across languages', () => {
  it('re-renders with the new separator when the language is switched', async () => {
    const input = mount(<Field />)
    expect(input.value).toBe('72.5')
    await act(async () => { await setLang('de') })
    expect(input.value).toBe('72,5')
    await act(async () => { await setLang('ru') })
    expect(input.value).toBe('72,5')
    await act(async () => { await setLang('ar') })
    expect(input.value).toBe('72.5')
    await act(async () => { await setLang('en') })
    expect(input.value).toBe('72.5')
    expect(changes).toEqual([])
  })

  it('takes Arabic and Persian keyboard digits in the Arabic and Persian app, shown as the app prints numbers', () => {
    for (const [lang, typed] of [['ar', '٧٢٫٥'], ['fa', '۷۲٫۵']]) {
      _setLangState(lang, {}, null, null)
      const input = mount(<Field key={lang} start={0} />)
      clear(input)
      typeKeys(input, typed)
      expect(changes.at(-1)).toBe(72.5)
      expect(input.value).toBe(fmtNum(72.5))
    }
  })

  it('in a whole-number field the part after either separator never counts', () => {
    _setLangState('de', {}, null, null)
    const input = mount(<Field decimal={false} start={10} />)
    clear(input)
    typeKeys(input, '8,5')
    expect(changes.at(-1)).toBe(8)
    expect(input.value).toBe('8,5')
    blur(input)
    expect(input.value).toBe('8')
  })

  it('a paste that changed nothing does not turn the next keystroke into a paste', () => {
    // German: "2500", an empty paste, then a point typed after the 2. Typed, so 2,5 and not 2500.
    _setLangState('de', {}, null, null)
    const input = mount(<Field start={2500} />)
    act(() => { input.dispatchEvent(new Event('paste', { bubbles: true, cancelable: true })) })
    act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: '.', bubbles: true })) })
    act(() => { setValue(input, '2.500'); input.dispatchEvent(new Event('input', { bubbles: true })) })
    expect(changes.at(-1)).toBe(2.5)
    expect(input.value).toBe('2,500')
  })

  it('numWidthCh counts a comma as the half character a point is', () => {
    expect(numWidthCh('82,5')).toBe(numWidthCh('82.5'))
  })
})
