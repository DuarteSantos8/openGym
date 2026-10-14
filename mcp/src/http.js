import { createMcpHandler } from '@modelcontextprotocol/server'
import { toNodeHandler } from '@modelcontextprotocol/node'
import { createServer } from './server.js'
import { createTrainingTools } from './tools.js'
import { createNutritionTools } from './nutrition.js'
import { defaultsShape } from './state.js'

const MaxBodyBytes = 64 * 1024

/** Embedded, stateless HTTP entrance. OpenGym verifies every call; SDK owns protocol handling. */
export function createHttpMcp({ oauth, readState, requestNutrition, json, takeBudget }) {
  const handler = createMcpHandler(({ authInfo }) => {
    const { token, extra: { principal } } = authInfo
    let snapshot
    const tools = [
      ...createTrainingTools({ getState: () => {
        if (snapshot === undefined) {
          const stored = readState(principal.user.id)
          snapshot = stored ? { ...defaultsShape(), ...stored } : null
        }
        return snapshot
      } }),
      ...createNutritionTools(async (method, pathname, query, body) => {
        const current = await oauth.verify(token, method === 'GET' ? 'nutrition.read' : 'nutrition.write')
        return requestNutrition(method, pathname, query, body, oauth.nutritionCredential(current, method, pathname))
      })
    ]
    return createServer(tools, { remote: true, authorize: scope => oauth.verify(token, scope),
      resourceMetadataUrl: oauth.resource.origin + '/.well-known/oauth-protected-resource' })
  }, { maxRequestBodySize: MaxBodyBytes })
  const node = toNodeHandler(handler, { maxRequestBodySize: MaxBodyBytes })
  return {
    close: () => handler.close(),
    async handle(req, res) {
      const challenge = `Bearer resource_metadata="${oauth.resource.origin}/.well-known/oauth-protected-resource", scope="${McpReadScopes}"`
      if (req.headers.host !== oauth.resource.host || (req.headers.origin && req.headers.origin !== oauth.resource.origin))
        return json(res, 403, { error: 'invalid_origin' })
      const token = /^Bearer ([^\s]+)$/.exec(req.headers.authorization || '')?.[1]
      try {
        if (!token) throw Object.assign(new Error('OAuth required'), { status: 401, code: 'invalid_token' })
        const principal = await oauth.verify(token)
        const retryAfter = takeBudget(principal.user.id)
        if (retryAfter) return json(res, 429, { error: 'rate_limited' }, { 'Retry-After': String(retryAfter) })
        req.auth = { token, clientId: principal.clientId, scopes: principal.scopes, extra: { principal } }
        await node(req, res)
      } catch (error) {
        if (!res.headersSent) json(res, error.status || 503, { error: error.code || 'mcp_unavailable' },
          error.status === 401 || error.status === 403 ? { 'WWW-Authenticate': challenge } : {})
      }
    }
  }
}
const McpReadScopes = 'training.read nutrition.read'
