import http from 'node:http'
import { discovery } from './oauth.js'

export function createServer({ origin, prefix }) {
  const d = discovery({ origin, prefix })
  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers })
    res.end(JSON.stringify(body))
  }
  return http.createServer((req, res) => {
    const { pathname } = new URL(req.url, 'http://x')
    if (req.method === 'GET') {
      if (pathname === `${prefix}/.well-known/oauth-protected-resource`) return send(res, 200, d.protectedResource)
      if (pathname === `/.well-known/oauth-authorization-server${prefix}`) return send(res, 200, d.authorizationServer)
    }
    // ponytail: stub MCP endpoint, no token validation yet -> always 401 (fails closed). Real check lands with /token.
    if (pathname === `${prefix}/mcp`) {
      return send(res, 401, { error: 'unauthorized' }, {
        'www-authenticate': `Bearer resource_metadata="${d.resourceMetadataUrl}"`,
      })
    }
    send(res, 404, { error: 'not_found' })
  })
}
