// The onboarding's screens and how one leads to the next (fitness-eval ux-onboarding.md §3b, the
// skip map; prototype v4 nextAfter/skipYou/startDetour). Pure: the screens and the layout read it,
// the tests pin it.
//
// The flow ends on `finish`, a PLACEHOLDER for the Summary: it completes the onboarding and goes
// Home. The Summary and its hand-over to Home are built later, on top of the redesigned Home.

export const SCREENS = ['invite', 'name', 'passkey', 'goal', 'sex', 'born', 'height', 'weight', 'training', 'plan', 'starter', 'finish']
// About you, one micro-step each.
export const YOU = ['sex', 'born', 'height', 'weight']
export const YOU_FIELD = { sex: 'sex', born: 'birthYear', height: 'heightCm', weight: 'weightKg' }
// Reachable before there is an account: the invite landing and the name + passkey step.
export const PRE_AUTH = ['invite', 'name']

const BASE = '/onboarding'
export const JOIN = '/join'

/** The hash route of a screen. The invite landing carries its code. */
export function pathOf(screen, code) {
  if (screen === 'invite') return code ? `${JOIN}/${encodeURIComponent(code)}` : JOIN
  return `${BASE}/${screen}`
}

/** The screen a path shows, or null for a path outside the flow. `/onboarding` alone: null (resume). */
export function screenOf(pathname = '') {
  if (pathname === JOIN || pathname.startsWith(JOIN + '/')) return 'invite'
  if (!pathname.startsWith(BASE + '/')) return null
  const id = pathname.slice(BASE.length + 1)
  return SCREENS.includes(id) && id !== 'invite' ? id : null
}

/** The invite code in a /join path, or null. */
export function codeOf(pathname = '') {
  if (!pathname.startsWith(JOIN + '/')) return null
  const raw = pathname.slice(JOIN.length + 1).split('/')[0]
  try { return decodeURIComponent(raw) || null } catch { return null }
}

/** Whether a path belongs to the onboarding at all (the shell hands it the screen). */
export const isFlowPath = (pathname = '') =>
  pathname === BASE || pathname.startsWith(BASE + '/') || pathname === JOIN || pathname.startsWith(JOIN + '/')

// What the nav row shows on each screen: the back chevron, the progress bar, the Skip at the end.
// Hidden on the landing and the passkey result; no way back once the passkey exists (goal).
const NAV = {
  invite: { show: false },
  name: { show: true, back: true },
  passkey: { show: false },
  goal: { show: true, back: false },
  sex: { show: true, back: true, skip: true },
  born: { show: true, back: true, skip: true },
  height: { show: true, back: true, skip: true },
  weight: { show: true, back: true, skip: true },
  training: { show: true, back: true, skip: true },
  plan: { show: true, back: true, skip: true },
  starter: { show: true, back: true },
  finish: { show: true, back: true },
}
export const navOf = screen => NAV[screen] || { show: false }

// Progress: Goal · You · Training. You fills in quarters, and the bar never shrinks (progressMax).
const PROGRESS = {
  goal: [1, 0, 0], sex: [1, 0.25, 0], born: [1, 0.5, 0], height: [1, 0.75, 0], weight: [1, 1, 0],
  training: [1, 1, 1], plan: [1, 1, 1], starter: [1, 1, 1],
}
export const progressOf = screen => PROGRESS[screen] || null
/** The bar as it shows after `screen`: never lower than it already was. */
export const progressMax = (max, screen) => {
  const want = PROGRESS[screen]
  return want ? max.map((m, i) => Math.max(m, want[i])) : max
}
/** 1, 2 or 3: the step of the three the screen belongs to. */
export const stepOf = screen => {
  const want = PROGRESS[screen]
  return !want ? null : want[2] ? 3 : want[1] ? 2 : 1
}

// The bar's step each of the hub's steps belongs to: the plan is part of Training.
const BAR_STEP = { goal: 1, body: 2, training: 3, plan: 3 }
/**
 * "N steps left" (ux-onboarding §6): the bar's steps, from the one `screen` is on, that the hub's
 * `remaining` still names. Counted as the bar counts them, so it never says more are left than the
 * bar has still to fill. null where the bar is not shown or the hub has not said.
 */
export function stepsLeft(remaining, screen) {
  const at = stepOf(screen)
  if (!at || !Array.isArray(remaining)) return null
  return new Set(remaining.map(s => BAR_STEP[s]).filter(n => n >= at)).size
}

const bodyValue =(answers, step) => answers?.body?.[YOU_FIELD[step]] ?? null
/** The About-you steps still unanswered, in order. */
export const missingYou = answers => YOU.filter(step => bodyValue(answers, step) === null)
/** All four body answers in: the server works the target out only then (§3b). */
export const bodyComplete = answers => missingYou(answers).length === 0

