import net from 'node:net'

// The one prefix the server, the OAuth discovery documents, the Cloudflare path rule and the
// service-worker exclusion all agree on. It is a constant, not a knob: any other value would
// publish metadata that points Claude at routes the tunnel does not forward.
export const PREFIX = '/connector'

export class ConfigError extends Error {
  constructor(problems) {
    super(`invalid connector configuration:\n${problems.map(p => `  ${p}`).join('\n')}`)
    this.name = 'ConfigError'
  }
}

// A bare origin, exactly as written: no path, query, fragment, credentials or default-port noise.
// Comparing the raw text against URL's own normalized origin rejects all of those at once.
function bareOrigin(raw, schemes) {
  if (typeof raw !== 'string') return null
  let u
  try { u = new URL(raw) } catch { return null }
  if (!schemes.includes(u.protocol) || (raw !== u.origin && raw !== `${u.origin}/`)) return null
  return u.origin
}

// Never echoes a value: a mistyped key or a URL with a password in it must not reach logs.
// opts.test relaxes exactly one thing, the public origin's scheme, so unit tests can use http.
export function loadConfig(env, { test = false } = {}) {
  const problems = [], out = { prefix: PREFIX }
  const fail = (name, why) => problems.push(`${name}: ${why}`)

  out.origin = bareOrigin(env.CONNECTOR_PUBLIC_ORIGIN, test ? ['https:', 'http:'] : ['https:'])
  if (!out.origin) fail('CONNECTOR_PUBLIC_ORIGIN', `required; must be a bare ${test ? 'http(s)' : 'https'} origin such as https://gym.example.com`)

  if (env.CONNECTOR_PREFIX !== undefined && env.CONNECTOR_PREFIX !== PREFIX) fail('CONNECTOR_PREFIX', `must be exactly ${PREFIX} (or unset)`)

  const k = env.CONNECTOR_ENCRYPTION_KEY
  if (typeof k === 'string' && /^[A-Za-z0-9+/_-]{43}=?$/.test(k)) {
    const decoded = Buffer.from(k, 'base64')
    if (decoded.toString(k.includes('-') || k.includes('_') ? 'base64url' : 'base64') === k) out.key = decoded
  }
  // ponytail: a diversity floor rejects obvious placeholders, not every possible weak key.
  // If key provenance matters, require a secret manager; never infer randomness from bytes.
  if (!out.key || out.key.length !== 32 || new Set(out.key).size < 20) {
    out.key = null
    fail('CONNECTOR_ENCRYPTION_KEY', 'required; must be 32 random bytes, base64 encoded (generate with: openssl rand -base64 32)')
  }

  out.apiBase = bareOrigin(env.CONNECTOR_UPSTREAM_URL, ['http:', 'https:'])
  if (!out.apiBase) fail('CONNECTOR_UPSTREAM_URL', 'required; must be a bare http(s) origin without credentials, such as http://opengym-web-1')

  out.host = env.CONNECTOR_HOST ?? '127.0.0.1'
  if (!net.isIP(out.host)) fail('CONNECTOR_HOST', 'must be an IP address (default 127.0.0.1)')

  const p = env.CONNECTOR_PORT ?? '8787'
  out.port = /^\d{1,5}$/.test(p) ? Number(p) : 0
  if (out.port < 1 || out.port > 65535) fail('CONNECTOR_PORT', 'must be an integer from 1 to 65535 (default 8787)')

  if (problems.length) throw new ConfigError(problems)
  return out
}
