import { createProfileStore } from './profileStore.js'
import { createMcpTools } from './mcpTools.js'
import { PlanChoiceRequiredError, updatePlanEdit } from './planEdits.js'
import { changeSetting, logBodyWeight, logMeasurement, logWorkout } from './profileEdits.js'
import { createConfirmations, createDestructiveTools } from './confirmations.js'
import { AdminError, createAdminExecutors, createAdminTools } from './adminTools.js'

// Minimal MCP Streamable HTTP subset: JSON-RPC 2.0 over POST, JSON replies only (no SSE, no
// sessions, no batches). Every tool result is one text block. Claude is untrusted input: tool
// arguments are checked against the same strict schema that tools/list advertises, and the trusted
// user, bearer and connection come only from the validated grant, never from a message.

const MAX_BODY = 32 * 1024
const MAX_RESULT = 48 * 1024
const MAX_ID = 256
const VERSIONS = ['2025-06-18', '2025-03-26']
// A result may never carry an image, a media path or a base64 payload, whatever a profile holds.
const MEDIA = /(?:^|[\/"' ])media\/|\.(?:png|jpe?g|gif|webp|svg|avif|bmp|mp4)(?:[?&#"' ]|$)|data:(?:image|video)\/|;base64,|[A-Za-z0-9+/]{128,}={0,2}/i
const LINK = 'This does NOT perform the action: it returns a one-time openGym confirmation link. ' +
  'The user must open the link and approve with their passkey in openGym; chat approval is insufficient.'

const object = x => x !== null && typeof x === 'object' && !Array.isArray(x)
const validId = id => (typeof id === 'string' && id.length <= MAX_ID) || Number.isSafeInteger(id)

class ArgError extends Error {}
class ToolError extends Error {}

/* ------------------------------ strict argument schemas ------------------------------ */

// One JSON Schema subset serves as documentation (tools/list) and enforcement. Unknown properties
// are refused unless a schema opts in with an object `additionalProperties`; nothing else is read.
const obj = (properties = {}, required) => ({ type: 'object', additionalProperties: false, properties, ...(required ? { required } : {}) })
const str = (maxLength) => ({ type: 'string', ...(maxLength ? { maxLength } : {}) })
const int = { type: 'integer' }
const num = { type: 'number' }

function check(schema, value) {
  const have = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value === 'number' ? (Number.isInteger(value) ? 'integer' : 'number') : typeof value
  if (!([].concat(schema.type)).some(t => t === have || (t === 'number' && have === 'integer')) ||
    (typeof value === 'number' && !Number.isFinite(value))) throw new ArgError()
  if (have === 'string' && value.length > (schema.maxLength ?? 500)) throw new ArgError()
  if (have === 'array') {
    if (value.length > (schema.maxItems ?? 100)) throw new ArgError()
    for (const item of value) check(schema.items, item)
  }
  if (have === 'object') {
    const props = schema.properties || {}
    for (const key of Object.keys(value)) {
      if (Object.hasOwn(props, key)) check(props[key], value[key])
      else if (object(schema.additionalProperties)) check(schema.additionalProperties, value[key])
      else throw new ArgError()
    }
    for (const key of schema.required || []) if (!Object.hasOwn(value, key)) throw new ArgError()
  }
  return value
}

const ID = str(200)
const DATE = str(10)
const DAYS = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map(d => [d, { type: 'array', items: str(200), maxItems: 20 }]))
const TARGETS = Object.fromEntries(['sets', 'reps', 'repsMin', 'repsMax', 'weight', 'restSec', 'sec', 'min', 'speed', 'inc', 'deloadFactor'].map(k => [k, num]))
const MEASURES = Object.fromEntries(['neck', 'shoulders', 'chest', 'waist', 'hips', 'abdomen', 'upperArmLeft', 'upperArmRight', 'forearmLeft', 'forearmRight',
  'wristLeft', 'wristRight', 'thighLeft', 'thighRight', 'calfLeft', 'calfRight', 'ankleLeft', 'ankleRight', 'bodyFat'].map(k => [k, num]))

const READS = {
  search_exercises: ['Find exercise IDs by name for planning; respects the active equipment profile and profile language. Returns text only.', obj({ query: str(80), limit: int }, ['query'])],
  list_routines: ['List the saved routines: ids, names and exercise counts.', obj()],
  get_routine: ['Full detail of one routine by routine_id.', obj({ routine_id: ID }, ['routine_id'])],
  preview_session: ['Preview the next session of a routine (routine_id, optional ISO date) with planned sets and weights.', obj({ routine_id: ID, date: DATE })],
  get_week_plan: ['The weekly schedule and what is planned today.', obj()],
  list_workouts: ['List logged workouts, newest first. Optional from/to ISO dates and limit.', obj({ from: DATE, to: DATE, limit: int })],
  get_workout: ['One logged workout, by date (YYYY-MM-DD) or workout_id.', obj({ date: DATE, workout_id: ID })],
  get_bodyweight: ['Body-weight history. Optional from/to ISO dates.', obj({ from: DATE, to: DATE })],
  estimate_1rm: ['Estimated one-rep max for an exercise_id. formula is epley, brzycki or lombardi.', obj({ exercise_id: ID, formula: str(20) })],
  muscle_balance: ['Which muscles were trained or neglected. period is week, month or all.', obj({ period: str(20) })],
}
const ADMIN_READS = {
  list_users: ['Admin only. List accounts (names, flags, activity). Never emails or credentials.', obj()],
  get_user: ['Admin only. Summary of one account by id: recent workouts and body weight, names and totals only.', obj({ id: ID }, ['id'])],
  list_invites: ['Admin only. List invites by opaque ref, without their codes. Use the ref to request revocation.', obj()],
  get_audit_log: ['Admin only. Recent activity-log events. Optional limit, before (event id) and cat.', obj({ limit: int, before: int, cat: str(20) })],
  get_coach_status: ['Admin only. Whether the AI coach is connected and healthy. Never keys or headers.', obj()],
}
const EDITS = {
  update_week_plan: ['Create or edit routines and assign them to weekdays (week keys 0-6, Sunday is 0). A NEW routine needs a creationId (a UUID you generate, reuse it to retry safely); an existing routine uses its id. Blocked while a live queue is active.',
    obj({ week: obj(DAYS), routines: { type: 'array', maxItems: 20, items: obj({ id: ID, name: str(200), creationId: str(64), ex: { type: 'array', maxItems: 50, items: obj({ id: ID, ...TARGETS }, ['id']) } }, ['ex']) } }, ['week', 'routines'])],
  log_workout: ['Log a completed workout. creationId is a UUID you generate and is the workout id (reuse it to retry safely). Weights are in the profile unit.',
    obj({ creationId: str(64), date: DATE, name: str(100), durationMin: int, exercises: { type: 'array', maxItems: 30, items: obj({ id: ID, sets: { type: 'array', maxItems: 50, items: obj({ weight: num, reps: int }) } }) } }, ['creationId', 'date', 'exercises'])],
  log_body_weight: ['Log the body weight for one date, in the profile unit.', obj({ date: DATE, weight: num }, ['date', 'weight'])],
  log_measurement: ['Log body measurements for one date. Values are centimetres (bodyFat is a percentage).', obj({ date: DATE, valuesCm: obj(MEASURES) }, ['date', 'valuesCm'])],
  change_setting: ['Change one safe setting: restSec, theme, weekStart, targetW, wdec or effort.', obj({ key: str(20), value: { type: ['string', 'number', 'null'] } }, ['key', 'value'])],
}
const LINKS = {
  delete_routine: ['Delete a routine by id.', obj({ id: ID }, ['id'])],
  delete_workout: ['Delete a logged workout by id.', obj({ id: ID }, ['id'])],
  disable_account: ['Admin only. Disable an account by id.', obj({ id: ID }, ['id'])],
  delete_account: ['Admin only. Delete an account and its data by id.', obj({ id: ID }, ['id'])],
  clear_audit_log: ['Admin only. Clear the activity log.', obj()],
  disconnect_coach: ['Admin only. Disconnect an AI coach provider.', obj({ provider: str(40) }, ['provider'])],
  sweep_media: ['Delete the user\'s own unused photos and videos.', obj()],
  request_create_invite: ['Admin only. Create a signup invite (optional note, up to 60 characters). The code is shown only on the passkey-confirmed page, never in chat.', obj({ note: str(60) })],
  request_revoke_invite: ['Admin only. Revoke an unused invite by its opaque ref from list_invites. No code is shown.', obj({ ref: str(22) }, ['ref'])],
  request_password_reset: ['Admin only. Request a password reset for a non-admin account (requires password login on the instance). The one-time code is shown only on the passkey-confirmed page, never in chat.', obj({ id: ID }, ['id'])],
  request_connect_coach: ['Admin only. Request connecting a Coach provider credential (any listed provider id). The credential is entered on the passkey-confirmed page in the browser, never in chat.', obj({ provider: str(40) }, ['provider'])],
}

/* ------------------------------------ replies ------------------------------------ */

const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id: validId(id) ? id : null, error: { code, message } })
const failure = message => ({ content: [{ type: 'text', text: JSON.stringify({ error: message }) }], isError: true })

