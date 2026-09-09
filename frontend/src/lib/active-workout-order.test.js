import { describe, expect, it } from 'vitest'
import { canMoveActiveWorkoutUnit, moveActiveWorkoutUnit } from './active-workout-order.js'
import { LANGS } from './i18n-core.js'
import { PT_BR_OVERRIDES } from '../locales/pt-BR.js'

const entry = (id, extra = {}) => ({
  id,
  target: { sets: 1, reps: 5 },
  sets: [{ w: 0, r: 5, done: false }],
  ...extra,
})

describe('active workout whole-unit order', () => {
  it('moves one standalone occurrence without conflating duplicate exercise ids', () => {
    const duplicateA = entry('duplicate', { occurrenceId: 'duplicate#1' })
    const selected = entry('duplicate', {
      occurrenceId: 'duplicate#2',
      target: { sets: 2, reps: 7, weight: 82.5, notes: 'Keep this target' },
      sets: [{ w: 77.5, r: 6, done: true, rir: 2 }],
    })
    const active = { cur: 2, entries: [duplicateA, entry('middle'), selected] }

    expect(moveActiveWorkoutUnit(active, active.cur, -1)?.indices).toEqual([0, 2, 1])
    expect(active.entries.map(item => item.occurrenceId || item.id)).toEqual(['duplicate#1', 'duplicate#2', 'middle'])
    expect(active.entries[0]).toBe(duplicateA)
    expect(active.entries[1]).toBe(selected)
    expect(active.entries[1].target).toBe(selected.target)
    expect(active.entries[1].sets).toBe(selected.sets)
    expect(active.cur).toBe(1)
  })

  it('moves a complete contiguous group one unit and preserves the selected member identity', () => {
    const first = entry('group-a', { sg: 'pair', occurrenceId: 'group-a#1' })
    const selected = entry('group-b', { sg: 'pair', occurrenceId: 'group-b#1' })
    const groupMeta = { pair: { kind: 'complex', label: 'Carry pair', cues: 'Stay braced.' } }
    const active = { cur: 2, entries: [entry('before'), first, selected, entry('after')], groupMeta }

    expect(moveActiveWorkoutUnit(active, active.cur, -1)?.indices).toEqual([1, 2, 0, 3])
    expect(active.entries.map(item => item.id)).toEqual(['group-a', 'group-b', 'before', 'after'])
    expect(active.entries.slice(0, 2)).toEqual([first, selected])
    expect(active.entries.map(item => item.sg)).toEqual(['pair', 'pair', undefined, undefined])
    expect(active.groupMeta).toBe(groupMeta)
    expect(active.entries[active.cur]).toBe(selected)
  })

  it('moves a group down by exactly one neighbouring unit', () => {
    const first = entry('group-a', { sg: 'pair' })
    const selected = entry('group-b', { sg: 'pair' })
    const active = { cur: 1, entries: [first, selected, entry('middle'), entry('last')] }

    expect(moveActiveWorkoutUnit(active, active.cur, 1)?.indices).toEqual([2, 0, 1, 3])
    expect(active.entries.map(item => item.id)).toEqual(['middle', 'group-a', 'group-b', 'last'])
    expect(active.entries[active.cur]).toBe(selected)
  })

  it('rejects boundaries and invalid directions without mutating the active workout', () => {
    const active = { cur: 0, entries: [entry('first'), entry('last')] }
    const entries = [...active.entries]

    expect(canMoveActiveWorkoutUnit(active, 0, -1)).toBe(false)
    expect(canMoveActiveWorkoutUnit(active, 1, 1)).toBe(false)
    expect(moveActiveWorkoutUnit(active, 0, 0)).toBeNull()
    expect(moveActiveWorkoutUnit(active, 0, -1)).toBeNull()
    expect(active.entries).toEqual(entries)
    expect(active.cur).toBe(0)
  })
})

describe('active workout move locale coverage', () => {
  const packs = import.meta.glob('../locales/*.js', { eager: true, import: 'default' })
  const localeCodes = Object.keys(LANGS).filter(code => code !== 'en')

  it('defines both visible move labels in every current locale pack', () => {
    expect(Object.keys(packs)).toHaveLength(localeCodes.length)
    for (const code of localeCodes) {
      const pack = packs[`../locales/${code}.js`]
      expect(pack, `${code} locale pack is missing`).toBeTruthy()
      for (const key of ['Move up', 'Move down']) {
        expect(Object.hasOwn(pack, key), `${code} is missing ${key}`).toBe(true)
        expect(pack[key], `${code} has a blank ${key}`).toEqual(expect.any(String))
        expect(pack[key].trim(), `${code} has a blank ${key}`).not.toBe('')
      }
    }
    expect(Object.hasOwn(PT_BR_OVERRIDES, 'Move up')).toBe(true)
    expect(Object.hasOwn(PT_BR_OVERRIDES, 'Move down')).toBe(true)
  })
})
