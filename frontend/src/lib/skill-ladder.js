// A branch of the skill trees (lib/skill-tree.js) as one of your own ladders (lib/ladders.js), so
// the Skill ladder rule (lib/progression.js) trains it: a front lever or an L-sit climbs the way
// the built-in push-up ladder does. Each skill becomes a rung: its catalogue exercise when it has
// one, else the custom exercise of yours that already shows it (skillOfExercise), else a new
// custom exercise named after it, a hold when the skill is one, with its demo link.
import { BRANCHES, SKILLS, haveOf, skillOfExercise } from './skill-tree.js'
import { ownLadders, saveLadder, OWN_MAX, STEPS_MAX } from './ladders.js'
import { isHold } from './exercises.js'
import { modeOf } from './history.js'
import { LADDER_TOP, LADDER_BOTTOM, LADDER_SEC_BOTTOM } from './progression.js'

// Static positions are held, everything that moves is counted: a Front Lever, a Sup Hold, an Adv
// Tuck PL (planche) or a Bridge / Wheel are holds, a Front Lever Row, a Planche PU or a Dragon
// Flag are reps.
const HOLD = /\b(lever|l-sit|v-sit|planche|pl|flag|hang|handstand|headstand|hs|manna|support|cross|maltese|hollow|hold|stand|bridge|plank)\b/i
const MOVES = /\b(pu|push[ -]?ups?|pull[ -]?ups?|pulls?|rows?|raises?|dips?|squats?|press|pullout|to|t2b|curls?|muscle[ -]?ups?|skin|negs?|walk|dragon|360°?)\b/i
export const isHoldSkill = name => HOLD.test(String(name)) && !MOVES.test(String(name))

/** Whether exercise `id` is trained as a hold: its own flag, or the skill it shows (lib/skill-tree.js),
 *  so a custom exercise of yours reused for a hold skill keeps it in seconds without being changed. */
export function isHoldRung(S, id) {
  if (isHold(id)) return true
  const skill = skillOfExercise(S, id)
  return !!skill && isHoldSkill(SKILLS[skill].name)
}

/** A rung as it starts in a routine: three sets climbing from 5 to 12 reps on the ladder rule,
 *  or for a hold (a lever, an L-sit) from 10 to 30 seconds. */
export const rungEntry = (id, S = null) => (isHoldRung(S, id)
  ? { id, sets: 3, sec: LADDER_SEC_BOTTOM, weight: 0, mode: 'time', bodyweight: true, prog: 'ladder' }
  : { id, sets: 3, reps: LADDER_TOP, repsMin: LADDER_BOTTOM, weight: 0, mode: 'reps', bodyweight: true, prog: 'ladder' })

/**
 * Routine slot `slot` put on rung `id`, its sets kept. A slot that changes way, from reps to a
 * hold or back (a front lever row, then a front lever), starts the rung afresh and keeps nothing
 * of the other way: no reps on a hold, no seconds on reps. `fresh` starts it afresh either way;
 * without it a slot that keeps its way keeps its own rep range, and a hold starts at the bottom.
 */
export function slotOnRung(slot, id, S = null, { fresh = false } = {}) {
  const cur = slot || {}
  const entry = rungEntry(id, S)
  if (fresh || (entry.mode === 'time') !== (modeOf(cur) === 'time')) {
    const { reps: _r, repsMin: _m, sec: _s, secTop: _t, mode: _o, ...kept } = cur
    return { ...kept, ...entry, sets: cur.sets || entry.sets }
  }
  return entry.mode === 'time' ? { ...cur, sec: entry.sec } : { ...cur }
}

const BODY_PART = { hpull: 'back', vpull: 'back', vpush: 'shoulders', hpush: 'chest', core: 'waist', legs: 'upper legs' }

/** The ladder's id for branch `bi`: the same branch is the same ladder, updated in place. */
export const branchLadderId = bi => ('sk-' + BRANCHES[bi].name.toLowerCase().replace(/[^a-z0-9]+/g, '-')).replace(/-+$/, '').slice(0, 40)

/** A new custom exercise for skill `id`. Its id is the skill's, so two taps make one exercise. */
export function skillExercise(id) {
  const s = SKILLS[id]
  const [main, ...helpers] = s.muscles || []
  return {
    id: 'sk-' + id, n: s.name, custom: true, eq: 'body weight', bp: BODY_PART[s.fam] || 'upper arms',
    tg: main || '', primaries: main ? [main] : [], secondaries: helpers, muscleGroups: s.muscles || [],
    desc: s.url || '', ...(isHoldSkill(s.name) ? { hd: true } : {}),
  }
}

/**
 * The rungs of branch `bi` for state `S`: [{ skill, ex, create }], `create` the custom exercise
 * to add for a skill nothing shows yet. At most STEPS_MAX rungs: a longer branch keeps two
 * skills you have before the first you don't, then what comes after. `rung` is that first one.
 */
export function branchRungs(S, bi) {
  const ids = BRANCHES[bi].ids
  const have = haveOf(S)
  // With every skill had, the branch's end: its last rungs, not its first.
  const at = ids.findIndex(id => !have[id])
  const first = at < 0 ? ids.length : at
  const from = Math.max(0, Math.min(first - 2, ids.length - STEPS_MAX))
  const own = Array.isArray(S?.customEx) ? S.customEx : []
  const rungs = ids.slice(from, from + STEPS_MAX).map(skill => {
    if (SKILLS[skill].ex) return { skill, ex: SKILLS[skill].ex, create: null }
    const shown = own.find(c => c?.id === 'sk-' + skill) || own.find(c => c?.id && skillOfExercise(S, c.id) === skill)
    if (shown) return { skill, ex: shown.id, create: null }
    const create = skillExercise(skill)
    return { skill, ex: create.id, create }
  })
  return { rungs, rung: at < 0 ? rungs.length - 1 : Math.min(rungs.length - 1, Math.max(0, at - from)) }
}

/** In a state draft: the custom exercises branch `bi` needs, and its ladder. { ladder, rung } or null. */
export function addBranchLadder(s, bi) {
  const { rungs, rung } = branchRungs(s, bi)
  // No room for another ladder: nothing changes, the exercises it would bring included.
  const id = branchLadderId(bi), own = ownLadders(s)
  if (own.length >= OWN_MAX && !own.some(l => l.id === id)) return null
  if (!Array.isArray(s.customEx)) s.customEx = []
  for (const r of rungs) if (r.create && !s.customEx.some(c => c?.id === r.create.id)) s.customEx.push(r.create)
  const ladder = saveLadder(s, { id, name: BRANCHES[bi].name, steps: rungs.map(r => r.ex) })
  return ladder ? { ladder: { ...ladder, own: true }, rung } : null
}
