// @vitest-environment happy-dom
// Settings → Look & Home → Motion and Text size (lib/display-prefs.js).
import { afterEach, describe, expect, it } from 'vitest'
import { readDisplay, applyDisplay, _resetDisplay, systemTextScale, textScaleFor, followsSystemText, TEXT_SIZES } from './display-prefs.js'

afterEach(() => { applyDisplay({ motion: 'system', text: 'default' }, { save: true }); localStorage.clear() })

describe('display prefs', () => {
  it('starts like the phone at the default size', () => {
    localStorage.clear()
    expect(readDisplay()).toEqual({ motion: 'system', text: 'default', glass: true })
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
    expect(readDisplay()).toEqual({ motion: 'less', text: 'large', glass: true })
    applyDisplay({ motion: 'system', text: 'default' }, { win })
    expect(win.matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(false)
    expect(document.documentElement.classList.contains('reduce-motion')).toBe(false)
    expect(document.documentElement.style.fontSize).toBe('')
  })

  // Liquid Glass G9: off, the page carries the attribute the glass fallbacks in index.css answer.
  it('glass off makes every bar and sheet solid, and is remembered', () => {
    applyDisplay({ motion: 'system', text: 'default', glass: false }, { save: true })
    expect(document.documentElement.hasAttribute('data-reduce-transparency')).toBe(true)
    expect(readDisplay().glass).toBe(false)
    applyDisplay({ ...readDisplay(), glass: true }, { save: true })
    expect(document.documentElement.hasAttribute('data-reduce-transparency')).toBe(false)
    expect(readDisplay().glass).toBe(true)
  })

  it('tells the page after every change, so what measures the root size measures again', () => {
    const seen = []
    const on = () => seen.push(1)
    window.addEventListener('opengym:display', on)
    applyDisplay({ motion: 'system', text: 'larger' }, { save: true })
    window.removeEventListener('opengym:display', on)
    expect(seen.length).toBe(1)
  })

  it('ignores what it does not know', () => {
    localStorage.setItem('gym_display', JSON.stringify({ motion: 'wild', text: 'huge' }))
    expect(readDisplay()).toEqual({ motion: 'system', text: 'default', glass: true })
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
