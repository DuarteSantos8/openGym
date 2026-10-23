import crypto from 'node:crypto'

// Admin and Coach parity. Everything here asks the openGym API with the caller's own bearer and adds
// no authority: upstream requireAdmin stays the final gate. Three rules hold the module together.
//   1. Fixed upstream allowlist. No caller-supplied path or method ever reaches fetch.
//   2. Reads return only fields chosen below. Never emails, invite codes, reset codes, IPs, Coach
//      header values, credentials or diagnostics; those can carry secrets.
//   3. Every irreversible route is reachable ONLY through a confirmation executor (Task 8). There is
//      deliberately no exported function that POSTs. Reset, backup replace and bulk delete have no
//      dedicated admin route and get no tool here.
// Profile names, notes and Coach text are untrusted data: returned as plain values, never interpreted.

const TIMEOUT_MS = 10000
const MAX_BYTES = 5 * 1024 * 1024
const ID = /^[A-Za-z0-9_-]{1,64}$/
const CAT = /^[a-z]{1,20}$/

export class AdminError extends Error {
  constructor(message, status = 0) { super(message); this.name = 'AdminError'; this.status = status }
}
const refuse = () => { throw new AdminError('invalid_admin_request') }

const object = x => x !== null && typeof x === 'object' && !Array.isArray(x)
const str = (v, max = 200) => (typeof v === 'string' ? v.slice(0, max) : null)
const num = v => (Number.isFinite(v) ? v : null)
const hash = v => crypto.createHash('sha256').update(JSON.stringify(v)).digest('base64url')

// Fixed routes. Reads with a query are validated by shape in readPath; everything else is exact.
const FIXED = new Set([
  'GET /api/me', 'GET /api/data/rev', 'GET /api/admin/users', 'GET /api/admin/invites', 'GET /api/admin/coach',
  'POST /api/admin/user/delete', 'POST /api/admin/user/disable', 'POST /api/admin/user/password-reset', 'POST /api/admin/audit/clear',
  'POST /api/admin/coach/disconnect', 'POST /api/admin/coach/connect',
  'POST /api/admin/invites/new', 'POST /api/admin/invites/revoke',
  'POST /api/media/sweep',
])
const USER_PATH = /^\/api\/admin\/user\?id=[A-Za-z0-9_-]{1,64}$/
const AUDIT_PATH = /^\/api\/admin\/audit(\?limit=\d{1,3}(&before=\d{1,15})?(&cat=[a-z]{1,20})?|\?before=\d{1,15}(&cat=[a-z]{1,20})?|\?cat=[a-z]{1,20})?$/
const readPath = path => typeof path === 'string' && (FIXED.has(`GET ${path}`) || USER_PATH.test(path) || AUDIT_PATH.test(path))

async function send(apiBase, bearer, method, path, body) {
  if (typeof bearer !== 'string' || !bearer || bearer.length > 4096 || /[\u0000-\u001f\u007f]/.test(bearer)) refuse()
  if (typeof path !== 'string' || !(FIXED.has(`${method} ${path}`) || (method === 'GET' && readPath(path)))) refuse()
  let response
  try {
    response = await fetch(`${apiBase}${path}`, {
      method,
      headers: { authorization: `Bearer ${bearer}`, accept: 'application/json', ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) },
      ...(method === 'POST' ? { body: JSON.stringify(body ?? {}) } : {}),
      redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch { throw new AdminError('admin upstream unavailable') }
  try {
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => {})
      throw new AdminError(`admin upstream status ${response.status}`, response.status)
    }
    const chunks = []
    let size = 0
    if (response.body) {
      const reader = response.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.length
        if (size > MAX_BYTES) { await reader.cancel().catch(() => {}); throw new AdminError('admin upstream response too large') }
        chunks.push(value)
      }
    }
    let data
    try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new AdminError('invalid admin upstream response') }
    if (!object(data)) throw new AdminError('invalid admin upstream response')
    return data
  } catch (error) {
    if (error instanceof AdminError) throw error
    throw new AdminError('admin upstream unavailable')
  }
}

// Read-only forwarder for the fixed admin GET routes. The result is the raw upstream document and
// is for this module's projections: it is not itself a tool result. POST is never accepted.
export function adminRequest(apiBase, bearer, method, path) {
  if (method !== 'GET' || typeof apiBase !== 'string' || !apiBase || !readPath(path) || path === '/api/me' || path === '/api/data/rev') {
    return Promise.reject(new AdminError('invalid_admin_request'))
  }
  return send(apiBase, bearer, 'GET', path)
}