/**
 * Whether the hub said the person's data already answers what `screen` asks (ux-onboarding §6:
 * "steps already answered by existing data are skipped"): a step it answers in full, or, of About
 * you, a body field it holds. The Plan step too when the profile has routines (openGym would skip
 * a plan there). `server` is state.server; null (not loaded) skips nothing.
 */
export function answeredByData(screen, server) {
  if (!server) return false
  const steps = server.answered || []
  if (screen === 'goal') return steps.includes('goal')
  if (YOU.includes(screen)) return steps.includes('body') || (server.body || []).includes(YOU_FIELD[screen])
  if (screen === 'training' || screen === 'plan') return steps.includes(screen)
  return false
}

// The screen after `screen` by the skip map alone.
function following(screen, answers) {
  switch (screen) {
    case 'invite': return 'name'
    case 'name': return 'passkey'
    case 'passkey': return 'goal'
    case 'goal': return 'sex'
    case 'sex': return 'born'
    case 'born': return 'height'
    case 'height': return 'weight'
    case 'weight': return 'training'
    // 0 days is "just tracking food": no plan to ask about.
    case 'training': return answers?.trainingDays ? 'plan' : 'finish'
    case 'plan': return 'finish'
    case 'starter': return 'finish'
    default: return 'finish'
  }
}

// From `screen` on, the first screen the person's data does not answer.
function firstAsked(screen, answers, server) {
  let at = screen
  while (answeredByData(at, server)) at = following(at, answers)
  return at
}

/**
 * The screen after `screen` once it is answered, past every step the person's data answers. A
 * detour (started from the final step's "Add my details") visits only the steps it lists, then
 * returns to the end.
 */
export function nextAfter(screen, { answers, detour = null, server = null } = {}) {
  if (detour && YOU.includes(screen)) {
    const i = detour.indexOf(screen)
    return i >= 0 && detour[i + 1] ? detour[i + 1] : 'finish'
  }
  return firstAsked(following(screen, answers), answers, server)
}

/** Where the nav's Skip goes: You → Training (or back to the end on a detour), Training and Plan → the end. */
export function skipTarget(screen, { detour = null, answers, server = null } = {}) {
  if (YOU.includes(screen)) return detour ? 'finish' : firstAsked('training', answers, server)
  if (screen === 'training' || screen === 'plan') return 'finish'
  return null
}

/** "Next" on the last step of a detour says Done: it returns to the end. */
export const nextIsDone = (screen, detour) => !!detour && detour[detour.length - 1] === screen

/** The steps a detour from the final step visits: the missing body answers, nothing else. */
export const detourOf = answers => missingYou(answers)

/**
 * Whether the Plan step is still owed: training days asked for, no plan chosen (the AI coach plan
 * is not kept across a reload, and its consent with it, state.js recordOf; one the hub stores
 * comes back as chosen), and no routines in the person's data that make the step moot.
 */
export const planOwed = (answers, server = null) => !!answers?.trainingDays && !answers.plan && !answeredByData('plan', server)

/**
 * The screen to resume at, for a signed-in person: where the hub says (its `next`, from the answers
 * it holds and what the person's data answers), and otherwise the first unanswered step here.
 * `skippedYou` and a training answer of null (skipped) count as answered, so a skip is not asked
 * again; nor is a step the person's data answers.
 */
export function resumeScreen(answers, { skippedYou = false, server = null } = {}) {
  const missing = missingYou(answers).filter(screen => !answeredByData(screen, server))
  switch (server?.next) {
    case 'goal': return 'goal'
    case 'training': return 'training'
    // No training day (the person's, or their data's): the Plan step has nothing to plan, and would
    // only send them back to Training. The end, as the skip map has it.
    case 'plan': return answers?.trainingDays ? 'plan' : 'finish'
    case 'summary': return 'finish'
    // The body: its first field not answered here or in the data; all of them answered here (a
    // save the hub has not taken yet) carries on as below.
    case 'body': if (missing.length) return missing[0]
  }
  if (!answers?.goal) return 'goal'
  if (missing.length && !skippedYou) return missing[0]
  if (answers.trainingDays === undefined) return 'training'
  if (planOwed(answers, server)) return 'plan'
  return 'finish'
}

/**
 * Where Back goes on a cold entry (a reload, a deep link) with nothing of the flow under it:
 * the step before, by the same rules.
 */
export function previousOf(screen, { answers } = {}) {
  switch (screen) {
    case 'name': return 'invite'
    case 'sex': return 'goal'
    case 'born': return 'sex'
    case 'height': return 'born'
    case 'weight': return 'height'
    case 'training': return 'weight'
    case 'plan': return 'training'
    case 'starter': return 'plan'
    case 'finish': return answers?.trainingDays ? 'plan' : 'training'
    default: return null
  }
}
