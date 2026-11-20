// The textarea format for extra static headers on an endpoint: one `Name: value` per line, e.g. a
// gateway's routing/session header (opencode Go's `x-opencode-session`). The server admin's card and
// the phone's own setup screen both read and write it (issue #385, #1292), so it is one parser here
// rather than two that can drift apart.
//
// Parsing only, and no imports: whether a name is allowed, how many there may be and how long a value
// may run are validateHeaders()'s job (api/coach/core/providers.js), which every caller already has.
// Parsing happens in the screen on purpose: a typo then reads as a message where it was typed, not as a
// 400 the person has to decode. An empty field clears the map.
export const headersToText = h => h && typeof h === 'object'
  ? Object.entries(h).map(([k, v]) => `${k}: ${v}`).join('\n')
  : ''
export function parseHeadersText(text) {
  const lines = String(text || '').split('\n').map(l => l.trim()).filter(Boolean)
  if (!lines.length) return { headers: null }
  const out = {}
  for (const line of lines) {
    const i = line.indexOf(':')
    if (i < 1) return { error: `not a Name: value line: ${line.slice(0, 40)}` }
    const name = line.slice(0, i).trim()
    const value = line.slice(i + 1).trim()
    if (!name || !value) return { error: `not a Name: value line: ${line.slice(0, 40)}` }
    out[name] = value
  }
  return { headers: out }
}
