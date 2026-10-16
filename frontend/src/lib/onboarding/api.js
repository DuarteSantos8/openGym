// The onboarding's server side, as the browser reaches it.
//
//   GET  /hub/api/invite/{code}         the invite check, which never uses the invite up: the hub's
//                                       own route (no-referrer, the code templated out of its logs,
//                                       limited per address) in front of openGym's. { status,
//                                       inviterName, suggestedName }; 404 with status 'invalid' for
//                                       a code that is not one; 429 and 503: no answer for now.
//   GET  /api/me                       whether the new passkey is synced (user.synced)
//   GET  /hub/api/onboarding            where the person is: { answers, completedAt, next, remaining,
//                                       prefill, coachAvailable, starterAvailable, coachConsent,
//                                       delivery, plan }. `plan` { status: 'refused' }: openGym
//                                       refused the plan after completing (lib/onboarding/use-plan-refused.js).
//   PUT  /hub/api/onboarding            one step's answers: { step, answers } (answers null: skipped)
//   POST /hub/api/onboarding/preview    the daily targets from the answers so far
//   POST /hub/api/onboarding/complete   both apps written, once: { today }. 409 `plan-unavailable`:
//                                       the plan chosen is one this server cannot take; ask again.
//
// Every PUT and POST names the person it was composed for (X-Expected-User, the uid the answers
// belong to). A save queued under one account can reach the hub after another signed in; the hub
// then refuses it, 409 `wrong-user`, and the caller drops it: it belongs to the person before.
// A 429 is `busy` (the hub's per-person limit): the answers stand, and `retryAfter` is the seconds
// the hub asked to wait.
//
// The hub routes are written to the contract of fitness-eval ux-onboarding.md §3b: the body's four
// answers each optional, activity and units with their source, trainingDays 0-6 or null, the plan a
// union of starter | coach | none (the coach as a consent to a text by its id, the time the hub's),
// and on GET what the person's data answers and which plans this server takes. Where the hub
// answers otherwise the call fails and the screens say so; nothing here makes an answer up.
import { api } from '../api.js'
import { appBase } from '../app-base.js'

const HUB = '/hub/api/onboarding'
const INVITE = '/hub/api/invite/'
const TIMEOUT_MS = 20000
// The refusals a screen acts on; any other is 'http'.
const KNOWN_CODES = ['complete', 'plan-unavailable', 'wrong-user']
const BODY_FIELDS = ['sex', 'birthYear', 'heightCm', 'weightKg']
const EXPECTED_USER = 'X-Expected-User'
// No wait longer than this is honoured, and a 429 that names none waits this long.
const MAX_WAIT_S = 60
const DEFAULT_WAIT_S = 5

const failure = (message, status, code, data = null, retryAfter = null) =>
  Object.assign(new Error(message), { status, code, data, retryAfter })

// Retry-After as whole seconds to wait (delta-seconds or an HTTP date), or null when it names none.
function retryAfterOf(res) {
  const raw = res.headers?.get?.('retry-after')
  if (!raw) return null
  const seconds = /^\d+$/.test(raw) ? Number(raw) : (Date.parse(raw) - Date.now()) / 1000
  return Number.isFinite(seconds) ? Math.min(MAX_WAIT_S, Math.max(0, Math.ceil(seconds))) : null
}

/** The seconds to wait after a 429: what the hub asked, or a short default. */
export const waitSeconds = e => e?.retryAfter ?? DEFAULT_WAIT_S

// Same origin, the openGym session cookie: the hub checks both itself. No referrer: an invite
// code is in the address, and this is the app's own server, which needs none. `expectedUser`: the
// person a write was composed for.
async function hub(method, path, body, expectedUser = null) {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
  let res
  try {
    res = await fetch(appBase().replace(/\/$/, '') + path, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(expectedUser ? { [EXPECTED_USER]: expectedUser } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctl.signal,
    })
  } catch {
    throw failure('no answer', 0, ctl.signal.aborted ? 'timeout' : 'offline')
  } finally {
    clearTimeout(timer)
  }
  let data = null
  try { data = await res.json() } catch { data = null }
  if (res.status === 429) throw failure('busy', 429, 'busy', data, retryAfterOf(res))
  if (!res.ok) throw failure(data?.error || `HTTP ${res.status}`, res.status, KNOWN_CODES.includes(data?.code) ? data.code : 'http', data)
  if (!data || typeof data !== 'object') throw failure('not JSON', res.status, 'bad-response')
  return data
}