/* ------------------------------------ read tools ------------------------------------ */

const list = (value, max) => (Array.isArray(value) ? value.slice(0, max) : [])

const userRow = u => ({
  id: str(u.id, 64), name: str(u.name, 80), created: str(u.created, 40), disabled: u.disabled === true, admin: u.admin === true,
  invited: !!u.invitedBy,
})

function users(data) {
  return {
    users: list(data.users, 200).filter(object).map(u => ({
      ...userRow(u), workouts: num(u.workouts), lastWorkout: str(u.lastWorkout, 40), lastSync: num(u.lastSync), hasPush: u.hasPush === true, live: !!u.live,
    })),
    invite_only: data.invite_only === true,
  }
}

function user(data) {
  const u = object(data.user) ? data.user : {}
  return {
    user: userRow(u), unit: str(data.unit, 8), lastSync: num(data.lastSync),
    routines: list(data.routines, 100).filter(object).map(r => ({ id: str(r.id, 64), name: str(r.name, 120), emoji: str(r.emoji, 16), count: num(r.count) })),
    // Newest first upstream for workouts; body weight is oldest first. Bounded either way.
    bodyweight: list(data.bodyweight, 100000).filter(object).slice(-30).map(b => ({ d: str(b.d, 40), w: num(b.w) })),
    workouts: list(data.workouts, 100000).filter(object).slice(0, 20).map(w => ({ id: str(w.id, 64), d: str(w.d, 40), name: str(w.name, 120), vol: num(w.vol) })),
  }
}

// Domain-separated from the connector key; a code cannot be guessed from a listed reference.
const inviteKey = key => crypto.createHmac('sha256', key).update('invite-ref').digest()
const inviteRef = (secret, invite) => crypto.createHmac('sha256', secret).update(JSON.stringify(invite)).digest('base64url').slice(0, 22)

function inviteRecords(data, secret) {
  const found = list(data.invites, 500).filter(object).map(i => ({ record: i, ref: inviteRef(secret, i) }))
  if (new Set(found.map(i => i.ref)).size !== found.length) refuse()
  return found
}

// The invite CODE is a credential: only the browser execute response may carry a newly created one.
function invites(data, secret) {
  return {
    invites: inviteRecords(data, secret).map(({ record: i, ref }) => ({
      ref, note: str(i.note, 80), created: str(i.created, 40), used: !!i.usedBy, usedAt: str(i.usedAt, 40), usedByName: str(i.usedByName, 80),
    })),
    invite_only: data.invite_only === true,
  }
}

// `msg` carries invite codes and names, `ip` says where someone is: neither is returned.
function audit(data) {
  return {
    events: list(data.events, 200).filter(object).map(e => ({
      id: num(e.id), ts: num(e.ts), ev: str(e.ev, 60), ok: e.ok !== false, uid: str(e.uid, 64), name: str(e.name, 80),
      tgt: str(e.tgt, 64), tname: str(e.tname, 80), act: str(e.act, 40),
    })),
    total: num(data.total), nextBefore: num(data.nextBefore), enabled: data.enabled === true,
  }
}

function hostOf(value) {
  try { const u = new URL(value); return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : null } catch { return null }
}

// Not returned: configured header values, base URL path/query, the connected account, key state
// details, runtime error text, last-error message and per-job detail. Any of those can hold a secret.
function coach(data) {
  const event = e => (object(e) ? { at: str(e.at, 40), kind: str(e.kind, 40), outcome: str(e.outcome, 40) } : null)
  const auth = object(data.auth) ? data.auth : {}
  return {
    enabled: data.enabled === true, disabledByEnv: data.disabledByEnv === true, provider: str(data.provider, 40), model: str(data.model, 80),
    baseUrlHost: typeof data.baseUrl === 'string' ? hostOf(data.baseUrl) : null,
    providers: list(data.providers, 50).filter(object).map(coachCapability),
    knownModels: Array.isArray(data.knownModels) ? data.knownModels.slice(0, 50).map(m => str(m, 80)).filter(Boolean) : null,
    caps: object(data.caps) ? { perProfileDaily: num(data.caps.perProfileDaily), instanceDaily: num(data.caps.instanceDaily) } : null,
    maxMessageLen: num(data.maxMessageLen), maxOutputTokens: num(data.maxOutputTokens), community: data.community === true, authMode: str(data.authMode, 40),
    auth: { state: str(auth.state, 40), type: str(auth.type, 40) },
    runtime: { ok: object(data.runtime) && data.runtime.ok === true, needsKey: object(data.runtime) && data.runtime.needsKey === true },
    jobsToday: num(data.jobsToday),
    lastSuccess: event(data.lastSuccess),
    lastError: object(data.lastError) ? { ...event(data.lastError), errorClass: str(data.lastError.errorClass, 40) } : null,
    recent: list(data.recent, 20).filter(object).map(e => ({ at: str(e.at, 40), kind: str(e.kind, 40), trigger: str(e.trigger, 40), outcome: str(e.outcome, 40), errorClass: str(e.errorClass, 40), ms: num(e.ms) })),
  }
}

