import http from 'node:http'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { discovery } from './oauth.js'

const connectPage = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'web/connect.html'))

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
      if (pathname === `${prefix}/connect`) {
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
          'x-frame-options': 'DENY',
          'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
        })
        return res.end(connectPage)
      }
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
