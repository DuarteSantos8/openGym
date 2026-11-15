// A branch of the skill trees (lib/skill-tree.js) as one of your own ladders (lib/ladders.js), so
// the Skill ladder rule (lib/progression.js) trains it: a front lever or an L-sit climbs the way
// the built-in push-up ladder does. Each skill becomes a rung: its catalogue exercise when it has
// one, else the custom exercise of yours that already shows it (skillOfExercise), else a new
// custom exercise named after it, a hold when the skill is one, with its demo link.
import { BRANCHES, SKILLS, haveOf, skillOfExercise } from './skill-tree.js'
import { saveLadder, STEPS_MAX } from './ladders.js'
import { isHold } from './exercises.js'

// Static positions are held, everything that moves is counted: a Front Lever is a hold, a Front
// Lever Row, a Planche PU or a Dragon Flag are reps.
const HOLD = /\b(lever|l-sit|v-sit|planche|flag|hang|handstand|hs|manna|support|cross|maltese|hollow|stand|bridge|plank)\b/i
const MOVES = /\b(pu|push[ -]?ups?|pull[ -]?ups?|pulls?|rows?|raises?|dips?|squats?|press|pullout|to|t2b|curls?|wheel|muscle[ -]?ups?|skin|negs?|walk|dragon|360°?)\b/i
export const isHoldSkill = name => HOLD.test(String(name)) && !MOVES.test(String(name))

/** Whether exercise `id` is trained as a hold: its own flag, or the skill it shows (lib/skill-tree.js),
 *  so a custom exercise of yours reused for a hold skill keeps it in seconds without being changed. */
export function isHoldRung(S, id) {
  if (isHold(id)) return true
  const skill = skillOfExercise(S, id)
  return !!skill && isHoldSkill(SKILLS[skill].name)
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
  const first = Math.max(0, ids.findIndex(id => !have[id]))
  const from = Math.max(0, Math.min(first - 2, ids.length - STEPS_MAX))
  const own = Array.isArray(S?.customEx) ? S.customEx : []
  const rungs = ids.slice(from, from + STEPS_MAX).map(skill => {
    if (SKILLS[skill].ex) return { skill, ex: SKILLS[skill].ex, create: null }
    const shown = own.find(c => c?.id === 'sk-' + skill) || own.find(c => c?.id && skillOfExercise(S, c.id) === skill)
    if (shown) return { skill, ex: shown.id, create: null }
    const create = skillExercise(skill)
    return { skill, ex: create.id, create }
  })
  const at = ids.findIndex(id => !have[id])
  return { rungs, rung: at < 0 ? rungs.length - 1 : Math.min(rungs.length - 1, Math.max(0, at - from)) }
}

/** In a state draft: the custom exercises branch `bi` needs, and its ladder. { ladder, rung } or null. */
export function addBranchLadder(s, bi) {
  const { rungs, rung } = branchRungs(s, bi)
  if (!Array.isArray(s.customEx)) s.customEx = []
  for (const r of rungs) if (r.create && !s.customEx.some(c => c?.id === r.create.id)) s.customEx.push(r.create)
  const ladder = saveLadder(s, { id: branchLadderId(bi), name: BRANCHES[bi].name, steps: rungs.map(r => r.ex) })
  return ladder ? { ladder: { ...ladder, own: true }, rung } : null
}
