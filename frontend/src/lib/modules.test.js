import { describe, expect, it } from 'vitest'
import { MODULES, MODULE_IDS, GROUPS, PRESETS, isOn, moduleStates, presetModules, presetOf, applyPreset, setModule, turnedOff, onCount } from './modules.js'

describe('modules', () => {
  it('every module belongs to a group, with an icon and copy', () => {
    const groups = new Set(GROUPS.map(g => g.id))
    for (const m of MODULES) {
      expect(groups.has(m.group)).toBe(true)
      expect(m.icon && m.title && m.desc).toBeTruthy()
      expect(m.desc).not.toMatch(/—/)
    }
    expect(new Set(MODULE_IDS).size).toBe(MODULE_IDS.length)
  })

  it('a profile from before Modules has every module on', () => {
    for (const id of MODULE_IDS) expect(isOn({}, id)).toBe(true)
    expect(isOn(null, 'body')).toBe(true)
    expect(isOn({ modules: 'junk' }, 'body')).toBe(true)
    expect(presetOf({})).toBe('all')
    expect(onCount({})).toBe(MODULE_IDS.length)
  })

  it('reads an explicit choice, and an unknown id is on', () => {
    expect(isOn({ modules: { body: false } }, 'body')).toBe(false)
    expect(isOn({ modules: { body: true } }, 'body')).toBe(true)
    expect(isOn({ modules: { body: false } }, 'later-module')).toBe(true)
  })

  it('the old check-in switch decides until Modules does', () => {
    expect(isOn({ checkIn: false }, 'checkin')).toBe(false)
    expect(isOn({ checkIn: true }, 'checkin')).toBe(true)
    expect(isOn({ checkIn: false, modules: { checkin: true } }, 'checkin')).toBe(true)
    expect(isOn({ checkIn: true, modules: { checkin: false } }, 'checkin')).toBe(false)
  })

  it('presets are nested, smallest first, and every one round-trips', () => {
    let prev = new Set()
    for (const p of PRESETS) {
      const on = new Set(p.on)
      for (const id of prev) expect(on.has(id)).toBe(true)
      prev = on
      const s = {}
      applyPreset(s, p.id)
      expect(presetOf(s)).toBe(p.id)
      expect(Object.keys(s.modules).sort()).toEqual([...MODULE_IDS].sort())
    }
    expect(presetModules('nope')).toBe(null)
  })

  it('Just training keeps the training tools and drops the rest', () => {
    const s = {}
    applyPreset(s, 'training')
    expect(isOn(s, 'effort')).toBe(true)
    expect(isOn(s, 'plates')).toBe(true)
    for (const id of ['body', 'health', 'motivation', 'coach', 'seasonal', 'checkin']) expect(isOn(s, id)).toBe(false)
  })

  it('one switch away from a preset is Custom, and keeps the other keys', () => {
    const s = { modules: { foo: 1 } }
    applyPreset(s, 'body')
    setModule(s, 'seasonal', true)
    expect(presetOf(s)).toBe('custom')
    expect(s.modules.foo).toBe(1)
    setModule(s, 'nope', true)
    expect('nope' in s.modules).toBe(false)
    expect(moduleStates(s).seasonal).toBe(true)
  })

  it('names what a change switches off', () => {
    expect(turnedOff({}, presetModules('training')).sort()).toEqual(['body', 'checkin', 'coach', 'health', 'integrations', 'motivation', 'seasonal', 'strength', 'videos'])
    expect(turnedOff({ modules: { body: false } }, { body: false, coach: false })).toEqual(['coach'])
  })
})
