import { describe, expect, it } from 'vitest'
import { MODULE, MODULE_IDS, PARTS, partsOf, partSwitch, partOn, anyPartOn, partsOnCount, setPart, setModule, applyPreset, presetOf, onCount, moduleStates, turnedOff } from './modules.js'
import { partCopy } from './modules-copy.js'
import { stampEdits, mergeStates } from './sync-merge.js'

describe('the parts of a module (#1087)', () => {
  it('every part belongs to a module and has its copy', () => {
    const copy = partCopy()
    for (const [id, parts] of Object.entries(PARTS)) {
      expect(MODULE[id], id).toBeTruthy()
      expect(parts.length).toBeGreaterThan(1)
      for (const p of parts) {
        expect(copy[id + '.' + p.id]).toEqual([p.title, p.desc])
        expect(p.desc).not.toMatch(/—/)
      }
    }
    expect(Object.keys(copy)).toHaveLength(Object.values(PARTS).flat().length)
    expect(partsOf('effort')).toEqual([])
  })

  it('a part never set is on', () => {
    expect(partOn({}, 'body', 'photos')).toBe(true)
    expect(partOn(null, 'body', 'photos')).toBe(true)
    expect(partOn({ modules: { body: true } }, 'body', 'photos')).toBe(true)
    expect(partsOnCount({}, 'body')).toBe(3)
  })

  it('the module off hides every part, and back on each is as it was left', () => {
    const s = {}
    setPart(s, 'body', 'photos', false)
    expect(partOn(s, 'body', 'photos')).toBe(false)
    expect(partOn(s, 'body', 'weight')).toBe(true)
    setModule(s, 'body', false)
    expect(partOn(s, 'body', 'weight')).toBe(false)
    expect(anyPartOn(s, 'body')).toBe(false)
    // the switch itself is kept while the module is off
    expect(partSwitch(s, 'body', 'weight')).toBe(true)
    expect(partSwitch(s, 'body', 'photos')).toBe(false)
    setModule(s, 'body', true)
    expect(partOn(s, 'body', 'weight')).toBe(true)
    expect(partOn(s, 'body', 'photos')).toBe(false)
  })

  it('anyPartOn is false once every part is off', () => {
    const s = {}
    for (const p of PARTS.body) setPart(s, 'body', p.id, false)
    expect(anyPartOn(s, 'body')).toBe(false)
    expect(partsOnCount(s, 'body')).toBe(0)
    setPart(s, 'body', 'measurements', true)
    expect(anyPartOn(s, 'body')).toBe(true)
    // a module without parts: as isOn
    expect(anyPartOn({}, 'effort')).toBe(true)
    expect(anyPartOn({ modules: { effort: false } }, 'effort')).toBe(false)
  })

  it('the setter writes one dotted key and ignores unknown parts', () => {
    const s = { modules: { body: true } }
    setPart(s, 'body', 'photos', false)
    expect(s.modules).toEqual({ body: true, 'body.photos': false })
    setPart(s, 'body', 'nope', false)
    setPart(s, 'effort', 'column', false)
    expect(s.modules).toEqual({ body: true, 'body.photos': false })
  })

  it('presets set modules only and leave the parts', () => {
    const s = {}
    setPart(s, 'motivation', 'share', false)
    applyPreset(s, 'training')
    expect(s.modules['motivation.share']).toBe(false)
    expect(presetOf(s)).toBe('training')
    applyPreset(s, 'all')
    expect(presetOf(s)).toBe('all')
    expect(partOn(s, 'motivation', 'share')).toBe(false)
    expect(partOn(s, 'motivation', 'streak')).toBe(true)
  })

  it('the part keys are not modules: counts, states and turnedOff ignore them', () => {
    const s = { modules: { 'body.photos': false, 'motivation.streak': false } }
    expect(onCount(s)).toBe(MODULE_IDS.length)
    expect(Object.keys(moduleStates(s)).sort()).toEqual([...MODULE_IDS].sort())
    expect(presetOf(s)).toBe('all')
    expect(turnedOff({}, { 'body.photos': false })).toEqual([])
  })

  it('Just training keeps the whole exercise settings sheet', () => {
    const s = {}
    applyPreset(s, 'training')
    for (const p of PARTS.exercise) expect(partOn(s, 'exercise', p.id)).toBe(true)
  })

  it('two devices’ part choices both survive a sync', () => {
    const start = { _ts: 1, unit: 'kg', workouts: [], routines: [], modules: {} }
    const phone = stampEdits(start, { ...start, _ts: 10, modules: { 'body.photos': false } }, 10)
    const laptop = stampEdits(start, { ...start, _ts: 20, modules: { 'motivation.share': false, body: false } }, 20)
    for (const out of [mergeStates(phone, laptop), mergeStates(laptop, phone)]) {
      expect(out.modules).toEqual({ 'body.photos': false, 'motivation.share': false, body: false })
      expect(partOn(out, 'motivation', 'share')).toBe(false)
      expect(partSwitch(out, 'body', 'photos')).toBe(false)
    }
    // the same part changed on both: the later change wins
    const a = stampEdits(start, { ...start, _ts: 30, modules: { 'body.photos': false } }, 30)
    const b = stampEdits(start, { ...start, _ts: 40, modules: { 'body.photos': true } }, 40)
    expect(mergeStates(a, b).modules['body.photos']).toBe(true)
    expect(mergeStates(b, a).modules['body.photos']).toBe(true)
  })
})