// Only the credential capabilities and the connected flag: everything a Coach credential review
// needs, none of what it must not show (base URL path/query, headers, account, diagnostics).
function coachCapability(p) {
  return { id: str(p.id, 40), label: str(p.label, 80), connected: p.connected === true, apiKey: p.apiKey === true, setupToken: p.setupToken === true, deviceLogin: p.deviceLogin === true }
}

function args(value, keys) {
  const a = value === undefined ? {} : value
  if (!object(a) || !Object.keys(a).every(k => keys.includes(k))) refuse()
  return a
}

function readTools(apiBase, secret) {
  const get = (path, project) => async (bearer, a) => project(await adminRequest(apiBase, bearer, 'GET', path(a)))
  const ask = (name, keys, path, project) => ({ name, handler: (bearer, a) => get(x => path(args(x, keys)), project)(bearer, a) })
  return [
    ask('list_users', [], () => '/api/admin/users', users),
    ask('get_user', ['id'], a => (typeof a.id === 'string' && ID.test(a.id) ? `/api/admin/user?id=${a.id}` : refuse()), user),
    ask('list_invites', [], () => '/api/admin/invites', data => invites(data, secret)),
    ask('get_audit_log', ['limit', 'before', 'cat'], a => {
      const q = []
      if (a.limit !== undefined) { if (!Number.isInteger(a.limit) || a.limit < 1 || a.limit > 200) refuse(); q.push(`limit=${a.limit}`) }
      if (a.before !== undefined) { if (!Number.isInteger(a.before) || a.before < 1 || a.before > 1e15) refuse(); q.push(`before=${a.before}`) }
      if (a.cat !== undefined) { if (typeof a.cat !== 'string' || !CAT.test(a.cat)) refuse(); q.push(`cat=${a.cat}`) }
      return `/api/admin/audit${q.length ? `?${q.join('&')}` : ''}`
    }, audit),
    ask('get_coach_status', [], () => '/api/admin/coach', coach),
  ]
}

/* ------------------------------ confirmed destructive actions ------------------------------ */

// Fresh answer to "who is this bearer": the stored user must still be the signed-in one.
async function me(apiBase, { userId, bearer }) {
  const data = await send(apiBase, bearer, 'GET', '/api/me')
  return object(data.user) && typeof userId === 'string' && data.user.id === userId ? data.user : null
}
const isAdmin = async (apiBase, trusted) => (await me(apiBase, trusted))?.admin === true

async function account(apiBase, bearer, id) {
  if (typeof id !== 'string' || !ID.test(id)) refuse()
  const data = await adminRequest(apiBase, bearer, 'GET', `/api/admin/user?id=${id}`)
  const u = data.user
  if (!object(u) || u.id !== id) refuse()
  return { id, name: str(u.name, 200) || id, created: str(u.created, 40), disabled: u.disabled === true, admin: u.admin === true }
}

async function passwordLoginEnabled(apiBase, bearer) {
  return (await adminRequest(apiBase, bearer, 'GET', '/api/admin/users')).password_login === true
}

// The same shape the API issues (api/password.js makeResetCode): 12 chars from the pairing-code
// alphabet, grouped. Anything else upstream sends is refused rather than shown.
const RESET_CODE = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/

