import crypto from 'node:crypto'
import { openBearer, mintLoginOptions, verifyFreshPasskey } from './openGymSession.js'
import { validateBulkSelection, resolveBulkTargets, deleteTargets, bulkDigest, BulkLimitError } from './bulkDelete.js'

const ID = /^[A-Za-z0-9_-]{43}$/
const TTL = 5 * 60_000
const MAX_PARAMS_BYTES = 4096
const MAX_INPUT_BYTES = 4096
const MAX_ROWS_BYTES = 8192
const hash = value => crypto.createHash('sha256').update(value).digest('base64url')
const invalid = () => { throw new ConfirmationError() }
const str = (value, max) => (typeof value === 'string' && value.length >= 1 && value.length <= max ? value : null)
const plain = value => !!value && typeof value === 'object' && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
const deepFreeze = value => {
  if (value && typeof value === 'object') for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

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

// Bulk actions list their targets as explicit rows (the page renders one element each), never
// folded into `effect`. Only id/name/date cross: no other field of the upstream record.
function pickRows(rows) {
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 25) invalid()
  const out = rows.map(row => {
    if (!plain(row) || Object.keys(row).some(k => k !== 'id' && k !== 'name' && k !== 'date')) invalid()
    const id = str(row.id, 200), name = str(row.name, 200), date = row.date === undefined ? undefined : str(row.date, 200)
    if (!id || !name || date === null) invalid()
    return date ? { id, name, date } : { id, name }
  })
  if (Buffer.byteLength(JSON.stringify(out)) > MAX_ROWS_BYTES) invalid()
  return out
}

// A Coach credential review carries the provider's capability flags as upstream reports them, so
// the page can offer only the credential types the provider takes. Booleans only, no other field.
const pickCoach = coach => {
  if (!plain(coach) || typeof coach.id !== 'string' || !coach.id || coach.id.length > 40 ||
    typeof coach.label !== 'string' || !coach.label || coach.label.length > 80 ||
    ['connected', 'apiKey', 'setupToken', 'deviceLogin'].some(k => typeof coach[k] !== 'boolean') ||
    !(coach.apiKey || coach.setupToken)) invalid()
  return { id: coach.id, label: coach.label, connected: coach.connected, apiKey: coach.apiKey, setupToken: coach.setupToken, deviceLogin: coach.deviceLogin }
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
  if (summary.provider != null) out.provider = pickCoach(summary.provider)
  if (summary.rows != null) out.rows = pickRows(summary.rows)
  if (summary.total != null) {
    if (!out.rows || !Number.isSafeInteger(summary.total) || summary.total < out.rows.length) invalid()
    out.total = summary.total
  }
  return out
}

