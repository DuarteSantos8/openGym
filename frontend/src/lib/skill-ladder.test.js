import { describe, expect, it } from 'vitest'
import { BRANCHES, SKILLS, skillId } from './skill-tree.js'
import { isHoldSkill, isHoldRung, branchRungs, addBranchLadder, branchLadderId, rungEntry, slotOnRung } from './skill-ladder.js'
import { skillOfExercise } from './skill-tree.js'
import { ownLadders, nextRung, reachedRung, saveLadder, OWN_MAX, STEPS_MAX } from './ladders.js'
import { EXIDX } from './exercises.js'

const bi = name => BRANCHES.findIndex(b => b.name === name)
const had = names => Object.fromEntries(names.map(n => [skillId(n), { at: 1 }]))

describe('isHoldSkill', () => {
  it('holds static positions, counts what moves', () => {
    for (const n of ['Tuck Front Lever', 'Straddle L-Sit', '90° V-Sit', 'Tuck Planche', 'Elbow Lever', 'German Hang', 'Handstand', 'Ring HS', 'Iron Cross'])
      expect(isHoldSkill(n), n).toBe(true)
    for (const n of ['Front Lever Row', 'Planche PU', 'HS Push Up', 'Pull Up', 'Muscle Up', 'Tuck Skin the Cat', 'Back Lever Pullout', 'Dragon Flag', 'Pistol Squat'])
      expect(isHoldSkill(n), n).toBe(false)
  })

  it('holds the supports, the planche short names and the bridges, and still counts their moves', () => {
    for (const n of ['Sup Hold', 'Ring Sup Hold', 'RTO Sup Hold', 'Arch Body Hold', 'Wall Headstand', 'Adv Tuck PL', 'Ring Adv Tuck PL', 'Ring Straddle PL', 'Ring One Leg PL', 'Planche Lean', 'Bridge / Wheel', 'Arch Hang'])
      expect(isHoldSkill(n), n).toBe(true)
    for (const n of ['Adv Tuck PL PU', 'Ring Tuck PL PU', 'Ring Straddle PL PU', 'SA Str PL to HS', 'Wall HeS PU', 'Headstand PU', 'Support Press', 'Knees Ab Wheel', 'Iron Cross to BL', 'Dip'])
      expect(isHoldSkill(n), n).toBe(false)
  })

  it('names every skill of the trees the way the chart trains it', () => {
    // Every name of the data, read once by hand: these are the holds, everything else counts reps.
    const holds = new Set(['German Hang', 'Tuck Back Lever', 'Adv Tuck Back Lever', 'One Leg Back Lever', 'Straddle Back Lever', 'Back Lever',
      'L-Hang', 'Tuck Front Lever', 'Adv Tuck Front Lever', 'One Leg Front Lever', 'Straddle Front Lever', 'Front Lever',
      'Iron Cross Progression', 'Iron Cross', 'Arch Hang', 'Sup Hold', 'Ring Sup Hold', 'RTO Sup Hold',
      'Foot Sup L-Sit', 'One Leg L-Sit', 'Tuck L-Sit', 'One Leg Bent L-Sit', 'L-Sit', 'Straddle L-Sit', 'RTO L-Sit',
      '45° V-Sit', '90° V-Sit', '120° V-Sit', '140° V-Sit', '155° V-Sit', '170° V-Sit', 'Manna',
      'Side Plank', 'Tuck Flag', 'Vertical Flag', 'Adv Tuck Flag', 'Straddle Flag', 'Human Flag',
      'Reverse Plank', 'Shoulder Bridge', 'Table Bridge', 'Angled Bridge', 'Head Bridge', 'Bridge / Wheel', 'Decline Bridge',
      'One Leg Bridge', 'Decline OL Bridge', 'OA Head Bridge', 'OA Bridge',
      'Wall Plank', 'Wall Headstand', 'Wall Handstand', 'Handstand', 'Tuck Handstand', 'OA HS Progression', 'Straddle OA HS',
      'Straight OA HS', 'Additional HS Variations', 'Ring Shld Stand', 'Ring HS', 'Inverted Cross',
      'Straddle Elbow Lever', 'One Leg Elbow Lever', 'Elbow Lever', 'Ring Elbow Lever', 'OA Straddle Elbow Lever', 'One Arm Elbow Lever',
      'Plank', 'Straddle One Arm Plank', 'Planche Lean', 'Frog Stand / Crow Pose', 'Straight Arm Frog Stand / Crane Pose',
      'Tuck Planche', 'Adv Tuck PL', 'Str Planche', 'One Leg Planche', 'Planche',
      'Ring Frog Stand', 'Ring SA Frog Stand', 'Ring Tuck Planche', 'Ring Adv Tuck PL', 'Ring Straddle PL', 'Ring One Leg PL',
      'Ring Planche', 'Maltese', 'Arch Body Hold', 'OA Plank', 'OA OL Plank', 'Hollow Hold'])
    for (const id of Object.keys(SKILLS)) expect(isHoldSkill(SKILLS[id].name), SKILLS[id].name).toBe(holds.has(SKILLS[id].name))
    for (const n of holds) expect(SKILLS[skillId(n)], n).toBeTruthy()
  })
})