// Real admin routes act on any user, so the executor itself must prove: caller is admin right now,
// the target exists, is not an admin and is not the caller. Upstream still has the last word.
function accountExecutor(apiBase, type, route, bodyOf, result) {
  return {
    authorize: async (trusted, id) => {
      if (!(await isAdmin(apiBase, trusted)) || id === trusted.userId) return false
      return (await account(apiBase, trusted.bearer, id)).admin === false
    },
    inspect: async ({ bearer }, id) => {
      const a = await account(apiBase, bearer, id)
      return { summary: { type, id, name: a.name, effect: type === 'delete-account' ? 'Permanently removes this account, its training history, credentials, and uploaded photos or videos.' : 'Locks this account out until an admin enables it again.' }, digest: hash([type, a]) }
    },
    execute: async ({ bearer }, id) => { await send(apiBase, bearer, 'POST', route, bodyOf(id)); return result(id) },
  }
}

const PROVIDER = /^[A-Za-z0-9_-]{1,40}$/
// Credential type -> the capability flag GET /api/admin/coach reports for it. Upstream files
// `oauth` and `cli-token` alike under the provider's oauthEnv, which only setupToken providers
// declare; device logins are not pasted tokens and are not offered here.
const TYPE_FLAG = { apikey: 'apiKey', 'cli-token': 'setupToken', oauth: 'setupToken' }
const MAX_TOKEN = 2048

async function provider(apiBase, bearer, id) {
  if (typeof id !== 'string' || !PROVIDER.test(id)) refuse()
  const found = list((await adminRequest(apiBase, bearer, 'GET', '/api/admin/coach')).providers, 50).find(p => object(p) && p.id === id)
  if (!found || found.connected !== true) refuse()
  return { id, label: str(found.label, 80) || id }
}

// The full capability row for a provider the instance really lists. Not limited to connected ones:
// a first connection is the point of the link.
async function providerCapability(apiBase, bearer, id) {
  if (typeof id !== 'string' || !PROVIDER.test(id)) refuse()
  const found = list((await adminRequest(apiBase, bearer, 'GET', '/api/admin/coach')).providers, 50).find(p => object(p) && p.id === id)
  if (!found) refuse()
  const capability = coachCapability(found)
  if (!capability.id || !capability.label || !Object.values(TYPE_FLAG).some(flag => capability[flag])) refuse()
  return capability
}