// A one-time secret (e.g. a temporary password) goes to the browser in the execute response only.
// It is never stored, so a lost response cannot be recovered: the action has to be requested again.
function pickReveal(reveal) {
  if (!plain(reveal)) invalid()
  const label = str(reveal.label, 80), value = str(reveal.value, 200)
  if (!label || !value || (reveal.expires !== undefined && !Number.isFinite(reveal.expires))) invalid()
  return reveal.expires === undefined ? { label, value } : { label, value, expires: reveal.expires }
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
  async function gate(type, userId, bearer, targetId, params) {
    if (type === 'delete-routine' || type === 'delete-workout') return
    const executor = executors[type]
    if (!executor || typeof executor.authorize !== 'function' || typeof executor.inspect !== 'function' || typeof executor.execute !== 'function') invalid()
    let ok
    try { ok = await executor.authorize({ userId, bearer }, targetId, params) } catch (e) { if (e instanceof BulkLimitError) throw e; invalid() }
    if (ok !== true) invalid()
  }
  // Closed params: only an executor that declares a `params(raw)` validator takes any, and it always
  // runs (raw may be undefined) so it can demand them. Its answer must be a plain JSON object; we keep
  // a frozen JSON copy, so nothing the caller or validator still holds can change it afterwards.
  function closedParams(type, raw) {
    const validator = type !== 'delete-routine' && type !== 'delete-workout' && executors[type] && executors[type].params
    if (typeof validator !== 'function') { if (raw !== undefined) invalid(); return undefined }
    try {
      const value = validator(raw)
      if (!plain(value)) invalid()
      const text = JSON.stringify(value)
      if (Buffer.byteLength(text) > MAX_PARAMS_BYTES) invalid()
      return deepFreeze(JSON.parse(text))
    } catch (e) { if (e instanceof BulkLimitError) throw e; invalid() }
  }
  // Browser-only input, same closed contract as params: only an executor that declares an
  // `input(raw)` validator takes any, and it always runs (raw may be undefined). Only the
  // connect-coach executor declares one: it validates the credential the admin typed in the
  // browser, never the chat arguments. Nothing is retained on the pending record.
  function closedInput(type, raw) {
    const validator = executors[type] && executors[type].input
    if (typeof validator !== 'function') { if (raw !== undefined) invalid(); return undefined }
    try {
      const value = validator(raw)
      if (!plain(value)) invalid()
      const text = JSON.stringify(value)
      if (Buffer.byteLength(text) > MAX_INPUT_BYTES) invalid()
      return deepFreeze(JSON.parse(text))
    } catch { invalid() }
  }
  async function requestConfirmation(action, connId) {
    sweep()
    if (!action || typeof action !== 'object' || Array.isArray(action) ||
      !types.has(action.type) || typeof action.targetId !== 'string' || !action.targetId || action.targetId.length > 200 ||
      typeof connId !== 'string') invalid()
    const conn = connections.get(connId)
    if (!conn || typeof conn.userId !== 'string' || !conn.userId) invalid()
    // The superseding key stays (connection, type, target): newer params replace an older link.
    const type = action.type, targetId = action.targetId, key = opKey(connId, type, targetId)
    const params = closedParams(type, action.params)
    await gate(type, conn.userId, trusted(connId, conn.userId), targetId, params)
    // Bulk links bind the entire target snapshot before being handed to chat. Legacy executors
    // keep their existing details-time binding; the bulk executor alone opts in.
    let digest
    if (executors[type]?.freezeAtMint === true) {
      let result
      try { result = await executors[type].inspect({ userId: conn.userId, bearer: trusted(connId, conn.userId) }, targetId, params) } catch { invalid() }
      if (!result || typeof result.digest !== 'string' || !result.digest) invalid()
      pickSummary(result.summary)
      digest = result.digest
    }
    // Nothing below awaits: the connection is re-checked and the record minted in one step, so a
    // revoked connection or a sweep during authorize cannot leave a pending record behind.
    sweep()
    trusted(connId, conn.userId)
    const previous = latest.get(key)
    if (previous) pending.delete(previous)
    let id, h
    do { id = crypto.randomBytes(32).toString('base64url'); h = hash(id) } while (pending.has(h))
    latest.set(key, h)
    pending.set(h, { connId, userId: conn.userId, type, targetId, params, digest, key, exp: time() + TTL })
    return { url: `${origin}${prefix}/confirm#${id}` }
  }
  async function inspect(rec, bearer) {
    try {
      if (rec.type === 'delete-routine' || rec.type === 'delete-workout') return targetOf(await store.readProfile(bearer), rec.type, rec.targetId)
      // Authorize first: a withdrawn right must not even let the page read the target.
      await gate(rec.type, rec.userId, bearer, rec.targetId, rec.params)
      return await executors[rec.type].inspect({ userId: rec.userId, bearer }, rec.targetId, rec.params)
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
    // Browser-only input is validated before the pending record is spent: a malformed credential
    // costs nothing and cannot consume the one execution.
    const coachInput = closedInput(rec.type, proof && typeof proof === 'object' ? proof.coach : undefined)
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
      await gate(rec.type, rec.userId, live, rec.targetId, rec.params)
      if (latest.get(rec.key) !== h || rec.exp <= time()) invalid()
      const result = await executors[rec.type].execute({ userId: rec.userId, bearer: trusted(rec.connId, rec.userId) }, rec.targetId, rec.digest, rec.params, coachInput)
      return result && typeof result === 'object' && result.reveal !== undefined ? { ...result, reveal: pickReveal(result.reveal) } : result
    } catch (e) { if (e instanceof ConfirmationError) throw e; invalid() }
  }
  return { requestConfirmation, details, challenge, confirm, pending }
}

