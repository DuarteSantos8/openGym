// What the onboarding knows so far, and every change a screen can make to it. Pure: the provider
// (components/onboarding/OnboardingLayout.jsx) keeps it in a reducer, mirrors it into session
// storage so a reload resumes, and saves each answered step to the hub.
//
// Whose it is: `uid` is the signed-in person it was made for (null before there is an account).
// A copy kept for another uid is never read back, and before an account exists only the invite
// (code, invite) and the typed name are kept at all: nothing about a body, a goal or a plan is
// written down until there is a person to own it. An AI coach plan is never written down either:
// the consent in it is the tap on the sheet in the session that holds it, not a stored value.
//
// answers.trainingDays: undefined until asked, null when skipped, 0-6 once answered (or known from
//   the person's data, which the hub reads).
// answers.plan: null, or { kind: 'starter', templateId, weekdays, equipment, experience }
//   | { kind: 'coach', experience, equipment, consentVersion, consentAt? } | { kind: 'none' }.
//   consentVersion is the id of the text the hub sent (coachConsent); consentAt is the hub's
//   stamp, there once the hub has stored the choice.
// server: what the hub said at the last load (null until then): the steps the person's data
//   answers in full (`answered`), the body fields it holds (`body`), its `next` and `remaining`.
import { localeUnits } from './units.js'
import { suggestedDays, templateFor } from './plans.js'
import { STORE_KEY, forget } from './session.js'

const BODY_FIELDS = ['sex', 'birthYear', 'heightCm', 'weightKg']

export function initialState(units = localeUnits()) {
  return {
    uid: null,
    code: null,
    invite: null,
    // The name typed on the name step, until the passkey makes it the profile's.
    name: null,
    answers: {
      goal: null,
      body: { sex: null, birthYear: null, heightCm: null, weightKg: null },
      // A mostly seated day until the person says otherwise (§3b: changed on the Summary).
      activity: { value: 'sitting', source: 'default' },
      units,
      trainingDays: undefined,
      plan: null,
    },
    // The Plan step's card on screen ('starter' | 'coach' | 'none'), before it is a plan.
    pick: null,
    // The starter preview's own choices: the weekdays per session, the one selected, the fit.
    starter: null,
    detour: null,
    skippedYou: false,
    // Whether the person answered (or skipped) Training in this tab: then their days stand over
    // the hub's at the next load.
    daysSaid: false,
    // Hub steps whose last save failed: sent again before completing.
    unsaved: [],
    progress: [0, 0, 0],
    // What this server's openGym can take (the hub reads it): null until known.
    coachAvailable: null,
    starterAvailable: null,
    // The AI coach consent text and its id, as the hub sent it (lib/onboarding/consent.js): null
    // until known.
    coachConsent: null,
    server: null,
  }
}

// The hub's consent text, in the shape the coach sheet shows: { version, reads: { one, other }, where }.
const isText = v => typeof v === 'string' && v.length > 0
const consentOf = c => (c && isText(c.version) && c.reads && isText(c.reads.one) && isText(c.reads.other) && isText(c.where)
  ? { version: c.version, reads: { one: c.reads.one, other: c.reads.other }, where: c.where }
  : null)

/**
 * Whether a plan fits `days` training days a week. The hub's rule too (fitness-hub
 * src/onboarding/effective.ts planFits): "no plan" fits anything, the AI coach plans around any
 * number of days from one, a ready-made plan has one session per training day.
 */
export function planFits(plan, days) {
  if (!plan) return true
  if (plan.kind === 'none') return true
  if (plan.kind === 'coach') return (days ?? 0) > 0
  return plan.weekdays?.length === days
}

const withAnswers = (s, patch) => ({ ...s, answers: { ...s.answers, ...patch } })
const unsavedWith = (s, step) => (s.unsaved.includes(step) ? s.unsaved : [...s.unsaved, step])
// The training days changed: a plan that no longer fits them goes, and its card with it.
const withDays = (s, days) => {
  const kept = planFits(s.answers.plan, days ?? 0)
  const next = withAnswers(s, { trainingDays: days, ...(kept ? {} : { plan: null }) })
  return kept ? next : { ...next, pick: null }
}

/** A fresh starter preview for `days`: the plan's own weekdays, the first session selected. */
export const starterFor = (days, prev) => ({
  templateId: templateFor(days),
  weekdays: suggestedDays(days),
  sel: 0,
  experience: prev?.experience || 'new',
  equipment: prev?.equipment || 'gym',
})

