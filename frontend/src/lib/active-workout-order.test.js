import { describe, expect, it } from 'vitest'
import { canMoveActiveWorkoutUnit, moveActiveWorkoutUnit, canMoveActiveWorkoutEntry, moveActiveWorkoutEntry } from './active-workout-order.js'
import { supersetFlowStep } from './supersetFlow.js'
import { supersetUnits } from './history.js'
import { LANGS, DERIVED_LOCALES } from './i18n-core.js'
import { PT_BR_OVERRIDES } from '../locales/pt-BR.js'

const entry = (id, extra = {}) => ({
  id, exposureId: extra.exposureId || extra.occurrenceId || id,
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
    const entries = [duplicateA, entry('middle'), selected]
    const active = { cur: 2, entries, exposures: entries.map(x => ({ exposureId: x.exposureId, exerciseId: x.id })) }

    expect(moveActiveWorkoutUnit(active, active.cur, -1)?.indices).toEqual([0, 2, 1])
    expect(active.entries.map(item => item.occurrenceId || item.id)).toEqual(['duplicate#1', 'duplicate#2', 'middle'])
    expect(active.entries[0]).toBe(duplicateA)
    expect(active.entries[1]).toBe(selected)
    expect(active.entries[1].target).toBe(selected.target)
    expect(active.entries[1].sets).toBe(selected.sets)
    expect(active.exposures.map(item => item.exposureId)).toEqual(['duplicate#1', 'duplicate#2', 'middle'])
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

// Move down on a hanging leg raise, to get it away from the pull-ups next to it, moved the whole
// superset instead and left the order inside it as it was (#377, there in the routine editor).
describe('active workout member move (the exercise ⋯ menu)', () => {
  const circuit = () => {
    const ids = ['split-squat', 'pull-up', 'hanging-leg-raise', 'plank', 'triceps', 'carry']
    return [entry('incline-bench'), ...ids.map(id => entry(id, { sg: 'sg-m3' })), entry('cool-down')]
  }
  const ids = active => active.entries.map(item => item.id)

  it('swaps a member with its neighbour inside the superset and keeps the superset whole', () => {
    const active = { cur: 0, entries: circuit(), groupMeta: { 'sg-m3': { label: 'Circuit' } } }
    expect(canMoveActiveWorkoutEntry(active, 3, 1)).toBe(true)
    expect(moveActiveWorkoutEntry(active, 3, 1)?.indices).toEqual([0, 1, 2, 4, 3, 5, 6, 7])
    expect(ids(active)).toEqual(['incline-bench', 'split-squat', 'pull-up', 'plank', 'hanging-leg-raise', 'triceps', 'carry', 'cool-down'])
    expect(active.entries.slice(1, 7).every(item => item.sg === 'sg-m3')).toBe(true)
    expect(active.cur).toBe(0)
    moveActiveWorkoutEntry(active, 4, -1)
    expect(ids(active).slice(2, 5)).toEqual(['pull-up', 'hanging-leg-raise', 'plank'])
  })

  // The round-robin is positional: the members before the marker have done the round, the
  // marker's member and those after it owe it. The marker keeps its position, so after the
  // pull-ups the leg raise moved down puts the plank on the marker, next.
  it('the marker keeps its position: the member swapped onto it is the one that comes next', () => {
    const active = { cur: 3, entries: circuit() }
    expect(moveActiveWorkoutEntry(active, 3, 1)?.indices).toEqual([0, 1, 2, 4, 3, 5, 6, 7])
    expect(active.cur).toBe(3)
    expect(active.entries[active.cur].id).toBe('plank')
    // two members both behind the marker (done this round) swap freely too
    const behind = { cur: 5, entries: circuit() }
    expect(moveActiveWorkoutEntry(behind, 1, 1)).not.toBeNull()
    expect(ids(behind).slice(1, 3)).toEqual(['pull-up', 'split-squat'])
    expect(behind.cur).toBe(5)
  })

  // The whole point of the two rules above, run through the real round-robin: after the split
  // squat and the pull-up, the leg raise moves down, and the round still gives every member
  // exactly one set before its rest.
  it('a swap allowed mid-round leaves the round-robin giving every member one set per round', () => {
    const sets = done => done.map(value => ({ w: 0, r: 5, done: value }))
    const ids = ['split-squat', 'pull-up', 'hanging-leg-raise', 'plank', 'triceps', 'carry']
    const entries = [entry('incline-bench', { sets: sets([true]) }),
      ...ids.map((id, i) => entry(id, { sg: 'sg-m3', sets: sets([i < 2, false, false, false]) }))]
    const active = { cur: 3, entries }
    expect(moveActiveWorkoutEntry(active, 3, 1)).not.toBeNull()
    const order = []
    for (let guard = 0; guard < 10; guard++) {
      const e = active.entries[active.cur]
      e.sets[e.sets.findIndex(set => !set.done)].done = true
      order.push(e.id)
      const unit = supersetUnits(active.entries).find(members => members.includes(active.cur))
      const step = supersetFlowStep(active.entries, unit, active.cur)
      active.cur = step.nextIdx
      if (step.roundDone) break
    }
    expect(order).toEqual(['plank', 'hanging-leg-raise', 'triceps', 'carry'])
    expect(active.entries.slice(1).map(e => e.sets.filter(set => set.done).length)).toEqual([1, 1, 1, 1, 1, 1])
    expect(active.entries[active.cur].id).toBe('split-squat')
  })

  it('refuses a swap across the marker mid-round, which would skip one member and repeat the other', () => {
    const active = { cur: 3, entries: circuit() }
    const before = ids(active)
    expect(canMoveActiveWorkoutEntry(active, 3, -1)).toBe(false)
    expect(canMoveActiveWorkoutEntry(active, 2, 1)).toBe(false)
    expect(moveActiveWorkoutEntry(active, 3, -1)).toBeNull()
    expect(moveActiveWorkoutEntry(active, 2, 1)).toBeNull()
    expect(ids(active)).toEqual(before)
    expect(active.cur).toBe(3)
    // at the top of a round nobody is behind the marker, so the first member may move down
    const top = { cur: 1, entries: circuit() }
    expect(canMoveActiveWorkoutEntry(top, 1, 1)).toBe(true)
    moveActiveWorkoutEntry(top, 1, 1)
    expect(top.entries[top.cur].id).toBe('pull-up')
  })

  it('at the superset edge moves the whole superset, as the unit move always has', () => {
    const up = { cur: 1, entries: circuit() }
    expect(moveActiveWorkoutEntry(up, 1, -1)?.indices).toEqual([1, 2, 3, 4, 5, 6, 0, 7])
    expect(ids(up)[6]).toBe('incline-bench')

    const down = { cur: 6, entries: circuit() }
    expect(moveActiveWorkoutEntry(down, 6, 1)?.indices).toEqual([0, 7, 1, 2, 3, 4, 5, 6])
    expect(ids(down)[1]).toBe('cool-down')
  })

  it('a lone exercise moves exactly as before, and the ends still refuse', () => {
    const solo = { cur: 0, entries: circuit() }
    expect(moveActiveWorkoutEntry(solo, 0, 1)?.indices).toEqual([1, 2, 3, 4, 5, 6, 0, 7])
    const ends = { cur: 0, entries: [entry('first'), entry('last')] }
    expect(canMoveActiveWorkoutEntry(ends, 0, -1)).toBe(false)
    expect(canMoveActiveWorkoutEntry(ends, 1, 1)).toBe(false)
    expect(moveActiveWorkoutEntry(ends, 0, -1)).toBeNull()
    expect(moveActiveWorkoutEntry(ends, 0, 0)).toBeNull()
    expect(ids(ends)).toEqual(['first', 'last'])
  })

  it('two adjacent supersets stay apart: an edge member never swaps into the next superset', () => {
    const active = { cur: 0, entries: [entry('a1', { sg: 'a' }), entry('a2', { sg: 'a' }), entry('b1', { sg: 'b' }), entry('b2', { sg: 'b' })] }
    expect(moveActiveWorkoutEntry(active, 1, 1)?.indices).toEqual([2, 3, 0, 1])
    expect(active.entries.map(item => `${item.id}:${item.sg}`)).toEqual(['b1:b', 'b2:b', 'a1:a', 'a2:a'])
  })
})

describe('active workout move locale coverage', () => {
  const packs = import.meta.glob('../locales/*.js', { eager: true, import: 'default' })
  // English is the source language and has no pack. Derived locales (de-CH) have none either:
  // they transform their base language's pack at load time, and are checked separately below.
  const localeCodes = Object.keys(LANGS).filter(code => code !== 'en' && !DERIVED_LOCALES[code])

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