// The link stores only selection, never a profile. Inspect and execute re-read through the same
// bearer-scoped store; updateProfile's 409 retry re-applies the snapshot check before every PUT.
export function createBulkExecutors({ store, today } = {}) {
  if (!store || typeof store.readProfile !== 'function' || typeof store.updateProfile !== 'function') throw new TypeError('bulk store required')
  return Object.fromEntries(['routines', 'workouts'].map(kind => {
    const type = `delete-${kind}-bulk`
    const chosen = params => {
      if (!params || !params.selection) throw new ConfirmationError()
      const selection = validateBulkSelection(params.selection, { today })
      if (selection.kind !== kind) throw new ConfirmationError()
      return selection
    }
    const current = (profile, selection) => {
      const { ids, digests, summary } = resolveBulkTargets(profile, selection, { today })
      return { ids, digests, summary, digest: bulkDigest(kind, selection, digests) }
    }
    return [type, {
      freezeAtMint: true,
      params: raw => {
        if (!plain(raw) || Object.keys(raw).length !== 1 || !Object.hasOwn(raw, 'selection')) throw new ConfirmationError()
        return { selection: chosen(raw) }
      },
      authorize: async ({ bearer }, id, params) => {
        if (id !== 'bulk') return false
        // Resolve before minting: unknown IDs and zero or 26 date matches never get a link.
        current(await store.readProfile(bearer), chosen(params))
        return true
      },
      inspect: async ({ bearer }, id, params) => {
        if (id !== 'bulk') throw new ConfirmationError()
        const selection = chosen(params)
        const { summary, digest } = current(await store.readProfile(bearer), selection)
        const noun = kind === 'routines' ? 'routines' : 'workouts'
        const scope = kind === 'routines' ? 'routines' : 'days'
        const media = summary.mediaCount
        return { digest, summary: { type, id, name: `${summary.total} ${noun}`, total: summary.total, rows: summary.rows,
          effect: `Irreversibly deletes ${summary.total} ${noun} across ${summary.affected} ${scope} and ${media} linked photo${media === 1 ? '' : 's'} or video${media === 1 ? '' : 's'}.` } }
      },
      execute: async ({ bearer }, id, digest, params) => {
        if (id !== 'bulk') throw new ConfirmationError()
        const selection = chosen(params)
        const frozen = current(await store.readProfile(bearer), selection)
        if (frozen.digest !== digest) throw new ConfirmationError()
        await store.updateProfile(bearer, profile => {
          let live
          try { live = current(profile, selection) } catch { throw new ConfirmationError() }
          if (live.digest !== digest) throw new ConfirmationError()
          return deleteTargets(profile, kind, frozen.ids, frozen.digests)
        }, { allowDelete: true, ids: frozen.ids })
        return { deleted: { type, count: frozen.ids.length } }
      },
    }]
  }))
}

// Task 10 will expose these handlers over MCP. This factory deliberately takes a trusted
// connection ID, never a caller-provided user ID or a browser assertion.
export function createDestructiveTools(confirmations) {
  return [
    ['delete_routine', 'delete-routine'], ['delete_workout', 'delete-workout'], ['disable_account', 'disable-account'],
  ].map(([name, type]) => ({ name, handler: (connectionId, { id } = {}) => confirmations.requestConfirmation({ type, targetId: id }, connectionId) }))
}

// Link only: the selection travels as closed params and is resolved against the caller's profile
// inside the confirmation gate, never executed here.
export function createBulkTools(confirmations) {
  const selection = (kind, { ids, before } = {}) => ({ kind, ...(ids !== undefined ? { ids } : {}), ...(before !== undefined ? { before } : {}) })
  return [
    ['delete_routines_bulk', 'routines'], ['delete_workouts_bulk', 'workouts'],
  ].map(([name, kind]) => ({ name, handler: (connectionId, args) => confirmations.requestConfirmation({ type: `delete-${kind}-bulk`, targetId: 'bulk', params: { selection: selection(kind, args) } }, connectionId) }))
}
