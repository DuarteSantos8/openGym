import { describe, expect, it } from 'vitest'
import { DEFAULT_WIDGETS, MAX_WIDGETS, moveWidget, toggleWidget, visibleWidgets, widgetChoices, widgetsOf } from './widgets.js'
import { makeRecord } from './records.js'

const T = new Date('2026-10-12T08:00:00').getTime()

describe('health widgets on Home', () => {
  it('a profile that never chose gets the default set; an empty choice is none', () => {
    expect(widgetsOf({})).toEqual(DEFAULT_WIDGETS)
    expect(widgetsOf({ homeWidgets: [] })).toEqual([])
  })
  it('keeps known metrics only, each once, at most six', () => {
    expect(widgetsOf({ homeWidgets: ['steps', 'nope', 'steps', 'weight'] })).toEqual(['steps', 'weight'])
    expect(widgetsOf({ homeWidgets: ['weight', 'bmi', 'bodyFat', 'leanMass', 'steps', 'sleep', 'heartRate'] })).toHaveLength(MAX_WIDGETS)
  })
  it('shows only the chosen metrics that have a reading', () => {
    const S = { unit: 'kg', bodyweight: [{ d: '2026-10-12', w: 80 }], health: [makeRecord({ type: 'steps', v: 5000, t: T })], homeWidgets: ['weight', 'sleep', 'steps'] }
    expect(visibleWidgets(S)).toEqual(['weight', 'steps'])
    expect(visibleWidgets({ unit: 'kg', bodyweight: [], health: [] })).toEqual([])
  })
  it('switches a widget on and off, never past six', () => {
    expect(toggleWidget(['a'], 'b')).toEqual(['a', 'b'])
    expect(toggleWidget(['a', 'b'], 'a')).toEqual(['b'])
    const six = ['a', 'b', 'c', 'd', 'e', 'f']
    expect(toggleWidget(six, 'g')).toBe(six)
  })
  it('moves a widget up and down within the list', () => {
    expect(moveWidget(['a', 'b', 'c'], 'c', -1)).toEqual(['a', 'c', 'b'])
    expect(moveWidget(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c'])
    expect(moveWidget(['a', 'b', 'c'], 'a', 1)).toEqual(['b', 'a', 'c'])
  })
})

describe('the chooser', () => {
  it('offers the main readings, and any other kind once the profile has one', () => {
    const none = widgetChoices({ health: [] })
    expect(none).toContain('steps')
    expect(none).not.toContain('spo2')
    expect(widgetChoices({ health: [{ type: 'spo2' }] })).toContain('spo2')
  })
})
