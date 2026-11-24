import { expect, it } from 'vitest'
import { config, mcpRewrites } from '../vercel.ts'

it('adds only MCP transport when its origin is configured', () => {
  expect(mcpRewrites()).toEqual([])
  expect(mcpRewrites('https://mcp.example'))
    .toEqual([
      { source: '/mcp', destination: 'https://mcp.example/mcp' },
      { source: '/mcp/:path*', destination: 'https://mcp.example/mcp/:path*' },
    ])
  expect(() => mcpRewrites('http://mcp.example')).toThrow('HTTPS origin')
})

it('routes API requests to the hosted Render API over HTTPS', () => {
  const rewrite = config.rewrites.find(({ source }) => source === '/api/:path*')
  expect(rewrite?.destination).toMatch(/^https:\/\/[a-z0-9-]+\.onrender\.com\/api\/:path\*$/)
})