describe('a slot moved to another rung', () => {
  const lever = 'sk-tuck-front-lever', row = 'sk-tuck-fl-row'
  const reps = { id: row, sets: 4, reps: 12, repsMin: 5, weight: 0, mode: 'reps', bodyweight: true, prog: 'ladder', note: 'mine' }
  const hold = { id: lever, sets: 4, sec: 25, secTop: 40, weight: 0, mode: 'time', bodyweight: true, prog: 'ladder', note: 'mine' }

  it('keeps no reps on a hold rung, its sets and the rest kept', () => {
    for (const fresh of [false, true]) {
      const out = slotOnRung(reps, lever, {}, { fresh })
      expect(out).toMatchObject({ id: lever, mode: 'time', sec: rungEntry(lever, {}).sec, sets: 4, note: 'mine' })
      expect(out).not.toHaveProperty('reps')
      expect(out).not.toHaveProperty('repsMin')
    }
  })

  it('keeps no seconds on a reps rung', () => {
    for (const fresh of [false, true]) {
      const out = slotOnRung(hold, row, {}, { fresh })
      expect(out).toMatchObject({ id: row, mode: 'reps', reps: rungEntry(row, {}).reps, repsMin: rungEntry(row, {}).repsMin, sets: 4, note: 'mine' })
      expect(out).not.toHaveProperty('sec')
      expect(out).not.toHaveProperty('secTop')
    }
  })

  it('on the same way, starts a hold at the bottom and keeps a rep range unless fresh', () => {
    expect(slotOnRung({ ...hold, id: 'sk-adv-tuck-front-lever' }, 'sk-adv-tuck-front-lever', {}).sec).toBe(rungEntry(lever, {}).sec)
    const mine = { ...reps, id: 'sk-adv-tuck-fl-row', reps: 8, repsMin: 6 }
    expect(slotOnRung(mine, mine.id, {})).toMatchObject({ reps: 8, repsMin: 6 })
    expect(slotOnRung(mine, mine.id, {}, { fresh: true })).toMatchObject({ reps: rungEntry(row, {}).reps, repsMin: rungEntry(row, {}).repsMin })
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

  it('shows the end of a long branch once every skill of it is had', () => {
    const b = BRANCHES[bi('L-Sit')]
    expect(b.ids.length).toBeGreaterThan(STEPS_MAX)
    const S = { skills: Object.fromEntries(b.ids.map(id => [id, { at: 1 }])), customEx: [] }
    const { rungs, rung } = branchRungs(S, bi('L-Sit'))
    expect(rungs.map(r => r.skill)).toEqual(b.ids.slice(-STEPS_MAX))
    expect(rungs[rung].skill).toBe(b.ids.at(-1))
  })

  it('trains every skill on an exercise the trees read back as that skill', () => {
    // A rung the ladder counts and a session the trees count are the same thing, catalogue rungs included.
    // From the start of each branch and, every skill had, from its end: a long branch shows both halves.
    const all = { skills: Object.fromEntries(Object.keys(SKILLS).map(id => [id, { at: 1 }])) }
    for (const S of [{}, all]) for (let i = 0; i < BRANCHES.length; i++)
      for (const r of branchRungs(S, i).rungs) if (EXIDX[r.ex]) expect(skillOfExercise(S, r.ex), SKILLS[r.skill].name + ' ' + r.ex).toBe(r.skill)
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

  it('adds nothing, not even its exercises, with no room for another ladder', () => {
    const s = { skills: {}, customEx: [] }
    for (let i = 0; i < OWN_MAX; i++) saveLadder(s, { id: 'mine' + i, name: 'Mine ' + i, steps: ['a', 'b'] })
    expect(addBranchLadder(s, bi('Front Lever'))).toBeNull()
    expect(s.customEx).toEqual([])
    expect(ownLadders(s).length).toBe(OWN_MAX)
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

  it('keeps a custom exercise of yours for a hold skill in seconds, without changing it', () => {
    const mine = { id: 'mine1', n: 'Tuck L-Sit', custom: true }
    const S = { skills: {}, customEx: [mine] }
    expect(isHoldRung(S, 'mine1')).toBe(true)
    expect(mine.hd).toBeUndefined()
    expect(isHoldRung(S, 'mine2')).toBe(false)
  })

  it('reads an assisted pistol as the assisted skill, not the whole pistol', () => {
    const S = { customEx: [{ id: 'a', n: 'Assisted Pistol Squat' }, { id: 'b', n: 'Pistol squat' }] }
    expect(skillOfExercise(S, 'a')).toBe('assisted-pistol-squat')
    expect(skillOfExercise(S, 'b')).toBe('pistol-squat')
  })
})
