// What a scanned QR code is to openGym (Plan > Scan a QR code, components/ScanCode.jsx). Pure:
// the text in, which handler it goes to out.
//   { kind: 'routine-link', payload }  a friend's routine, https://opengym.ch/r#... (lib/routine-link.js)
//   { kind: 'library', link }          a library routine's page, or another library page (lib/library-link.js)
//   { kind: 'tag', url }               an NFC sticker link, opengym.ch/nfc?... (lib/nfc-tags.js)
//   { kind: 'machine', code, ids }     a code linked to exercises (lib/machine-codes.js), when S is passed
//   { kind: 'unknown', text, code }    anything else, shown back as it was read (code: its 't:' form or null)
import { routinePayloadFromUrl } from './routine-link.js'
import { libraryLinkFromUrl } from './library-link.js'
import { parseTagUrl } from './nfc-tags.js'
import { codeFromQr, exercisesFor } from './machine-codes.js'

// A QR is often printed without the scheme ("opengym.ch/r#..."): read those as https.
const withScheme = s => (/^(www\.)?opengym\.ch\//i.test(s) ? 'https://' + s : s)

export function routeScannedText(raw, { indexAddress = null, S = null } = {}) {
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (!text) return { kind: 'unknown', text: '', code: null }
  const url = withScheme(text)
  const payload = routinePayloadFromUrl(url)
  if (payload) return { kind: 'routine-link', payload }
  if (parseTagUrl(url)) return { kind: 'tag', url }
  const link = libraryLinkFromUrl(url, indexAddress)
  if (link) return { kind: 'library', link }
  const code = codeFromQr(text)
  if (S && code) {
    const ids = exercisesFor(S, code)
    if (ids.length) return { kind: 'machine', code, ids }
  }
  return { kind: 'unknown', text, code }
}

/** The scanned text, short enough for a toast. */
export const shownText = (s, max = 80) => {
  const one = String(s || '').replace(/\s+/g, ' ').trim()
  return one.length > max ? one.slice(0, max - 1) + '…' : one
}
