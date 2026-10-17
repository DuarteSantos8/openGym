// Life Fitness console QR codes (LFconnect / Halo Fitness): what one says, read without a network.
//
// A cardio console shows two kinds of code (docs/LIFE_FITNESS_CARDIO_CONNECT.md, part A1):
//   - during a workout, from its connect menu: `…/q?t=c&a=…&u=…&l=…&x=…` — join it over Bluetooth
//   - at the end, when no app was connected: `…/q?t=c&r=<Base64 JSON>` — the whole summary in the
//     code itself, so scanning it is enough and works in the browser too
// `t=c&s=…` is the Bellus console's internet login and `t=s` the strength machines; neither is ours.
// The LF app accepts a code only when the text names `lfconnect` or `halo.fitness`; so do we, so
// any other code (our own `opengym:ex:` stickers included) is left to the next scan handler.

/** Whether a scanned text is a Life Fitness code at all. */
export const isLfCode = text => /lfconnect|halo\.fitness/i.test(String(text ?? ''))

/*
 * The query parameters as Android's Uri.getQueryParameter reads them: %-escapes decoded, a `+`
 * kept as `+`. URLSearchParams turns `+` into a space, which breaks the Base64 in `r`.
 */
function queryParams(text) {
  const s = String(text).trim()
  const q = s.indexOf('?')
  const out = {}
  if (q < 0) return out
  for (const part of s.slice(q + 1).split('#')[0].split('&')) {
    if (!part) continue
    const i = part.indexOf('=')
    const k = i < 0 ? part : part.slice(0, i)
    const v = i < 0 ? '' : part.slice(i + 1)
    try { out[decodeURIComponent(k)] = decodeURIComponent(v) } catch { out[k] = v }
  }
  return out
}

/** Base64 (standard or URL-safe, padding optional, whitespace ignored) to UTF-8 text, or null. */
export function decodeBase64Text(b64) {
  const clean = String(b64 ?? '').replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/')
  if (!clean || /[^A-Za-z0-9+/=]/.test(clean)) return null
  const padded = clean.replace(/=+$/, '') + '='.repeat((4 - (clean.replace(/=+$/, '').length % 4)) % 4)
  try {
    const bin = atob(padded)
    const bytes = Uint8Array.from(bin, c => c.charCodeAt(0))
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch { return null }
}

/**
 * What a Life Fitness code asks for:
 *   null                                   not a Life Fitness code
 *   { kind: 'result', data, isQa }         end-of-workout summary, `data` the parsed JSON
 *   { kind: 'ble', a, u, l, x, online, isQa }  connect over Bluetooth (native app only)
 *   { kind: 'invalid', isQa }              a result code whose payload does not decode
 *   { kind: 'unsupported', type, isQa }    a strength machine, a console login, …
 */
export function parseLfUrl(text) {
  if (!isLfCode(text)) return null
  const s = String(text).trim()
  const isQa = /vtqa/i.test(s)
  const p = queryParams(s)
  if (p.t === 'c') {
    if (p.s) return { kind: 'unsupported', type: 'console-login', isQa }
    if (p.r != null) {
      const data = decodeResultQr(p.r)
      return data ? { kind: 'result', data, isQa } : { kind: 'invalid', isQa }
    }
    return { kind: 'ble', a: p.a || '', u: p.u || '', l: p.l || '', x: p.x || '', online: p.c === '1', isQa }
  }
  return { kind: 'unsupported', type: p.t === 's' ? 'strength' : 'other', isQa }
}

/** The summary JSON a result code's `r` carries, or null when it is not one. */
export function decodeResultQr(r) {
  const text = decodeBase64Text(r)
  if (!text) return null
  try {
    const data = JSON.parse(text)
    return data && typeof data === 'object' && !Array.isArray(data) ? data : null
  } catch { return null }
}
