import crypto from 'node:crypto'
import { openBearer, mintLoginOptions, verifyFreshPasskey } from './openGymSession.js'

const ID = /^[A-Za-z0-9_-]{43}$/
const TTL = 5 * 60_000
const hash = value => crypto.createHash('sha256').update(value).digest('base64url')
const invalid = () => { throw new ConfirmationError() }

export class ConfirmationError extends Error {
  constructor() { super('invalid_confirmation'); this.name = 'ConfirmationError' }
}

// Hash the complete record, not only the visible name: a changed exercise, set, or attachment
// must force a new confirmation. Never send the target itself to the browser.
function targetOf(profile, type, id) {
  const list = type === 'delete-routine' ? profile.routines : profile.workouts
  if (!Array.isArray(list)) invalid()
  const found = list.filter(item => item && item.id === id)
  if (found.length !== 1) invalid()
  const target = found[0]
  let digest
  try { digest = hash(JSON.stringify(target)) } catch { invalid() }
  if (typeof target.name !== 'string' || !target.name || target.name.length > 200) invalid()
  const exercises = Array.isArray(target.ex) ? target.ex.length : Array.isArray(target.entries) ? target.entries.length : 0
  const media = Array.isArray(target.media) && target.media.length > 0
  return {
    digest,
    summary: { type, id, name: target.name, ...(typeof target.d === 'string' && target.d && target.d.length <= 200 ? { date: target.d } : {}),
      effect: type === 'delete-routine' ? `Removes this routine and ${exercises} planned exercise${exercises === 1 ? '' : 's'}.` : `Removes this logged workout, its ${exercises} exercise${exercises === 1 ? '' : 's'}${media ? ', and its linked photos or videos' : ''}.` },
  }
}

function pickSummary(summary) {
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) invalid()
  const out = {}
  for (const key of ['type', 'id', 'name', 'date', 'effect']) {
    const value = summary[key]
    if (value == null) continue
    if (typeof value !== 'string' || !value || value.length > 200) invalid()
    out[key] = value
  }
  if (!out.type || !out.id) invalid()
  return out
}

function deleteTarget(profile, type, id, digest) {
  if (targetOf(profile, type, id).digest !== digest) invalid()
  if (type === 'delete-workout') {
    profile.workouts = profile.workouts.filter(w => w.id !== id)
  } else {
    profile.routines = profile.routines.filter(r => r.id !== id)
    for (const day of Object.keys(profile.week || {})) {
      const values = Array.isArray(profile.week[day]) ? profile.week[day] : [profile.week[day]]
      if (!values.includes(id)) continue
      const kept = values.filter(value => value !== id)
      if (kept.length) profile.week[day] = kept; else delete profile.week[day]
    }
    for (const day of Object.keys(profile.dayPlan || {})) if (profile.dayPlan[day] === id) delete profile.dayPlan[day]
  }
  return profile
}

