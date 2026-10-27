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

  it('does nothing for no link', () => {
    expect(runWidgetLink(null, deps())).toBe(false)
  })
})
