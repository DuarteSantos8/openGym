import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'))
const headersFor = source => Object.fromEntries((config.headers.find(h => h.source === source)?.headers || []).map(({ key, value }) => [key, value]))

it('routes API requests to the hosted Render API over HTTPS', () => {
  const rewrite = config.rewrites.find(({ source }) => source === '/api/:path*')
  expect(rewrite?.destination).toMatch(/^https:\/\/[a-z0-9-]+\.onrender\.com\/api\/:path\*$/)
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
