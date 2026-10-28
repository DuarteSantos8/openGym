import { describe, expect, it, vi } from 'vitest'
import { parseWidgetLink, runWidgetLink } from './widget-links.js'

// What a tap on a widget opens (the links are built in ios/App/App/WidgetViews.swift and
// android/.../OpenGymWidgetProvider.java: keep the three in step).
describe('parseWidgetLink', () => {
  it('reads the four links', () => {
    expect(parseWidgetLink('opengym://home')).toEqual({ to: '/' })
    expect(parseWidgetLink('opengym://stats')).toEqual({ to: '/stats' })
    expect(parseWidgetLink('opengym://stats/')).toEqual({ to: '/stats' })
    expect(parseWidgetLink('opengym://weigh-in')).toEqual({ action: 'weigh-in' })
    expect(parseWidgetLink('opengym://start?r=r1,r2')).toEqual({ action: 'start', ids: ['r1', 'r2'] })
    expect(parseWidgetLink('opengym://start')).toEqual({ action: 'start', ids: [] })
  })

  it('ignores anything else', () => {
    for (const u of [null, 42, '', 'https://opengym.ch/stats', 'opengym://settings', 'opengym://stats/../admin', 'javascript:alert(1)']) {
      expect(parseWidgetLink(u), String(u)).toBeNull()
    }
  })

  it('reads what Siri and Assistant send (lib/voice.js)', () => {
    expect(parseWidgetLink('opengym://start?today=1')).toEqual({ action: 'start', ids: [], today: true })
    // Routines named win over "today": the link is a widget's then.
    expect(parseWidgetLink('opengym://start?today=1&r=r1')).toEqual({ action: 'start', ids: ['r1'] })
    expect(parseWidgetLink('opengym://weigh-in?w=78.2')).toEqual({ action: 'weigh-in', w: 78.2, unit: null })
    expect(parseWidgetLink('opengym://weigh-in?w=78%2C2&u=kg')).toEqual({ action: 'weigh-in', w: 78.2, unit: 'kg' })
    expect(parseWidgetLink('opengym://weigh-in?w=170%20lbs')).toEqual({ action: 'weigh-in', w: 170, unit: 'lb' })
    expect(parseWidgetLink('opengym://weigh-in?w=170&u=lbs')).toEqual({ action: 'weigh-in', w: 170, unit: 'lb' })
    // Not a number: the sheet as a tap opens it.
    expect(parseWidgetLink('opengym://weigh-in?w=lots')).toEqual({ action: 'weigh-in' })
    expect(parseWidgetLink('opengym://weigh-in?w=')).toEqual({ action: 'weigh-in' })
  })

  it('takes at most 8 routines', () => {
    const ids = Array.from({ length: 20 }, (_, i) => 'r' + i).join(',')
    expect(parseWidgetLink('opengym://start?r=' + ids).ids).toHaveLength(8)
  })
})

describe('runWidgetLink', () => {
  const deps = (S = {}) => ({ getS: () => S, nav: vi.fn(), navToWorkout: vi.fn(), startFlow: vi.fn(), bwSheet: vi.fn() })
  const routines = [{ id: 'r1' }, { id: 'r2' }]

  it('opens a screen', () => {
    const d = deps()
    expect(runWidgetLink({ to: '/stats' }, d)).toBe(true)
    expect(d.nav).toHaveBeenCalledWith('/stats')
  })

  it('opens the weigh-in on Home', () => {
    const d = deps()
    runWidgetLink({ action: 'weigh-in' }, d)
    expect(d.nav).toHaveBeenCalledWith('/')
    expect(d.bwSheet).toHaveBeenCalled()
  })

  it('starts only routines the profile has, through the usual start flow', () => {
    const d = deps({ routines })
    runWidgetLink({ action: 'start', ids: ['r2', 'gone'] }, d)
    expect(d.startFlow).toHaveBeenCalledWith(['r2'])
    const none = deps({ routines })
    runWidgetLink({ action: 'start', ids: ['gone'] }, none)
    expect(none.startFlow).not.toHaveBeenCalled()
    expect(none.nav).toHaveBeenCalledWith('/')
  })

  it('goes back to a workout already running instead of starting another', () => {
    const d = deps({ routines, active: { id: 'a1' } })
    runWidgetLink({ action: 'start', ids: ['r1'] }, d)
    expect(d.navToWorkout).toHaveBeenCalled()
    expect(d.startFlow).not.toHaveBeenCalled()
  })

  it('fills the weigh-in sheet in with an assistant’s number, in the profile’s unit', () => {
    const d = deps({ unit: 'kg' })
    runWidgetLink({ action: 'weigh-in', w: 78.2, unit: null }, d)
    expect(d.bwSheet).toHaveBeenCalledWith({ initial: 78.2 })
    const lb = deps({ unit: 'lb' })
    runWidgetLink({ action: 'weigh-in', w: 80, unit: 'kg' }, lb)
    expect(lb.bwSheet).toHaveBeenCalledWith({ initial: 176.4 })
    // "two" heard as 2: the sheet opens with the last weigh-in, as a tap would.
    const odd = deps({ unit: 'kg' })
    runWidgetLink({ action: 'weigh-in', w: 2, unit: null }, odd)
    expect(odd.bwSheet).toHaveBeenCalledWith(undefined)
  })

  it('starts today’s plan for Siri, Assistant and the long-press shortcut', () => {
    const d = { ...deps({ routines }), todayIds: vi.fn(() => ['r2', 'gone']) }
    runWidgetLink({ action: 'start', ids: [], today: true }, d)
    expect(d.todayIds).toHaveBeenCalled()
    expect(d.startFlow).toHaveBeenCalledWith(['r2'])
    // A rest day: Home, nothing started.
    const rest = { ...deps({ routines }), todayIds: () => [] }
    runWidgetLink({ action: 'start', ids: [], today: true }, rest)
    expect(rest.startFlow).not.toHaveBeenCalled()
    expect(rest.nav).toHaveBeenCalledWith('/')
  })

  it('never starts a second workout, whoever asks', () => {
    for (const target of [{ action: 'start', ids: [], today: true }, { action: 'start', ids: ['r1'] }]) {
      const d = { ...deps({ routines, active: { id: 'a1' } }), todayIds: vi.fn(() => ['r1']) }
      runWidgetLink(target, d)
      expect(d.navToWorkout).toHaveBeenCalledTimes(1)
      expect(d.startFlow).not.toHaveBeenCalled()
    }
  })

  it('does nothing for no link', () => {
    expect(runWidgetLink(null, deps())).toBe(false)
  })
})