function textResult(value, secrets) {
  let text
  try { text = JSON.stringify(value) } catch { return failure('tool failed') }
  if (typeof text !== 'string') return failure('tool failed')
  if (Buffer.byteLength(text) > MAX_RESULT) return failure('result too large; narrow the request')
  // Exact values only: a word filter would break a routine called "Cookie diet".
  if (MEDIA.test(text) || secrets.some(s => text.includes(s))) return failure('tool failed')
  return { content: [{ type: 'text', text }] }
}

// Only a 401 means "openGym no longer accepts this bearer" (disabled, expired, signed out: sessionOf
// returns null). A 403 on an admin route is an ordinary non-admin asking, so it never revokes. Both
// stores keep the upstream status in fixed text (anchored, so no argument or profile string can
// imitate it).
function denied(e) {
  if (e instanceof AdminError) return e.status === 401
  return typeof e?.message === 'string' && e.message === 'profile upstream status 401'
}

function readBody(req, limit, timeoutMs) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let n = 0, done = false
    const finish = (fn, value) => { if (done) return; done = true; clearTimeout(timer); fn(value) }
    const timer = setTimeout(() => { req.pause(); finish(reject, Object.assign(new Error('timeout'), { code: 'timeout' })) }, timeoutMs)
    req.on('data', chunk => {
      n += chunk.length
      if (n > limit) { req.resume(); finish(reject, Object.assign(new Error('too_large'), { code: 'too_large' })); return }
      chunks.push(chunk)
    })
    req.on('end', () => finish(resolve, Buffer.concat(chunks).toString('utf8')))
    req.on('error', e => finish(reject, e))
  })
}

