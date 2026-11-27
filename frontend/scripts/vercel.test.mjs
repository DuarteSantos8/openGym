import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

it('routes API requests to the hosted Render API over HTTPS', () => {
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'))
  const rewrite = config.rewrites.find(({ source }) => source === '/api/:path*')
  expect(rewrite?.destination).toMatch(/^https:\/\/[a-z0-9-]+\.onrender\.com\/api\/:path\*$/)
})
