import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'))
const headersFor = source => Object.fromEntries((config.headers.find(h => h.source === source)?.headers || []).map(({ key, value }) => [key, value]))

// Cutover (docs/deployment/CUTOVER.md): one public origin. /api, the OAuth discovery documents
// and the MCP transport all go to Railway, and /api plus discovery must name the same API host:
// connector sign-ins and authorization codes live in that one API process's memory.
const API = 'https://ironvane-api-production.up.railway.app'
const MCP = 'https://ironvane-mcp-production.up.railway.app'
const DISCOVERY = [
  '/.well-known/oauth-protected-resource/mcp',
  '/.well-known/oauth-protected-resource',
  '/.well-known/oauth-authorization-server',
  '/.well-known/openid-configuration',
]
const rewriteFor = source => config.rewrites.find(r => r.source === source)
const PROXIED = ['/api/:path*', '/mcp', '/mcp/health', ...DISCOVERY]

it('routes the web app API to the Railway API over HTTPS', () => {
  expect(rewriteFor('/api/:path*')?.destination).toBe(`${API}/api/:path*`)
})

it('routes the MCP transport and its health check to the Railway MCP service', () => {
  expect(rewriteFor('/mcp')?.destination).toBe(`${MCP}/mcp`)
  expect(rewriteFor('/mcp/health')?.destination).toBe(`${MCP}/mcp/health`)
})

it('serves every OAuth discovery document from the same API host as /api', () => {
  for (const source of DISCOVERY) expect(rewriteFor(source)?.destination, source).toBe(API + source)
})

it('lists the specific rules before the /api catch-all and proxies nothing else', () => {
  const order = config.rewrites.map(r => r.source)
  expect(order.at(-1)).toBe('/api/:path*')
  expect([...order].sort()).toEqual([...PROXIED].sort())
  for (const r of config.rewrites) expect(r.destination, r.source).toMatch(/^https:\/\//)
})

it('keeps every proxied path out of the CDN cache', () => {
  for (const source of PROXIED) expect(headersFor(source)['x-vercel-enable-rewrite-caching'], source).toBe('0')
})

// Vercel projects created on or after 2026-04-06 cache external rewrites by default, honouring
// upstream cache headers. The API's answers are per-person (sessions, workout data, media), so
// the proxy must stay a pass-through whatever the project's creation date.
it('never lets the CDN cache proxied API responses', () => {
  expect(headersFor('/api/:path*')['x-vercel-enable-rewrite-caching']).toBe('0')
})

// The same baseline every self-hosted web container sends (web/nginx.conf.template), so a hosted
// build cannot be framed or have its responses type-sniffed where a self-hosted one cannot.
it('sends the self-hosted image baseline security headers on every response', () => {
  const nginx = readFileSync(new URL('../../web/nginx.conf.template', import.meta.url), 'utf8')
  const all = headersFor('/(.*)')
  for (const key of ['X-Frame-Options', 'X-Content-Type-Options', 'Referrer-Policy']) {
    const want = nginx.match(new RegExp(`add_header ${key} "([^"]+)" always;`))?.[1]
    expect(want, key).toBeTruthy()
    expect(all[key], key).toBe(want)
  }
})