export function createConfirmations({ connections, key, apiBase, origin, prefix, store, now = Date.now, executors = {} } = {}) {
  if (!connections || typeof connections.get !== 'function' || !store || typeof store.readProfile !== 'function' ||
    typeof store.updateProfile !== 'function' || typeof origin !== 'string' || !origin || typeof prefix !== 'string') throw new TypeError('confirmation dependencies required')
  const pending = new Map(), latest = new Map()
  const time = () => typeof now === 'function' ? now() : now
  const types = new Set(['delete-routine', 'delete-workout', ...Object.keys(executors)])
  const opKey = (connId, type, targetId) => JSON.stringify([connId, type, targetId])
  function sweep() {
    const t = time()
    for (const [h, rec] of pending) {
      if (rec.exp <= t) {
        pending.delete(h)
        if (latest.get(rec.key) === h) latest.delete(rec.key)
      }
    }
  }
  function trusted(connId, userId) {
    const conn = connections.get(connId)
    if (!conn || conn.userId !== userId) invalid()
    try { return openBearer(conn.sealed, key, userId) } catch { invalid() }
  }
  function lookup(id) {
    sweep()
    if (typeof id !== 'string' || !ID.test(id)) invalid()
    const h = hash(id), rec = pending.get(h)
    if (!rec || rec.exp <= time() || latest.get(rec.key) !== h) { pending.delete(h); invalid() }
    trusted(rec.connId, rec.userId)
    return { h, rec }
  }
  // Built-in deletes act only on the caller's own profile, which the bearer already scopes. An
  // injected executor can reach other people's data (Task 9 admin actions), so it must prove the
  // stored caller may act on this exact target. Only `true` passes; missing, false, throwing or
  // truthy-but-not-true all fail closed. The caller never supplies an admin flag: the executor gets
  // the stored user ID and bearer and must ask upstream itself.
  async function gate(type, userId, bearer, targetId) {
    if (type === 'delete-routine' || type === 'delete-workout') return
    const executor = executors[type]
    if (!executor || typeof executor.authorize !== 'function' || typeof executor.inspect !== 'function' || typeof executor.execute !== 'function') invalid()
    let ok
    try { ok = await executor.authorize({ userId, bearer }, targetId) } catch { invalid() }
    if (ok !== true) invalid()
  }
  async function requestConfirmation(action, connId) {
    sweep()
    if (!action || typeof action !== 'object' || Array.isArray(action) ||
      !types.has(action.type) || typeof action.targetId !== 'string' || !action.targetId || action.targetId.length > 200 ||
      typeof connId !== 'string') invalid()
    const conn = connections.get(connId)
    if (!conn || typeof conn.userId !== 'string' || !conn.userId) invalid()
    const type = action.type, targetId = action.targetId, key = opKey(connId, type, targetId)
    await gate(type, conn.userId, trusted(connId, conn.userId), targetId)
    // Nothing below awaits: the connection is re-checked and the record minted in one step, so a
    // revoked connection or a sweep during authorize cannot leave a pending record behind.
    sweep()
    trusted(connId, conn.userId)
    const previous = latest.get(key)
    if (previous) pending.delete(previous)
    let id, h
    do { id = crypto.randomBytes(32).toString('base64url'); h = hash(id) } while (pending.has(h))
    latest.set(key, h)
    pending.set(h, { connId, userId: conn.userId, type, targetId, key, exp: time() + TTL })
    return { url: `${origin}${prefix}/confirm#${id}` }
  }
  async function inspect(rec, bearer) {
    try {
      if (rec.type === 'delete-routine' || rec.type === 'delete-workout') return targetOf(await store.readProfile(bearer), rec.type, rec.targetId)
      // Authorize first: a withdrawn right must not even let the page read the target.
      await gate(rec.type, rec.userId, bearer, rec.targetId)
      return await executors[rec.type].inspect({ userId: rec.userId, bearer }, rec.targetId)
    } catch (e) { if (e instanceof ConfirmationError) throw e; invalid() }
  }
  async function details(id) {
    const { h, rec } = lookup(id)
    if (rec.issuing) invalid()
    const result = await inspect(rec, trusted(rec.connId, rec.userId))
    if (pending.get(h) !== rec || latest.get(rec.key) !== h || rec.exp <= time()) invalid()
    if (!result || typeof result.digest !== 'string' || !result.digest) invalid()
    const summary = pickSummary(result.summary)
    if (rec.digest && rec.digest !== result.digest) { pending.delete(h); invalid() }
    rec.digest = result.digest
    return { summary, digest: result.digest }
  }
  async function challenge(id) {
    const { h, rec } = lookup(id)
    if (!rec.digest || rec.issuing) invalid()
    rec.issuing = true // before the upstream await: two clicks never share a challenge
    try {
      const answer = await mintLoginOptions({ apiBase })
      if (pending.get(h) !== rec || latest.get(rec.key) !== h || rec.exp <= time()) invalid()
      trusted(rec.connId, rec.userId)
      rec.challenge = { cid: answer.cid, value: answer.options.challenge }
      return answer
    } catch (e) {
      pending.delete(h)
      if (e instanceof ConfirmationError) throw e
      invalid()
    } finally { rec.issuing = false }
  }
  async function confirm(id, proof) {
    const { h, rec } = lookup(id)
    pending.delete(h) // synchronous, before verification, fetching, or any other await
    if (!rec.digest || !rec.challenge || rec.issuing) invalid()
    const { user } = await verifyFreshPasskey(proof, { apiBase, origin, challenge: rec.challenge.value, cid: rec.challenge.cid })
      .catch(() => invalid())
    if (user.id !== rec.userId || latest.get(rec.key) !== h || rec.exp <= time()) invalid()
    const bearer = trusted(rec.connId, rec.userId)
    const current = await inspect(rec, bearer)
    if (!current || current.digest !== rec.digest || latest.get(rec.key) !== h || rec.exp <= time()) invalid()
    trusted(rec.connId, rec.userId)
    try {
      if (rec.type === 'delete-routine' || rec.type === 'delete-workout') {
        // updateProfile re-applies this check to each fresh snapshot, including every 409 retry.
        await store.updateProfile(bearer, profile => {
          if (latest.get(rec.key) !== h || rec.exp <= time()) invalid()
          trusted(rec.connId, rec.userId)
          return deleteTarget(profile, rec.type, rec.targetId, rec.digest)
        }, { allowDelete: true, ids: [rec.targetId] })
        return { deleted: { type: rec.type, id: rec.targetId } }
      }
      // Admin rights and target state can change after the page was shown and after the passkey
      // tap: ask again, with the stored user and a freshly opened bearer, right before executing.
      const live = trusted(rec.connId, rec.userId)
      await gate(rec.type, rec.userId, live, rec.targetId)
      if (latest.get(rec.key) !== h || rec.exp <= time()) invalid()
      return await executors[rec.type].execute({ userId: rec.userId, bearer: trusted(rec.connId, rec.userId) }, rec.targetId, rec.digest)
    } catch (e) { if (e instanceof ConfirmationError) throw e; invalid() }
  }
  return { requestConfirmation, details, challenge, confirm, pending }
}

// Task 10 will expose these handlers over MCP. This factory deliberately takes a trusted
// connection ID, never a caller-provided user ID or a browser assertion.
export function createDestructiveTools(confirmations) {
  return [
    ['delete_routine', 'delete-routine'], ['delete_workout', 'delete-workout'], ['disable_account', 'disable-account'],
  ].map(([name, type]) => ({ name, handler: (connectionId, { id } = {}) => confirmations.requestConfirmation({ type, targetId: id }, connectionId) }))
}