// One turn at a time per key. A task returns { reply, settled }: `reply` is what the caller waits
// for, `settled` is when the work really ended. The next turn waits for `settled`, so an abandoned
// (timed-out) call cannot overlap the one behind it.
function serial(queues, key, task) {
  const previous = queues.get(key) || Promise.resolve()
  let release
  const tail = previous.then(() => new Promise(resolve => { release = resolve }))
  queues.set(key, tail)
  const run = previous.then(task)
  run.then(({ settled }) => settled, () => {}).then(() => {
    release()
    if (queues.get(key) === tail) queues.delete(key)
  })
  return run.then(({ reply }) => reply)
}

const UNAUTHORIZED = Symbol('unauthorized')

export function createMcpHttp({ origin, prefix, apiBase, key, connections, grants, confirmations, toolTimeoutMs = 10000, bodyTimeoutMs = 10000 } = {}) {
  if (!grants || typeof grants.bearerForAccessToken !== 'function' || typeof grants.connectionForAccessToken !== 'function' ||
    typeof grants.revokeAccessToken !== 'function' || !connections || typeof apiBase !== 'string' || !apiBase) throw new TypeError('mcp http dependencies required')
  const store = createProfileStore({ apiBase })
  // The same connection store backs the grants, so a confirmation link is bound to the very
  // connection (and passkey user) that asked for it.
  const confirm = confirmations || createConfirmations({ connections, key, apiBase, origin, prefix, store, executors: createAdminExecutors({ apiBase, key }) })
  const handlers = list => Object.fromEntries(list.map(t => [t.name, t.handler]))
  const read = handlers(createMcpTools(store.readProfile, { origin }))
  const admin = handlers(createAdminTools({ apiBase, key, confirmations: confirm }))
  const link = { ...handlers(createDestructiveTools(confirm)), ...admin }
  const edit = {
    update_week_plan: async (bearer, a) => {
      const done = await updatePlanEdit(store, bearer, a, { origin })
      if (done instanceof PlanChoiceRequiredError) throw new ToolError('a live queue is active: choose between the live queue and the fixed week in openGym before editing')
      return done
    },
    log_workout: (bearer, a) => logWorkout(store, bearer, a),
    log_body_weight: (bearer, a) => logBodyWeight(store, bearer, a),
    log_measurement: (bearer, a) => logMeasurement(store, bearer, a),
    change_setting: (bearer, a) => changeSetting(store, bearer, a),
  }
  const tools = new Map()
  const add = (table, run, suffix = '') => {
    for (const [name, [description, inputSchema]] of Object.entries(table)) {
      if (typeof run[name] !== 'function') throw new TypeError(`missing handler for ${name}`)
      tools.set(name, { name, description: description + suffix, inputSchema, run: run[name] })
    }
  }
  add(READS, read)
  add(ADMIN_READS, admin)
  add(EDITS, edit)
  add(LINKS, link, ` ${LINK}`)
  const bearerTools = new Set([...Object.keys(READS), ...Object.keys(ADMIN_READS), ...Object.keys(EDITS)])
  const queues = new Map()

  const reply = (res, status, body, headers = {}) => {
    if (res.headersSent) return
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers })
    res.end(JSON.stringify(body))
  }

  // Fresh identity for every message: openGym is asked again who the bearer is, so sign-out and a
  // disabled account end access at once. The connection comes from the grant, never the message.
  async function authenticate(token) {
    const bearer = await grants.bearerForAccessToken(token)
    const connectionId = bearer ? grants.connectionForAccessToken(token) : null
    const conn = connectionId && connections.get(connectionId)
    return conn && typeof conn.userId === 'string' && conn.userId ? { bearer, connectionId, token } : null
  }

  async function execute(session, params) {
    if (!object(params) || typeof params.name !== 'string' || Object.keys(params).some(k => k !== 'name' && k !== 'arguments')) return failure('invalid arguments')
    const tool = tools.get(params.name)
    if (!tool) return failure('unknown tool')
    try {
      const args = check(tool.inputSchema, params.arguments === undefined ? {} : params.arguments)
      const target = bearerTools.has(tool.name) ? session.bearer : session.connectionId
      return textResult(await tool.run(target, args), [session.bearer, session.token])
    } catch (e) {
      if (e instanceof ArgError) return failure('invalid arguments')
      if (e instanceof ToolError) return failure(e.message)
      if (denied(e)) { grants.revokeAccessToken(session.token); return UNAUTHORIZED }
      if (e instanceof AdminError && e.status === 403) return failure('admin only')
      return failure('tool failed')
    }
  }

  function runTool(session, params) {
    const work = execute(session, params)
    const settled = work.then(() => {}, () => {})
    let timer
    const timeout = new Promise(resolve => { timer = setTimeout(resolve, toolTimeoutMs, 'timeout') })
    const answer = Promise.race([work, timeout])
      .then(value => (value === 'timeout' ? failure('tool timed out; the change may or may not have been applied') : value))
      .finally(() => clearTimeout(timer))
    return { reply: answer, settled }
  }

  function shape(message) {
    if (Array.isArray(message)) return rpcError(null, -32600, 'Batch requests are not supported')
    if (!object(message)) return rpcError(null, -32600, 'Invalid Request')
    const id = Object.hasOwn(message, 'id') ? message.id : null
    if (Object.hasOwn(message, 'id') && !validId(id)) return rpcError(null, -32600, 'Invalid Request')
    if (message.jsonrpc !== '2.0' || typeof message.method !== 'string' || !message.method ||
      (message.params !== undefined && !object(message.params) && !Array.isArray(message.params))) return rpcError(id, -32600, 'Invalid Request')
    return null
  }

  const methods = {
    initialize: params => ({
      protocolVersion: object(params) && VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : VERSIONS[0],
      capabilities: { tools: {} },
      serverInfo: { name: 'openGym', version: '0.1.0' },
      instructions: `Irreversible actions (deletes, account changes) never run from chat: their tools return an openGym confirmation link the user must open and approve with a passkey. Chat approval is insufficient. Weights are in the profile unit. Retry writes with the same creationId.`,
    }),
    ping: () => ({}),
    'tools/list': () => ({ tools: [...tools.values()].map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) }),
  }

  return {
    confirmations: confirm,
    async handle(req, res, { token, wwwAuthenticate }) {
      const unauthorized = () => reply(res, 401, { error: 'unauthorized' }, { 'www-authenticate': wwwAuthenticate })
      // Cheap, local: no body is read and no upstream is asked for a token that was never issued.
      const known = grants.connectionForAccessToken(token)
      if (!known || !connections.get(known)) return unauthorized()
      const userId = connections.get(known).userId
      if ((req.headers['content-type'] || '').split(';')[0].trim().toLowerCase() !== 'application/json') return reply(res, 415, { error: 'unsupported_media_type' })
      if (Number(req.headers['content-length']) > MAX_BODY) return reply(res, 413, { error: 'too_large' })
      let raw
      try { raw = await readBody(req, MAX_BODY, bodyTimeoutMs) } catch (e) {
        const code = e && e.code
        return reply(res, code === 'too_large' ? 413 : code === 'timeout' ? 408 : 400, { error: code === 'too_large' ? 'too_large' : code === 'timeout' ? 'timeout' : 'invalid_request' })
      }
      let message
      try { message = JSON.parse(raw) } catch { return reply(res, 200, rpcError(null, -32700, 'Parse error')) }
      const invalid = shape(message)
      if (invalid) return reply(res, 200, invalid)
      const notification = !Object.hasOwn(message, 'id')
      const { id, method, params } = message
      // No tool notifications: initialized is the only supported no-id method.
      if (notification) {
        if (!(await authenticate(token))) return unauthorized()
        if (method !== 'notifications/initialized') return reply(res, 200, rpcError(null, -32601, 'Method not found'))
        res.writeHead(202, { 'cache-control': 'no-store' })
        return res.end()
      }
      if (method === 'tools/call') {
        // Identity is re-checked inside the user's turn, so a call queued behind one that revoked
        // the grant finds it gone and never runs.
        const answer = await serial(queues, userId, async () => {
          const session = await authenticate(token)
          if (!session) return { reply: Promise.resolve(UNAUTHORIZED), settled: Promise.resolve() }
          return runTool(session, params)
        })
        return answer === UNAUTHORIZED ? unauthorized() : reply(res, 200, { jsonrpc: '2.0', id, result: answer })
      }
      if (!Object.hasOwn(methods, method)) {
        if (!(await authenticate(token))) return unauthorized()
        return reply(res, 200, rpcError(id, -32601, 'Method not found'))
      }
      if (!(await authenticate(token))) return unauthorized()
      return reply(res, 200, { jsonrpc: '2.0', id, result: methods[method](params) })
    },
  }
}
