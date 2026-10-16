// @vitest-environment node
/* The splash's rules, as data in and verdict out: how long it may keep a ready app waiting, when it
 * does not play at all, and when it is dropped mid-way. (BootSplash.test.jsx runs them on the page.) */
import { describe, expect, it } from 'vitest'
import { SPLASH_END } from './brand-splash.js'
import { MIN_SHOW_MS, isDeepLaunch, mayPlay, splashAction } from './splash-rules.js'

const cold = { started: false, canDraw: true, reducedMotion: false, ready: false, location: { hash: '', search: '' } }

describe('the minimum', () => {
  it('is about 1.2 s, after the letters have settled, and not a tail on top of the animation', () => {
    expect(MIN_SHOW_MS).toBe(1200)
    expect(MIN_SHOW_MS / 1000).toBeGreaterThan(SPLASH_END)
    expect(MIN_SHOW_MS / 1000 - SPLASH_END).toBeLessThan(0.3)
  })
})

describe('isDeepLaunch', () => {
  it('is false for a plain start: nothing, "#", "#/" and "?"', () => {
    for (const location of [undefined, {}, { hash: '', search: '' }, { hash: '#' }, { hash: '#/' }, { search: '?' }]) {
      expect(isDeepLaunch(location), JSON.stringify(location)).toBe(false)
    }
  })

  it('is true for a route in the hash, whatever it is', () => {
    for (const hash of ['#/train', '#/me/admin', '#/progress/body/photos?focus=x', '#train']) expect(isDeepLaunch({ hash }), hash).toBe(true)
  })

  it('is true for a query (a pairing link)', () => {
    expect(isDeepLaunch({ hash: '', search: '?link=ABC' })).toBe(true)
  })
})

describe('mayPlay', () => {
  it('plays on a plain cold start', () => {
    expect(mayPlay(cold)).toBe(true)
    expect(mayPlay({ ...cold, location: { hash: '#/', search: '' } })).toBe(true)
  })

  it('does not play twice in a page load, without a canvas, for reduced motion, for a ready app or a deep link', () => {
    expect(mayPlay({ ...cold, started: true })).toBe(false)
    expect(mayPlay({ ...cold, canDraw: false })).toBe(false)
    expect(mayPlay({ ...cold, reducedMotion: true })).toBe(false)
    expect(mayPlay({ ...cold, ready: true })).toBe(false)
    expect(mayPlay({ ...cold, location: { hash: '#/train', search: '' } })).toBe(false)
  })
})

describe('splashAction', () => {
  it('waits for the app', () => {
    expect(splashAction({ ready: false, held: true, drawing: true })).toBe('wait')
    expect(splashAction({ ready: false, held: false, drawing: false })).toBe('wait')
  })

  it('leaves when the app is ready and the minimum has passed (or a tap ended it)', () => {
    expect(splashAction({ ready: true, held: true, drawing: true })).toBe('leave')
  })

  it('holds a ready app only until the minimum', () => {
    expect(splashAction({ ready: true, held: false, drawing: true })).toBe('wait')
  })

  it('is dropped, not waited for, when the app is ready and the letters have not loaded', () => {
    expect(splashAction({ ready: true, held: false, drawing: false })).toBe('skip')
    expect(splashAction({ ready: true, held: true, drawing: false })).toBe('skip')
  })
})
