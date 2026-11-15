import { describe, expect, it } from 'vitest'
import { BRANCHES, SKILLS, skillId } from './skill-tree.js'
import { isHoldSkill, branchRungs, addBranchLadder, branchLadderId } from './skill-ladder.js'
import { ownLadders, nextRung, reachedRung, STEPS_MAX } from './ladders.js'

const bi = name => BRANCHES.findIndex(b => b.name === name)
const had = names => Object.fromEntries(names.map(n => [skillId(n), { at: 1 }]))

describe('isHoldSkill', () => {
  it('holds static positions, counts what moves', () => {
    for (const n of ['Tuck Front Lever', 'Straddle L-Sit', '90° V-Sit', 'Tuck Planche', 'Elbow Lever', 'German Hang', 'Handstand', 'Ring HS', 'Iron Cross'])
      expect(isHoldSkill(n), n).toBe(true)
    for (const n of ['Front Lever Row', 'Planche PU', 'HS Push Up', 'Pull Up', 'Muscle Up', 'Tuck Skin the Cat', 'Back Lever Pullout', 'Dragon Flag', 'Pistol Squat'])
      expect(isHoldSkill(n), n).toBe(false)
  })
})

describe('a branch as a ladder', () => {
  it('makes every skill a rung, a custom hold where the catalogue has none, and starts at the first one you lack', () => {
    const S = { skills: had(['Foot Sup L-Sit', 'One Leg L-Sit', 'Tuck L-Sit']), customEx: [] }
    const { rungs, rung } = branchRungs(S, bi('L-Sit'))
    expect(rungs.length).toBe(STEPS_MAX)
    expect(SKILLS[rungs[rung].skill].name).toBe('One Leg Bent L-Sit')
    const made = rungs.find(r => r.create)
    expect(made.create).toMatchObject({ custom: true, hd: true, bp: 'shoulders' })
    // A skill the catalogue has keeps its catalogue exercise.
    for (const r of rungs) if (SKILLS[r.skill].ex) expect(r.ex).toBe(SKILLS[r.skill].ex)
  })

  it('saves the ladder once, adds its exercises once, and the rule climbs it', () => {
    const s = { skills: {}, customEx: [] }
    const a = addBranchLadder(s, bi('Front Lever'))
    expect(a.rung).toBe(0)
    const n = s.customEx.length
    addBranchLadder(s, bi('Front Lever'))
    expect(s.customEx.length).toBe(n)
    expect(ownLadders(s).filter(l => l.id === branchLadderId(bi('Front Lever'))).length).toBe(1)
    const steps = a.ladder.steps
    expect(nextRung(s, steps[0])).toBe(steps[1])
  })

  it('reuses a custom exercise of yours that already shows the skill', () => {
    const mine = { id: 'mine1', n: 'Tuck L-Sit', custom: true }
    const { rungs } = branchRungs({ skills: {}, customEx: [mine] }, bi('L-Sit'))
    expect(rungs.find(r => SKILLS[r.skill].name === 'Tuck L-Sit').ex).toBe('mine1')
  })

  it('reaches the rungs the trees count as had, logged or not', () => {
    const s = { skills: had(['Foot Sup L-Sit', 'One Leg L-Sit', 'Tuck L-Sit']), customEx: [] }
    const { ladder } = addBranchLadder(s, bi('L-Sit'))
    const top = reachedRung(s, ladder)
    expect(SKILLS[ladder.steps[top].replace(/^sk-/, '')]?.name ?? ladder.steps[top]).toBe('Tuck L-Sit')
  })
})
