#!/usr/bin/env node
/* openGym MCP server — Streamable HTTP transport with OAuth 2.1 (authorization code + PKCE), for
   hosted clients that cannot spawn the stdio bridge. Runs as the optional `mcp` compose service
   (docs/MCP_REMOTE.md). Two hostnames are involved: the protocol and token endpoints live on
   OAUTH_ISSUER, while the consent page is served on the app's own origin (OAUTH_AUTHORIZE_URL,
   proxied by nginx) so it can read the passkey session cookie. */
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js'
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js'
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createMcpServer, executeTool } from './server.js'
import { OpenGymOAuthProvider } from './oauth.js'
import { WRITE_TOOLS } from './write-tools.js'

const PORT = Number(process.env.PORT || 3001)
const HOST = process.env.HOST || '0.0.0.0'
const ISSUER = new URL(process.env.OAUTH_ISSUER || 'http://localhost:3001')
const RESOURCE = new URL(process.env.MCP_RESOURCE || new URL('/mcp', ISSUER))
const AUTHORIZATION_URL = new URL(process.env.OAUTH_AUTHORIZE_URL || new URL('/authorize', ISSUER))
const SCOPES = ['opengym:read', 'opengym:write']

const provider = new OpenGymOAuthProvider({
  dataDir: process.env.OPENGYM_DATA || '/data',
  oauthDir: process.env.OAUTH_DATA || '/oauth-data',
  resource: RESOURCE, authorizationUrl: AUTHORIZATION_URL, issuer: ISSUER
})

// DNS-rebinding protection: the two public hostnames, plus `mcp` for the api's own calls to
// /manage over the compose network and loopback for the container healthcheck.
const allowedHosts = (process.env.ALLOWED_HOSTS || `${ISSUER.hostname},${AUTHORIZATION_URL.hostname},mcp`)
  .split(',').map(host => host.trim()).filter(Boolean)
const app = createMcpExpressApp({ host: HOST, allowedHosts: [...new Set([...allowedHosts, '127.0.0.1', 'localhost'])] })
app.set('trust proxy', 1)
app.disable('x-powered-by')

// Settings (on the app's origin) fetches this to tell whether the MCP hostname is reachable.
app.get('/health', (_req, res) => res.set('Access-Control-Allow-Origin', AUTHORIZATION_URL.origin).json({ ok: true, transport: 'streamable-http', auth: 'oauth' }))

const oauthMetadata = () => ({
  issuer: ISSUER.href,
  authorization_endpoint: AUTHORIZATION_URL.href,
  token_endpoint: new URL('/token', ISSUER).href,
  registration_endpoint: new URL('/register', ISSUER).href,
  revocation_endpoint: new URL('/revoke', ISSUER).href,
  response_types_supported: ['code'],
  grant_types_supported: ['authorization_code', 'refresh_token'],
  code_challenge_methods_supported: ['S256'],
  token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
  authorization_response_iss_parameter_supported: true,
  // offline_access is how ChatGPT asks to keep its refresh token; it grants no data access.
  scopes_supported: [...SCOPES, 'offline_access']
})
app.get('/.well-known/oauth-authorization-server', (_req, res) => res.json(oauthMetadata()))
// Some clients only look for OIDC discovery. No ID tokens are issued; the metadata is the same.
app.get('/.well-known/openid-configuration', (_req, res) => res.json(oauthMetadata()))
app.use(mcpAuthRouter({ provider, issuerUrl: ISSUER, resourceServerUrl: RESOURCE, scopesSupported: SCOPES, resourceName: 'openGym MCP' }))

// Settings → MCP / AI, reached through the api (api/mcp-proxy.js), which forwards the session
// cookie and the headers checked here. Same cross-origin rule as the api's own csrfOk().
function managementUser(req, res) {
  const user = provider.sessionUser(req)
  if (!user) { res.status(401).json({ error: 'not signed in' }); return null }
  if (req.method !== 'GET') {
    const site = req.headers['sec-fetch-site']
    if ((site && site !== 'same-origin' && site !== 'none') || (req.headers.origin && req.headers.origin !== AUTHORIZATION_URL.origin)) {
      res.status(403).json({ error: 'cross-origin request refused' }); return null
    }
  }
  return user
}
app.get('/manage', (req, res) => {
  const user = managementUser(req, res)
  if (user) res.set('Cache-Control', 'no-store').json(provider.manage(user))
})
app.post('/manage/revoke', (req, res) => {
  const user = managementUser(req, res)
  if (!user) return
  try { provider.revokeConnection(user, String(req.body?.id || '')); res.json({ ok: true }) }
  catch (err) { res.status(err.status || 400).json({ error: err.message }) }
})
app.post('/manage/approve', async (req, res) => {
  const user = managementUser(req, res)
  if (!user) return
  try {
    const request = provider.consumeApproval(user, String(req.body?.id || ''))
    const tool = WRITE_TOOLS.find(candidate => candidate.name === request.tool && candidate.destructive)
    if (!tool) throw Object.assign(new Error('deletion tool is unavailable'), { status: 409 })
    res.json(await executeTool(tool, { ...request.params, confirm: true }, request.authInfo))
  } catch (err) { res.status(err.status || 409).json({ error: err.message }) }
})

// Stateless transport: one server per request, bound to the caller's verified grant.
const auth = requireBearerAuth({ verifier: provider, requiredScopes: [], resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(RESOURCE) })
app.post('/mcp', auth, async (req, res) => {
  const server = createMcpServer({ authInfo: req.auth, requestApproval: (authInfo, tool, params) => provider.requestApproval(authInfo, tool, params) })
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
  try {
    await server.connect(transport)
    await transport.handleRequest(req, res, req.body)
  } catch (err) {
    console.error('[opengym-mcp] request failed', err)
    if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null })
  } finally {
    await transport.close().catch(() => {})
    await server.close().catch(() => {})
  }
})
const notAllowed = (_req, res) => res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null })
app.get('/mcp', auth, notAllowed)
app.delete('/mcp', auth, notAllowed)

const listener = app.listen(PORT, HOST, () => console.error(`[opengym-mcp] listening on ${HOST}:${PORT}`))
const shutdown = () => listener.close(() => process.exit(0))
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