export function createAdminExecutors({ apiBase, key } = {}) {
  if (typeof apiBase !== 'string' || !apiBase) throw new TypeError('apiBase required')
  if (!key) throw new TypeError('key required')
  const secret = inviteKey(key)
  // The listed ref names one CURRENT invite record: absent, ambiguous or changed means stale. Any
  // current admin may revoke any unused invite, as in the openGym admin UI.
  const revocable = async ({ bearer }, ref) => {
    if (typeof ref !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(ref)) refuse()
    const found = inviteRecords(await send(apiBase, bearer, 'GET', '/api/admin/invites'), secret).filter(i => i.ref === ref)
    if (found.length !== 1 || found[0].record.usedBy || typeof found[0].record.code !== 'string') refuse()
    return found[0].record
  }
  return {
    'delete-account': accountExecutor(apiBase, 'delete-account', '/api/admin/user/delete', id => ({ id }), id => ({ deleted: { type: 'delete-account', id } })),
    'disable-account': accountExecutor(apiBase, 'disable-account', '/api/admin/user/disable', id => ({ id, disabled: true }), id => ({ disabled: { type: 'disable-account', id } })),
    // The log changes with every sign-in, so its content cannot be part of the digest: the action is
    // fixed ("clear it") and admin rights are re-proved at each step.
    'clear-audit': {
      authorize: async (trusted, id) => id === 'audit' && (await isAdmin(apiBase, trusted)),
      inspect: async (_trusted, id) => (id === 'audit' ? { summary: { type: 'clear-audit', id, name: 'Activity log' }, digest: hash(['clear-audit']) } : refuse()),
      execute: async ({ bearer }) => { await send(apiBase, bearer, 'POST', '/api/admin/audit/clear', {}); return { cleared: true } },
    },
    'disconnect-coach': {
      authorize: async (trusted, id) => (await isAdmin(apiBase, trusted)) && !!(await provider(apiBase, trusted.bearer, id)),
      inspect: async ({ bearer }, id) => {
        const p = await provider(apiBase, bearer, id)
        return { summary: { type: 'disconnect-coach', id, name: p.label }, digest: hash(['disconnect-coach', p]) }
      },
      execute: async ({ bearer }, id) => { await send(apiBase, bearer, 'POST', '/api/admin/coach/disconnect', { provider: id }); return { disconnected: { type: 'disconnect-coach', id } } },
    },
    // The invite list only grows, so the digest cannot bind to its content (like clear-audit): it
    // binds the fixed action and the stored admin. The code comes back from upstream exactly once,
    // in the execute response reveal; any other shape is refused rather than shown.
    'create-invite': {
      params: raw => {
        const a = raw === undefined ? {} : raw
        if (!object(a) || Object.keys(a).some(k => k !== 'note') || (a.note !== undefined && typeof a.note !== 'string')) refuse()
        const note = (a.note ?? '').trim()
        if (note.length > 60) refuse()
        return { note }
      },
      authorize: async (trusted, id) => id === 'new' && (await isAdmin(apiBase, trusted)),
      inspect: async ({ userId }, id, { note }) => (id === 'new' ? {
        summary: { type: 'create-invite', id, name: 'New invite',
          effect: `Creates one signup invite. Its code is shown once on this page after confirmation, never in chat.${note ? ` Note: ${note}` : ''}` },
        digest: hash(['create-invite', userId, note]),
      } : refuse()),
      execute: async ({ bearer }, _id, _digest, { note }) => {
        const data = await send(apiBase, bearer, 'POST', '/api/admin/invites/new', { note })
        const code = object(data.invite) ? data.invite.code : null
        if (typeof code !== 'string' || !/^[0-9A-F]{16}$/.test(code)) refuse()
        // No expiry: invite codes stay valid until used or revoked. Omit the field rather than null,
        // so the confirmed page shows no expiry line.
        return { created: true, note, reveal: { label: 'Invite code', value: code } }
      },
    },
    // The digest binds the FULL record including the code: hashing the credential is fine, showing
    // it is not. execute re-resolves the same ref and re-checks the stored digest, so an invite
    // changed or consumed between page and passkey tap is never revoked under a stale description.
    'revoke-invite': {
      authorize: async (trusted, ref) => (await isAdmin(apiBase, trusted)) && !!(await revocable(trusted, ref)),
      inspect: async (trusted, ref) => {
        const i = await revocable(trusted, ref)
        return { summary: { type: 'revoke-invite', id: ref, name: `Invite ${ref.slice(0, 6)}`, ...(str(i.created, 40) ? { date: str(i.created, 40) } : {}),
          effect: 'Withdraws this unused invite: its code stops working at once.' }, digest: hash(['revoke-invite', i]) }
      },
      execute: async (trusted, ref, digest) => {
        const i = await revocable(trusted, ref)
        if (hash(['revoke-invite', i]) !== digest) refuse()
        await send(apiBase, trusted.bearer, 'POST', '/api/admin/invites/revoke', { code: i.code })
        return { revoked: { ref } }
      },
    },
    // POST /api/media/sweep is a user route, not an admin one: it clears the caller's OWN unreferenced
    // photos and videos. Any signed-in person may confirm it, only for themselves ('self'). Binding
    // the digest to the profile revision means a sync after the link was made needs a new link.
    'sweep-media': {
      authorize: async (trusted, id) => id === 'self' && !!(await me(apiBase, trusted)),
      inspect: async ({ userId, bearer }) => {
        const r = await send(apiBase, bearer, 'GET', '/api/data/rev')
        return { summary: { type: 'sweep-media', id: userId, name: 'Unused photos and videos' }, digest: hash(['sweep-media', userId, num(r.rev), str(r.wid, 100)]) }
      },
      execute: async ({ bearer }) => {
        const r = await send(apiBase, bearer, 'POST', '/api/media/sweep', {})
        return { swept: true, removed: num(r.removed), freedBytes: num(r.freedBytes) }
      },
    },
    // Password sign-in is per instance: the tool stays registered (tools/list is static) but
    // mints nothing unless GET /api/admin/users says password_login:true, re-checked here at
    // execute. Target must exist, not be an admin and not be the caller — the same bar as
    // disable. The digest binds the account row, so a rename between link and tap is refused.
    'password-reset': {
      authorize: async (trusted, id) => {
        if (!(await isAdmin(apiBase, trusted)) || id === trusted.userId || !(await passwordLoginEnabled(apiBase, trusted.bearer))) return false
        return (await account(apiBase, trusted.bearer, id)).admin === false
      },
      inspect: async ({ bearer }, id) => {
        if (!(await passwordLoginEnabled(apiBase, bearer))) refuse()
        const a = await account(apiBase, bearer, id)
        return { summary: { type: 'password-reset', id, name: a.name,
          effect: 'Invalidates the former password and ends all sessions of this account. Passkeys stay. The reset code is shown once on this page, never in chat.' },
        digest: hash(['password-reset', a]) }
      },
      execute: async ({ bearer }, id, digest) => {
        if (!(await passwordLoginEnabled(apiBase, bearer))) refuse()
        const a = await account(apiBase, bearer, id)
        if (a.admin || hash(['password-reset', a]) !== digest) refuse()
        const data = await send(apiBase, bearer, 'POST', '/api/admin/user/password-reset', { id })
        if (typeof data.code !== 'string' || !RESET_CODE.test(data.code) || !Number.isFinite(data.expires)) refuse()
        return { reset: true, id, reveal: { label: 'Password reset code', value: data.code, expires: data.expires } }
      },
    },
    // The link is for one provider; the credential itself is typed in the browser and arrives
    // only with the passkey tap (input), never in chat params. input() checks shape only: the
    // provider and the type are re-checked against the live capability row inside execute.
    'connect-coach': {
      input: raw => {
        if (!object(raw) || Object.keys(raw).some(k => !['provider', 'type', 'token', 'account'].includes(k))) refuse()
        if (typeof raw.provider !== 'string' || !PROVIDER.test(raw.provider)) refuse()
        if (typeof raw.type !== 'string' || !Object.hasOwn(TYPE_FLAG, raw.type)) refuse()
        if (typeof raw.token !== 'string' || !raw.token.trim() || raw.token.length > MAX_TOKEN) refuse()
        if (raw.account !== undefined && (typeof raw.account !== 'string' || raw.account.length > 120)) refuse()
        return { provider: raw.provider, type: raw.type, token: raw.token.trim(), ...(raw.account !== undefined ? { account: raw.account } : {}) }
      },
      authorize: async (trusted, id) => (await isAdmin(apiBase, trusted)) && !!(await providerCapability(apiBase, trusted.bearer, id)),
      inspect: async ({ bearer }, id) => {
        const p = await providerCapability(apiBase, bearer, id)
        return { summary: { type: 'connect-coach', id, name: p.label, provider: p,
          effect: p.connected ? `Replaces the credential already connected for ${p.label}.` : `Connects a credential for ${p.label}.` },
        digest: hash(['connect-coach', p]) }
      },
      execute: async ({ bearer }, id, digest, _params, input) => {
        if (!input || input.provider !== id) refuse()
        const p = await providerCapability(apiBase, bearer, id)
        if (hash(['connect-coach', p]) !== digest || p[TYPE_FLAG[input.type]] !== true) refuse()
        await send(apiBase, bearer, 'POST', '/api/admin/coach/connect', input)
        return { connected: { provider: id } }
      },
    },
  }
}

