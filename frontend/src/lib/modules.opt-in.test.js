import { test, expect } from 'vitest'
import { MODULE, MODULES, isOn } from './modules.js'
test('a declared opt-in module stays off until explicitly enabled', () => {
  MODULE.contractProbe = { id: 'contractProbe', optIn: true }
  try {
    for (const S of [{}, { modules: {} }, { modules: { contractProbe: null } }, { modules: { contractProbe: false } }]) expect(isOn(S, 'contractProbe')).toBe(false)
    expect(isOn({ modules: { contractProbe: true } }, 'contractProbe')).toBe(true)
  } finally { delete MODULE.contractProbe }
})
test('every existing module retains its exact legacy decision without mutating any profile', () => {
  for (const modules of [undefined, null, [], {}, ...[true, false, null, 0, 'false'].map(v => Object.fromEntries(MODULES.map(m => [m.id, v])))]) {
    for (const checkIn of [undefined, true, false]) {
      const S = { modules, checkIn }, before = JSON.stringify(S)
      for (const { id, optIn } of MODULES) {
        const v = modules?.[id]
        expect(isOn(S, id)).toBe(typeof v === 'boolean' ? v : id === 'checkin' ? checkIn !== false : !optIn)
      }
      expect(isOn(S, 'unknownFutureId')).toBe(true)
      expect(JSON.stringify(S)).toBe(before)
    }
  }
})
