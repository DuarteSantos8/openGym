// Settings → Look & Home → Motion and Text size (lib/display-prefs.js).
import { afterEach, describe, expect, it } from 'vitest'
import { readDisplay, applyDisplay, _resetDisplay } from './display-prefs.js'

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
    applyDisplay({ motion: 'system', text: 'default' }, { win })
    expect(win.matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(false)
    expect(document.documentElement.classList.contains('reduce-motion')).toBe(false)
    expect(document.documentElement.style.fontSize).toBe('')
  })

  it('ignores what it does not know', () => {
    localStorage.setItem('gym_display', JSON.stringify({ motion: 'wild', text: 'huge' }))
    expect(readDisplay()).toEqual({ motion: 'system', text: 'default' })
  })
})