export function createAdminTools({ apiBase, key, confirmations } = {}) {
  if (typeof apiBase !== 'string' || !apiBase || !key || !confirmations || typeof confirmations.requestConfirmation !== 'function') throw new TypeError('admin tool dependencies required')
  const secret = inviteKey(key)
  // Handlers take a trusted connection ID, never a caller-supplied user. They only mint a link.
  const link = (name, type, target, params) => ({ name, handler: (connectionId, a) => confirmations.requestConfirmation({ type, targetId: target(a), ...(params ? { params: params(a) } : {}) }, connectionId) })
  return [
    ...readTools(apiBase, secret),
    link('delete_account', 'delete-account', a => args(a, ['id']).id),
    link('clear_audit_log', 'clear-audit', a => { args(a, []); return 'audit' }),
    link('disconnect_coach', 'disconnect-coach', a => args(a, ['provider']).provider),
    link('sweep_media', 'sweep-media', a => { args(a, []); return 'self' }),
    link('request_create_invite', 'create-invite', a => { args(a, ['note']); return 'new' }, a => ({ note: args(a, ['note']).note })),
    link('request_revoke_invite', 'revoke-invite', a => args(a, ['ref']).ref),
    link('request_password_reset', 'password-reset', a => args(a, ['id']).id),
    link('request_connect_coach', 'connect-coach', a => args(a, ['provider']).provider),
  ]
}
