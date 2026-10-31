// The Side Service's view of the server (app-side/index.js), as plain functions node can test.

/** What a person types as the address, as a base URL: "gym.example.com/" → "https://gym.example.com". */
export function cleanServer (v) {
  let s = typeof v === 'string' ? v.trim() : ''
  if (!s) return ''
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s
  s = s.replace(/\/+$/, '')
  // Only the address part: no spaces, nothing a URL cannot hold.
  return /^https?:\/\/[^\s/?#]+(\/[^\s?#]*)?$/i.test(s) ? s : ''
}

export const boxUrl = server => server + '/api/watch/box'
export const redeemUrl = server => server + '/api/watch/redeem'

/** The answer's body: the Zepp app hands it over parsed or as text, depending on the version. */
export function bodyOf (b) {
  if (b && typeof b === 'object') return b
  if (typeof b !== 'string' || !b) return null
  try { const o = JSON.parse(b); return o && typeof o === 'object' ? o : null } catch (e) { return null }
}
