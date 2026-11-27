// @vitest-environment happy-dom
// Settings → Look & Home → Motion and Text size (lib/display-prefs.js).
import { afterEach, describe, expect, it } from 'vitest'
import { readDisplay, applyDisplay, _resetDisplay, systemTextScale, textScaleFor, followsSystemText, TEXT_SIZES } from './display-prefs.js'

afterEach(() => { applyDisplay({ motion: 'system', text: 'default' }, { save: true }); localStorage.clear() })

describe('display prefs', () => {
  it('starts like the phone at the default size', () => {
    localStorage.clear()
    expect(readDisplay()).toEqual({ motion: 'system', text: 'default' })
  })

  it('less motion makes the whole app hear "reduce motion"', () => {
    _resetDisplay()
    const real = { matches: false, addEventListener () {} }
    const win = { matchMedia: () => real, document }
    applyDisplay({ motion: 'less', text: 'large' }, { save: true, win })
    expect(win.matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(true)
    expect(typeof win.matchMedia('(prefers-reduced-motion: reduce)').addEventListener).toBe('function')
    expect(win.matchMedia('(min-width: 600px)').matches).toBe(false)
    expect(document.documentElement.classList.contains('reduce-motion')).toBe(true)
    expect(document.documentElement.style.fontSize).toBe('112%')
    expect(readDisplay()).toEqual({ motion: 'less', text: 'large' })
    expect(document.documentElement.classList.contains('text-big')).toBe(false)
    // Larger and up: a row's value wraps instead of being cut ("Lineare P…", #1105 polish).
    applyDisplay({ motion: 'less', text: 'larger' }, { win })
    expect(document.documentElement.classList.contains('text-big')).toBe(true)
    applyDisplay({ motion: 'system', text: 'default' }, { win })
    expect(win.matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(false)
    expect(document.documentElement.classList.contains('reduce-motion')).toBe(false)
    expect(document.documentElement.style.fontSize).toBe('')
    expect(document.documentElement.classList.contains('text-big')).toBe(false)
  })

  it('ignores what it does not know', () => {
    localStorage.setItem('gym_display', JSON.stringify({ motion: 'wild', text: 'huge' }))
    expect(readDisplay()).toEqual({ motion: 'system', text: 'default' })
  })

  it('has six sizes, Smallest to Largest, in order', () => {
    const k = Object.values(TEXT_SIZES)
    expect(Object.keys(TEXT_SIZES)).toEqual(['smallest', 'small', 'default', 'large', 'larger', 'largest'])
    expect([...k].sort((a, b) => a - b)).toEqual(k)
    expect(TEXT_SIZES.smallest).toBeCloseTo(0.82)
    expect(TEXT_SIZES.largest).toBeCloseTo(1.4)
    localStorage.setItem('gym_display', JSON.stringify({ motion: 'system', text: 'largest' }))
    expect(readDisplay().text).toBe('largest')
  })

  it('Default follows the phone: Android asks the bridge, iOS reads Dynamic Type', () => {
    expect(systemTextScale({})).toBe(1)
    expect(followsSystemText({})).toBe(false)
    expect(systemTextScale({ OpenGymText: { scale: () => 1.15 } })).toBe(1.15)
    expect(followsSystemText({ OpenGymText: { scale: () => 1 } })).toBe(true)
    expect(systemTextScale({ __ogTextScale: 0.88 })).toBe(0.88)
    // Clamped to the span the layouts are checked at.
    expect(systemTextScale({ OpenGymText: { scale: () => 2 } })).toBe(1.4)
    expect(systemTextScale({ __ogTextScale: 0.5 })).toBe(0.82)
    // Rubbish from a bridge is the default size, never NaN.
    expect(systemTextScale({ OpenGymText: { scale: () => 'x' } })).toBe(1)
    expect(systemTextScale({ OpenGymText: { scale: () => { throw new Error('gone') } } })).toBe(1)
  })

  it('a pick of its own replaces the phone size, it does not stack on it', () => {
    const win = { OpenGymText: { scale: () => 1.3 } }
    expect(textScaleFor('default', win)).toBe(1.3)
    expect(textScaleFor('larger', win)).toBe(1.25)
    expect(textScaleFor('smallest', win)).toBe(0.82)
    expect(textScaleFor('nonsense', win)).toBe(1.3)
  })

  it('applies the phone size to the root and follows a change', () => {
    _resetDisplay()
    let k = 1.2
    const listeners = {}
    const win = { document, OpenGymText: { scale: () => k }, addEventListener: (n, f) => { listeners[n] = f } }
    applyDisplay({ motion: 'system', text: 'default' }, { save: true, win })
    expect(document.documentElement.style.fontSize).toBe('120%')
    expect(document.documentElement.style.getPropertyValue('--text-k')).toBe('1.2')
    k = 0.9
    listeners['opengym:text-scale']()
    expect(document.documentElement.style.fontSize).toBe('90%')
    // A pick of its own is not moved by the phone.
    applyDisplay({ motion: 'system', text: 'largest' }, { save: true, win })
    k = 1.1
    listeners['opengym:text-scale']()
    expect(document.documentElement.style.fontSize).toBe('140%')
    _resetDisplay()
  })
})
