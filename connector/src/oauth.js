import crypto from 'node:crypto'

// Lifetimes (conservative; nothing in the spec fixes them). Refresh is sliding: each rotation
// restarts the idle window, and replay of a used refresh token revokes the whole grant.
export const CODE_TTL_MS = 60_000
export const ACCESS_TTL_MS = 10 * 60_000
export const REFRESH_TTL_MS = 30 * 86_400_000
export const GRANT_MAX_MS = 90 * 86_400_000 // absolute cap: a passkey sign-in is needed again after this

const CLAUDE_CALLBACK = 'https://claude.ai/api/mcp/auth_callback'

// Exact allowlist: Claude's callback, or an http loopback URL with an explicit port (Claude Code).
// No userinfo, fragment or query anywhere; the host is a literal loopback name, never a lookalike.
export function allowedRedirect(uri) {
  if (uri === CLAUDE_CALLBACK) return true
  let u
  try { u = new URL(uri) } catch { return false }
  if (u.protocol !== 'http:' || u.username || u.password || u.hash || u.search || uri.includes('#') || uri.includes('?')) return false
  if (!['127.0.0.1', '[::1]', 'localhost'].includes(u.hostname)) return false
  const port = Number(u.port)
  return u.port !== '' && Number.isInteger(port) && port >= 1 && port <= 65535 && uri === u.href
}

export function pkceChallengeOk(verifier, challenge) {
  const a = Buffer.from(crypto.createHash('sha256').update(verifier).digest('base64url'))
  const b = Buffer.from(String(challenge))
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

// RFC 9728 protected-resource + RFC 8414 authorization-server metadata.
export function discovery({ origin, prefix }) {
  const issuer = `${origin}${prefix}`
  return {
    issuer,
    mcpUrl: `${issuer}/mcp`,
    resourceMetadataUrl: `${issuer}/.well-known/oauth-protected-resource`,
    protectedResource: {
      resource: `${issuer}/mcp`,
      authorization_servers: [issuer],
      bearer_methods_supported: ['header'],
    },
    authorizationServer: {
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      registration_endpoint: `${issuer}/register`,
      revocation_endpoint: `${issuer}/revoke`,
      revocation_endpoint_auth_methods_supported: ['none'],
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      // Non-standard hint: refresh tokens are single-use (public client); replay revokes the grant.
      refresh_token_rotation: true,
    },
  }
}
