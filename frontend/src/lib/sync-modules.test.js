/* Settings → Modules (lib/modules.js) syncs per module: two devices that each switch a different
   module keep both, and the server stamps a writer that does not stamp per module too. */
import { describe, expect, it } from 'vitest'
import { mergeStates, stampEdits } from './sync-merge.js'
import { stampPut } from '../../../api/sync-stamps.js'
import { isOn } from './modules.js'

const clone = v => JSON.parse(JSON.stringify(v))

describe('modules sync per module', () => {
  it('Body off on the phone and Seasonal off on the laptop both hold', () => {
    const base = { _ts: 100, unit: 'kg', workouts: [], routines: [], modules: {} }
    const phone = clone(base); phone.modules = { body: false }; phone._ts = 200
    stampEdits(base, phone, 200)
    const laptop = clone(base); laptop.modules = { seasonal: false }; laptop._ts = 300
    stampEdits(base, laptop, 300)
    for (const out of [mergeStates(phone, laptop), mergeStates(laptop, phone)]) {
      expect(isOn(out, 'body')).toBe(false)
      expect(isOn(out, 'seasonal')).toBe(false)
      expect(isOn(out, 'coach')).toBe(true)
    }
  })

  it('the later switch of the same module wins, back on included', () => {
    const base = { _ts: 100, unit: 'kg', workouts: [], routines: [], modules: { body: false }, edited: { 'modules.body': 100 } }
    const a = clone(base); a.modules = { body: true }; a._ts = 150
    stampEdits(base, a, 400)
    const b = clone(base); b.modules = { body: false, coach: false }; b._ts = 500
    stampEdits(base, b, 300)
    const out = mergeStates(a, b)
    expect(out.modules.body).toBe(true)
    expect(out.modules.coach).toBe(false)
  })

  it('the API stamps each module on its own', () => {
    const before = { _ts: 10, modules: { body: true, coach: true }, edited: { 'modules.body': 10, 'modules.coach': 10 } }
    const after = structuredClone(before)
    after.modules.body = false
    stampPut(before, after, { overRead: true, now: 100 })
    expect(after.edited['modules.body']).toBe(100)
    expect(after.edited['modules.coach']).toBe(10)
  })
})
