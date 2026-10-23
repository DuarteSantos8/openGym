// Conditional openGym profile I/O. Never writes state files; never whole-document mergeStates.
// patchFn must be pure and idempotent: reapplying the same requested change to a fresh
// profile must not duplicate records. It receives a clone; never mutate captured inputs.
const MAX_RESPONSE = 5 * 1024 * 1024
const TIMEOUT_MS = 10000
const MAX_ATTEMPTS = 5
const META = new Set(['_rev', '_ts', '_wid', '_wids'])

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

function document(data) {
  if (!object(data) || !validState(data.state) || !Number.isSafeInteger(data.rev) || data.rev < 0) {
    throw new Error('invalid profile from upstream')
  }
  return { state: data.state, rev: data.rev }
}

async function request(apiBase, bearer, path, method = 'GET', payload) {
  if (typeof bearer !== 'string' || !bearer || /[\r\n]/.test(bearer)) throw new TypeError('invalid bearer')
  let response
  try {
    response = await fetch(`${apiBase}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${bearer}`, accept: 'application/json',
        ...(payload ? { 'content-type': 'application/json' } : {}),
      },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
      redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    throw new Error('profile upstream unavailable')
  }
  if (response.status !== 200 && !(method === 'PUT' && response.status === 409)) {
    await response.body?.cancel().catch(() => {})
    throw new Error(`profile upstream status ${response.status}`)
  }
  const chunks = []
  let size = 0
  if (response.body) {
    const reader = response.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > MAX_RESPONSE) {
        await reader.cancel().catch(() => {})
        throw new Error('profile upstream response too large')
      }
      chunks.push(value)
    }
  }
  let data
  try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  catch { throw new Error('invalid profile upstream response') }
  if (!object(data)) throw new Error('invalid profile upstream response')
  return { status: response.status, data }
}

export function createProfileStore({ apiBase } = {}) {
  if (typeof apiBase !== 'string' || !apiBase) throw new TypeError('apiBase required')
  const pending = new Map()
  const call = (bearer, path, method, body) => request(apiBase, bearer, path, method, body)
  const fetchDocument = async bearer => document((await call(bearer, '/api/data')).data)

  async function readProfile(bearer) {
    return (await fetchDocument(bearer)).state
  }

  async function update(bearer, patchFn) {
    if (typeof patchFn !== 'function') throw new TypeError('patchFn required')
    let current = await fetchDocument(bearer)
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const state = patchFn(structuredClone(current.state))
      if (!validState(state)) throw new Error('invalid profile patch')
      const body = { state, baseRev: current.rev }
      if (typeof current.state._wid === 'string') body.baseWid = current.state._wid
      const reply = await call(bearer, '/api/data', 'PUT', body)
      if (reply.status === 409) {
        if (reply.data.error !== 'conflict') throw new Error('invalid profile conflict response')
        current = document(reply.data)
        continue
      }
      const check = (await call(bearer, '/api/data/rev')).data
      if (!Number.isSafeInteger(check.rev) || check.rev < 0 || (check.wid != null && typeof check.wid !== 'string')) {
        throw new Error('invalid profile revision response')
      }
      // PUT rev can lag disk by 1 after stampPut. Never reuse it as baseRev; refetch.
      return (await fetchDocument(bearer)).state
    }
    throw new ProfileConflictError(current.state)
  }

  function updateProfile(bearer, patchFn) {
    const earlier = pending.get(bearer)
    const work = (earlier || Promise.resolve()).then(() => update(bearer, patchFn))
    const tail = work.catch(() => {})
    pending.set(bearer, tail)
    void tail.then(() => { if (pending.get(bearer) === tail) pending.delete(bearer) })
    return work
  }

  return { readProfile, updateProfile }
}