/**
 * The invite landing's check: { status: 'valid'|'used'|'revoked'|'expired'|'invalid', inviterName,
 * suggestedName }. A code the server does not know is 'invalid'; no answer at all throws
 * ({ code: 'unavailable' }) so the landing can offer to try again.
 */
export async function checkInvite(code) {
  try {
    const found = await hub('GET', INVITE + encodeURIComponent(code))
    return { status: found.status, inviterName: found.inviterName ?? null, suggestedName: found.suggestedName ?? null }
  } catch (e) {
    // Only the hub's own "not an invite" is invalid: any other 404 is no hub here, or a path
    // something else answered.
    if (e.status === 404 && e.data?.status === 'invalid') return { status: 'invalid', inviterName: null, suggestedName: null }
    throw failure(e.message, e.status || 0, 'unavailable')
  }
}

/** Whether the profile's passkeys sync (true), stay on this device (false), or it is not known (null). */
export async function passkeySynced() {
  try {
    const me = await api('/api/me')
    return typeof me.user?.synced === 'boolean' ? me.user.synced : null
  } catch { return null }
}

// The body as the screens hold it: the four answers given, the day and the units with their source.
function bodyOf(answers) {
  const out = {}
  for (const k of BODY_FIELDS) if (answers.body[k] != null) out[k] = answers.body[k]
  return { ...out, activity: answers.activity, units: answers.units }
}

// The plan as the hub takes it: the AI coach as a consent to the text shown, by the id the hub
// sent with it, and never a time (the hub stamps it, and a stored choice it sends back carries its
// stamp).
function planOf(plan) {
  if (plan?.kind !== 'coach') return plan
  return { kind: 'coach', experience: plan.experience ?? null, equipment: plan.equipment, consent: true, consentVersion: plan.consentVersion }
}

/**
 * One step's answers as the hub takes them (§3b). Body answers not given are left out, and a body
 * with nothing the person said (no answer, the assumed day and units) is a skip: null.
 */
export function stepAnswers(step, answers) {
  switch (step) {
    case 'goal': return { goal: answers.goal }
    case 'body': {
      const said = BODY_FIELDS.some(k => answers.body[k] != null) || answers.activity.source === 'user' || answers.units.source === 'user'
      return said ? bodyOf(answers) : null
    }
    case 'training': return { trainingDays: answers.trainingDays ?? null }
    case 'plan': return planOf(answers.plan)
    default: throw new Error('unknown onboarding step ' + step)
  }
}

/** The hub's stored answers (step → the body PUT sent) back into the screens' answers. */
export function answersFromHub(stored) {
  const out = {}
  if (!stored || typeof stored !== 'object') return out
  const { goal, body, training, plan } = stored
  if (goal && typeof goal.goal === 'string') out.goal = goal.goal
  if (body && typeof body === 'object') {
    out.body = {}
    for (const k of BODY_FIELDS) out.body[k] = body[k] ?? null
    if (body.activity) out.activity = body.activity
    if (body.units) out.units = body.units
  }
  if (training && 'trainingDays' in training) out.trainingDays = training.trainingDays
  if (plan && typeof plan.kind === 'string') out.plan = plan
  return out
}

export const loadOnboarding = () => hub('GET', HUB)
// `uid` on each write: the signed-in person the answers belong to (state.uid).
export const saveStep = (step, answers, uid) => hub('PUT', HUB, { step, answers: stepAnswers(step, answers) }, uid)

/** { ready: true, targets: { calories, … } } | { ready: false, missing } from the answers on screen. */
export const previewTargets = (answers, uid) => hub('POST', HUB + '/preview', {
  ...(answers.goal ? { goal: stepAnswers('goal', answers) } : {}),
  body: bodyOf(answers),
  ...(answers.trainingDays !== undefined ? { training: stepAnswers('training', answers) } : {}),
}, uid)

/** Completes the onboarding on the person's own date. */
export const completeOnboarding = (today, uid) => hub('POST', HUB + '/complete', { today }, uid)
