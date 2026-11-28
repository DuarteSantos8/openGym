// What every Edge Function here shares: the reply helpers, a small database client for the secret
// key, and "who is calling". Web-standard fetch only, so `node --test supabase/tests` runs it all.
//
// env:
//   SUPABASE_URL          the project URL
//   SUPABASE_SECRET_KEY   the secret (service role) key; SUPABASE_SERVICE_ROLE_KEY is read too
//   APP_ORIGIN            the web app's origin, e.g. https://app.example: CORS and return URLs
//
// Nothing secret is ever put in a response, a URL or a log line.

export const secretKey = env => env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY

export const cors = env => ({
  'Access-Control-Allow-Origin': env.APP_ORIGIN || 'null',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  Vary: 'Origin',
})
export const json = (env, status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors(env) } })
export const fail = (env, status, code) => json(env, status, { error: code })

/* A small PostgREST client for the secret key. Every call names its table and filter outright. */
export function database(env, fetchImpl) {
  const key = secretKey(env)
  const base = String(env.SUPABASE_URL).replace(/\/+$/, '') + '/rest/v1/'
  const headers = { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }
  const call = async (method, path, { body, prefer } = {}) => {
    const res = await fetchImpl(base + path, { method, headers: { ...headers, ...(prefer ? { Prefer: prefer } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    return res
  }
  const must = async res => { if (!res.ok) throw new Error('database ' + res.status); return res }
  return {
    async select(table, query) { return (await must(await call('GET', `${table}?${query}`))).json() },
    async upsert(table, rows, onConflict) { await must(await call('POST', `${table}?on_conflict=${onConflict}`, { body: rows, prefer: 'resolution=merge-duplicates,return=minimal' })) },
    /** Inserts a row that must be new. False when it already exists (409), true when inserted. */
    async insertOnce(table, row) {
      const res = await call('POST', table, { body: row, prefer: 'return=minimal' })
      if (res.status === 409) return false
      await must(res)
      return true
    },
    async update(table, query, patch) { await must(await call('PATCH', `${table}?${query}`, { body: patch, prefer: 'return=minimal' })) },
    async remove(table, query) { await must(await call('DELETE', `${table}?${query}`, { prefer: 'return=minimal' })) },
  }
}

export const q = v => encodeURIComponent(String(v))

/** The signed-in user behind a request's bearer token: { id, email, anonymous }, or null. */
export async function userOf(req, env, fetchImpl) {
  const auth = req.headers.get('authorization') || ''
  if (!/^Bearer\s+\S+/i.test(auth)) return null
  const res = await fetchImpl(String(env.SUPABASE_URL).replace(/\/+$/, '') + '/auth/v1/user', { headers: { apikey: secretKey(env), Authorization: auth } })
  if (!res.ok) return null
  const u = await res.json().catch(() => null)
  if (!u || typeof u.id !== 'string') return null
  return { id: u.id, email: typeof u.email === 'string' && u.email ? u.email : null, anonymous: u.is_anonymous === true }
}

/* What every browser-facing function does first. Returns a Response to send, or the user. */
export async function enter(req, env, fetchImpl) {
  if (req.method === 'OPTIONS') return { response: new Response(null, { status: 204, headers: cors(env) }) }
  if (req.method !== 'POST') return { response: fail(env, 405, 'method') }
  const user = await userOf(req, env, fetchImpl)
  if (!user) return { response: fail(env, 401, 'unauthorized') }
  return { user }
}