// The hub's answers and the person's data under what this tab knows: an answer given here and not
// saved yet stays, the hub's answer comes next, then what the data holds.
function fromHub(s, a) {
  const stored = a.answers || {}
  const data = a.prefill || {}
  const known = (...values) => values.find(v => v !== null && v !== undefined) ?? null
  const body = { ...s.answers.body }
  for (const k of BODY_FIELDS) body[k] = known(body[k], stored.body?.[k], data.body?.[k])
  // The days the person gave in this tab stand. Days that came from the hub (its stored answer,
  // or the person's data) are read again each time: openGym's can change mid-onboarding, and a
  // plan for the old days is one the hub refuses.
  const trainingDays = s.daysSaid ? s.answers.trainingDays
    : stored.trainingDays !== undefined ? stored.trainingDays
      : data.training?.trainingDays !== undefined ? data.training.trainingDays
        : s.answers.trainingDays
  const answers = {
    ...s.answers,
    goal: known(s.answers.goal, stored.goal, data.goal?.goal),
    body,
    activity: s.answers.activity.source === 'default' && stored.activity ? stored.activity : s.answers.activity,
    units: s.answers.units.source === 'locale' && stored.units ? stored.units : s.answers.units,
    trainingDays,
    plan: known(s.answers.plan, stored.plan),
  }
  // A plan that no longer fits the days goes, as when the person changes them.
  if (!planFits(answers.plan, trainingDays ?? 0)) answers.plan = null
  const server = {
    answered: Array.isArray(data.answered) ? data.answered : [],
    body: BODY_FIELDS.filter(k => data.body?.[k] != null),
    next: typeof a.next === 'string' ? a.next : null,
    remaining: Array.isArray(a.remaining) ? a.remaining : null,
  }
  const flag = (value, current) => (typeof value === 'boolean' ? value : current)
  return {
    ...s, answers, server,
    pick: answers.plan ? answers.plan.kind : answers.plan === s.answers.plan ? s.pick : null,
    coachAvailable: flag(a.coachAvailable, s.coachAvailable),
    starterAvailable: flag(a.starterAvailable, s.starterAvailable),
    coachConsent: consentOf(a.coachConsent),
  }
}

export function reduce(s, a) {
  switch (a.type) {
    // A code other than the one kept is another invite: whatever was typed or kept for the earlier
    // one (an abandoned name, its check) is not this one's.
    case 'invite':
      if (a.code !== s.code) return { ...initialState(s.answers.units), uid: s.uid, code: a.code, invite: a.invite ?? null }
      return a.invite && a.invite !== s.invite ? { ...s, invite: a.invite } : s
    case 'name': return { ...s, name: a.name }
    case 'goal': return withAnswers(s, { goal: a.goal })
    case 'body': return withAnswers(s, { body: { ...s.answers.body, [a.field]: a.value } })
    case 'unit': return withAnswers(s, { units: { ...s.answers.units, [a.kind]: a.unit, source: 'user' } })
    case 'training': return s.answers.trainingDays === a.days ? { ...s, daysSaid: true } : { ...withDays(s, a.days), daysSaid: true }
    case 'skipYou': return { ...s, skippedYou: true, detour: null }
    case 'skipTraining': return { ...withDays(s, null), daysSaid: true }
    case 'pick': return { ...s, pick: a.pick }
    case 'starter': return { ...s, starter: { ...(s.starter || starterFor(s.answers.trainingDays)), ...a.patch } }
    case 'plan': return { ...withAnswers(s, { plan: a.plan }), pick: a.plan ? a.plan.kind : null }
    case 'detour': return { ...s, detour: a.steps && a.steps.length ? a.steps : null }
    case 'saved': return { ...s, unsaved: a.ok ? s.unsaved.filter(x => x !== a.step) : unsavedWith(s, a.step) }
    case 'progress': return { ...s, progress: a.progress }
    case 'hub': return fromHub(s, a)
    // Who is signed in changed. Becoming someone from no one (the passkey just made) keeps what
    // was typed before; anyone to anyone else, or to no one, starts over: none of it is theirs.
    case 'user': return s.uid === a.uid ? s : s.uid ? { ...initialState(s.answers.units), uid: a.uid } : { ...s, uid: a.uid }
    case 'reset': return { ...initialState(s.answers.units), uid: s.uid }
    default: throw new Error('unknown onboarding action ' + a.type)
  }
}

// What is written down for `state`. The server's answers are read again, never kept; the AI coach
// plan is not kept (see the top), nor the save still owed for it.
function recordOf(state) {
  if (!state.uid) return { uid: null, code: state.code, invite: state.invite, name: state.name }
  const coach = state.answers.plan?.kind === 'coach'
  return {
    ...state,
    answers: coach ? { ...state.answers, plan: null } : state.answers,
    pick: coach && state.pick === 'coach' ? null : state.pick,
    unsaved: coach ? state.unsaved.filter(step => step !== 'plan') : state.unsaved,
    server: null,
    coachConsent: null,
  }
}

/** The state kept for this browser tab for the person `uid` (null: no one yet), or null. */
export function loadSaved(uid = null, storage = globalThis.sessionStorage) {
  try {
    const v = JSON.parse(storage?.getItem(STORE_KEY) || 'null')
    // A copy made for someone else, or from before copies named their owner, is nobody's here.
    if (!v || typeof v !== 'object' || v.uid !== uid) return null
    if (!uid) return { ...initialState(), code: v.code ?? null, invite: v.invite ?? null, name: v.name ?? null }
    if (!v.answers || !v.answers.body) return null
    // JSON has no undefined: a training step not asked yet comes back absent.
    return recordOf({ ...initialState(), ...v, answers: { ...initialState().answers, ...v.answers } })
  } catch { return null }
}

// What a person gave, as opposed to what the screens and the hub fill in around it.
const ABOUT_THEM = ['code', 'invite', 'name', 'answers', 'pick', 'starter', 'detour', 'skippedYou', 'daysSaid', 'unsaved']
const aboutThem = state => JSON.stringify(ABOUT_THEM.map(k => state[k]))

/** Writes `state` down for this tab; a state with nothing of the person's in it is not kept at all. */
export function save(state, storage = globalThis.sessionStorage) {
  if (aboutThem(state) === aboutThem(initialState(state.answers.units))) { forget(storage); return }
  try { storage?.setItem(STORE_KEY, JSON.stringify(recordOf(state))) } catch { /* private mode: this tab only */ }
}
