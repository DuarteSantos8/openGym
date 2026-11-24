const apiOrigin = 'https://ironvane-api.onrender.com'

export function mcpRewrites(destination?: string) {
  if (!destination) return []
  const origin = new URL(destination)
  if (origin.protocol !== 'https:' || (destination !== origin.origin && destination !== origin.origin + '/')) {
    throw new Error('IRONVANE_MCP_ORIGIN must be an HTTPS origin')
  }
  return [
    { source: '/mcp', destination: origin.origin + '/mcp' },
    { source: '/mcp/:path*', destination: origin.origin + '/mcp/:path*' },
  ]
}

export const config = {
  buildCommand: 'npm run build && node ../scripts/catalogue/check-media.mjs && node ../scripts/catalogue/stage-media.mjs dist && node ../scripts/catalogue/stage-photos.mjs dist',
  rewrites: [
    { source: '/api/:path*', destination: apiOrigin + '/api/:path*' },
    ...mcpRewrites(process.env.IRONVANE_MCP_ORIGIN),
  ],
  headers: [{"source":"/exercise-media/(.*)","headers":[{"key":"Cross-Origin-Resource-Policy","value":"same-origin"},{"key":"Cache-Control","value":"public, max-age=2592000, immutable"}]},{"source":"/(exercise-photos|exercise-demos)/files/(.*)","headers":[{"key":"Cache-Control","value":"public, max-age=2592000, immutable"}]}],
}
