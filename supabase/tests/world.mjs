// A pretend Supabase project and a pretend Stripe, behind one fetch. Just enough of each for
// the handlers: PostgREST's eq / in / not.in filters, upsert by on_conflict, PATCH, DELETE, the
// auth /user endpoint, and Stripe's customers, checkout sessions, portal sessions and
// subscriptions. Every request is recorded so a test can say what was, and was not, sent.
const PK = { customers: ['user_id'], subscriptions: ['id'], entitlements: ['user_id', 'feature', 'source'], webhook_events: ['id'] }

export function makeWorld({ users = {}, env: extra = {} } = {}) {
  const tables = { customers: [], subscriptions: [], entitlements: [], webhook_events: [] }
  const stripe = { customers: [], sessions: [], portals: [], subscriptions: {}, idempotency: new Map(), down: false }
  const calls = []
  const env = {
    SUPABASE_URL: 'https://proj.example', SUPABASE_SECRET_KEY: 'secret-key', STRIPE_SECRET_KEY: 'sk_test_x',
    STRIPE_WEBHOOK_SECRET: 'whsec_test', STRIPE_PRICE_IDS: 'price_month, price_year', APP_ORIGIN: 'https://app.example', ...extra,
  }
  const reply = (status, body) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

  const matcher = params => {
    const tests = []
    for (const [k, v] of params) {
      if (k === 'select' || k === 'on_conflict') continue
      let m
      if ((m = /^eq\.(.*)$/.exec(v))) tests.push(r => String(r[k]) === m[1])
      else if ((m = /^in\.\((.*)\)$/.exec(v))) { const set = m[1].split(','); tests.push(r => set.includes(String(r[k]))) }
      else if ((m = /^not\.in\.\((.*)\)$/.exec(v))) { const set = m[1].split(','); tests.push(r => !set.includes(String(r[k]))) }
      else throw new Error('world: filter not supported: ' + k + '=' + v)
    }
    return r => tests.every(t => t(r))
  }

  async function rest(url, init) {
    if (init.headers.apikey !== env.SUPABASE_SECRET_KEY || init.headers.Authorization !== 'Bearer ' + env.SUPABASE_SECRET_KEY) return reply(401, { message: 'bad key' })
    const table = url.pathname.split('/').pop()
    if (!tables[table]) return reply(404, {})
    const rows = tables[table], match = matcher(url.searchParams)
    const body = init.body ? JSON.parse(init.body) : null
    if (init.method === 'GET') return reply(200, rows.filter(match).map(r => ({ ...r })))
    if (init.method === 'POST') {
      const merge = /resolution=merge-duplicates/.test(init.headers.Prefer || '')
      const keys = (url.searchParams.get('on_conflict') || PK[table].join(',')).split(',')
      for (const row of [].concat(body)) {
        const at = rows.findIndex(r => keys.every(k => r[k] === row[k]))
        if (at >= 0) { if (!merge) return reply(409, { code: '23505' }); rows[at] = { ...rows[at], ...row } }
        else rows.push({ ...(table === 'webhook_events' ? { processed_at: null } : {}), ...row })
      }
      return reply(201)
    }
    if (init.method === 'PATCH') { for (const r of rows.filter(match)) Object.assign(r, body); return reply(204) }
    if (init.method === 'DELETE') { tables[table] = rows.filter(r => !match(r)); return reply(204) }
    return reply(405, {})
  }

  const form = text => Object.fromEntries(new URLSearchParams(text))
  async function stripeApi(url, init) {
    if (stripe.down) return reply(503, { error: { message: 'down', type: 'api_error' } })
    if (init.headers.Authorization !== 'Bearer ' + env.STRIPE_SECRET_KEY) return reply(401, { error: { message: 'bad key' } })
    const idem = init.headers['Idempotency-Key']
    if (idem && stripe.idempotency.has(idem)) return reply(200, stripe.idempotency.get(idem))
    const keep = obj => { if (idem) stripe.idempotency.set(idem, obj); return reply(200, obj) }
    const p = init.body ? form(init.body) : {}
    if (init.method === 'POST' && url.pathname === '/v1/customers') {
      const c = { id: 'cus_' + (stripe.customers.length + 1), email: p.email || null, metadata: { supabase_user_id: p['metadata[supabase_user_id]'] } }
      stripe.customers.push(c); return keep(c)
    }
    if (init.method === 'POST' && url.pathname === '/v1/checkout/sessions') {
      const s = { id: 'cs_' + (stripe.sessions.length + 1), url: 'https://checkout.stripe.test/c/' + (stripe.sessions.length + 1), params: p }
      stripe.sessions.push(s); return keep(s)
    }
    if (init.method === 'POST' && url.pathname === '/v1/billing_portal/sessions') {
      const s = { id: 'bps_' + (stripe.portals.length + 1), url: 'https://billing.stripe.test/p/' + (stripe.portals.length + 1), params: p }
      stripe.portals.push(s); return keep(s)
    }
    const m = /^\/v1\/subscriptions\/(.+)$/.exec(url.pathname)
    if (init.method === 'GET' && m) return stripe.subscriptions[m[1]] ? reply(200, stripe.subscriptions[m[1]]) : reply(404, { error: { message: 'No such subscription' } })
    return reply(404, { error: { message: 'world: no such Stripe route ' + init.method + ' ' + url.pathname } })
  }

  const fetchImpl = async (input, init = {}) => {
    const url = new URL(input)
    const req = { method: init.method || 'GET', headers: init.headers || {}, body: init.body }
    calls.push({ method: req.method, url: url.origin + url.pathname + url.search, headers: req.headers, body: req.body })
    if (url.origin === env.SUPABASE_URL && url.pathname === '/auth/v1/user') {
      const u = users[(req.headers.Authorization || '').replace(/^Bearer\s+/i, '')]
      return u ? reply(200, u) : reply(401, { message: 'invalid token' })
    }
    if (url.origin === env.SUPABASE_URL && url.pathname.startsWith('/rest/v1/')) return rest(url, req)
    if (url.origin === 'https://api.stripe.com') return stripeApi(url, req)
    throw new Error('world: a request left for ' + url.origin)
  }
  return { env, tables: () => tables, table: n => tables[n], stripe, calls, fetchImpl }
}

const enc = new TextEncoder()
/** A `Stripe-Signature` header for `body`, as Stripe would make it. */
export async function signStripe(body, secret, t = Math.floor(Date.now() / 1000)) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(t + '.' + body)))].map(b => b.toString(16).padStart(2, '0')).join('')
  return `t=${t},v1=${sig}`
}

export const post = (path, { token, body, headers = {} } = {}) => new Request('https://fn.example/' + path, {
  method: 'POST',
  headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), 'content-type': 'application/json', ...headers },
  body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
})
