// Conditional openGym profile I/O. Never writes state files; never whole-document mergeStates.
// patchFn must be pure and idempotent: reapplying the same requested change to a fresh
// profile must not duplicate records. It receives a clone; never mutate captured inputs.
// Default updateProfile refuses dropped top-level keys and dropped routines/workouts ids.
// `{ allowDelete: true, ids: [...] }` is only for Task 8's confirmed destructive actions. The
// caller must gate it with passkey confirmation. Only the listed ids may disappear from
// routines/workouts; unrelated ids and every top-level non-bookkeeping key must still be there.
const MAX_BYTES = 5 * 1024 * 1024
const TIMEOUT_MS = 10000
const MAX_ATTEMPTS = 5
const META = new Set(['_rev', '_ts', '_wid', '_wids'])

// Only errors built here are ever passed to a caller. Anything else (a stream or fetch failure,
// whose text the upstream controls) is replaced by a fixed message. Not exported on purpose:
// matching on message text would let an upstream error imitate one of ours.
class StoreError extends Error {}

export class ProfileConflictError extends Error {
  constructor(profile) {
    super('profile changed too often; no write performed after retry limit')
    this.name = 'ProfileConflictError'
    this.profile = profile
  }
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function validState(state) {
  // Bookkeeping alone is not a profile; sending it could erase every routine and workout.
  return object(state) && Object.keys(state).some(key => !META.has(key)) &&
    (state.routines == null || Array.isArray(state.routines)) &&
    (state.workouts == null || Array.isArray(state.workouts))
}

function idsOf(list) {
  const ids = new Set()
  if (!Array.isArray(list)) return ids
  for (const entry of list) {
    if (entry && typeof entry === 'object' && typeof entry.id === 'string' && entry.id) ids.add(entry.id)
  }
  return ids
}

function preserves(current, next, target) {
  if (!validState(next)) return false
  for (const key of Object.keys(current)) {
    if (META.has(key)) continue
    if (!Object.hasOwn(next, key)) return false
  }
  for (const list of ['routines', 'workouts']) {
    if (!Array.isArray(current[list])) continue
    if (!Array.isArray(next[list])) return false
    const have = idsOf(next[list])
    for (const id of idsOf(current[list])) if (!have.has(id) && !(target && target.has(id))) return false
  }
  return true
}

// The bytes that go out are what get validated: JSON.stringify drops undefined, functions and
// symbols and runs toJSON, so checking the in-memory object could pass a patch that, once sent,
// has lost a key or an id. The size cap applies to those same bytes, before any request.
function serialize(body, current, target) {
  let text, sent
  try { text = JSON.stringify(body) }
  catch { throw new StoreError('invalid profile patch') }
  if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_BYTES) throw new StoreError('invalid profile patch')
  try { sent = JSON.parse(text).state } catch { throw new StoreError('invalid profile patch') }
  if (!preserves(current, sent, target)) throw new StoreError('invalid profile patch')
  return text
}

function document(data) {
  if (!object(data) || !validState(data.state) || !Number.isSafeInteger(data.rev) || data.rev < 0) {
    throw new StoreError('invalid profile from upstream')
  }
  return { state: data.state, rev: data.rev }
}

async function request(apiBase, bearer, path, method = 'GET', body) {
  if (typeof bearer !== 'string' || !bearer || /[\r\n]/.test(bearer)) throw new TypeError('invalid bearer')
  let response
  try {
    response = await fetch(`${apiBase}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${bearer}`, accept: 'application/json',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body } : {}),
      redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    throw new StoreError('profile upstream unavailable')
  }
  try {
    if (response.status !== 200 && !(method === 'PUT' && response.status === 409)) {
      await response.body?.cancel().catch(() => {})
      throw new StoreError(`profile upstream status ${response.status}`)
    }
    const chunks = []
    let size = 0
    if (response.body) {
      const reader = response.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.length
        if (size > MAX_BYTES) {
          await reader.cancel().catch(() => {})
          throw new StoreError('profile upstream response too large')
        }
        chunks.push(value)
      }
    }
    let data
    try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')) }
    catch { throw new StoreError('invalid profile upstream response') }
    if (!object(data)) throw new StoreError('invalid profile upstream response')
    return { status: response.status, data }
  } catch (error) {
    if (error instanceof StoreError) throw error
    throw new StoreError('profile upstream unavailable')
  }
}

export function createProfileStore({ apiBase } = {}) {
  if (typeof apiBase !== 'string' || !apiBase) throw new TypeError('apiBase required')
  const pending = new Map()
  const call = (bearer, path, method, body) => request(apiBase, bearer, path, method, body)
  const fetchDocument = async bearer => document((await call(bearer, '/api/data')).data)

  async function readProfile(bearer) {
    return (await fetchDocument(bearer)).state
  }

  async function update(bearer, patchFn, options) {
    if (typeof patchFn !== 'function') throw new TypeError('patchFn required')
    const ids = options && options.allowDelete === true && Array.isArray(options.ids) ? options.ids : null
    const target = ids && ids.length && ids.every(id => typeof id === 'string' && id) ? new Set(ids) : null
    if (options && options.allowDelete === true && !target) throw new StoreError('invalid profile patch')
    let current = await fetchDocument(bearer)
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const state = patchFn(structuredClone(current.state))
      if (!preserves(current.state, state, target)) throw new StoreError('invalid profile patch')
      const body = { state, baseRev: current.rev }
      if (typeof current.state._wid === 'string') body.baseWid = current.state._wid
      const reply = await call(bearer, '/api/data', 'PUT', serialize(body, current.state, target))
      if (reply.status === 409) {
        if (reply.data.error !== 'conflict') throw new StoreError('invalid profile conflict response')
        current = document(reply.data)
        continue
      }
      const check = (await call(bearer, '/api/data/rev')).data
      if (!Number.isSafeInteger(check.rev) || check.rev < 0 || (check.wid != null && typeof check.wid !== 'string')) {
        throw new StoreError('invalid profile revision response')
      }
      // PUT rev can lag disk by 1 after stampPut. Never reuse it as baseRev; refetch.
      return (await fetchDocument(bearer)).state
    }
    throw new ProfileConflictError(current.state)
  }

  function updateProfile(bearer, patchFn, options) {
    const earlier = pending.get(bearer)
    const work = (earlier || Promise.resolve()).then(() => update(bearer, patchFn, options))
    const tail = work.catch(() => {})
    pending.set(bearer, tail)
    void tail.then(() => { if (pending.get(bearer) === tail) pending.delete(bearer) })
    return work
  }

  return { readProfile, updateProfile }
}
