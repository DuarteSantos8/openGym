// The link's framing (wire.md section 2): Wear Engine carries 1 KB of text per message, so one JSON
// text travels as up to 16 numbered frames "<id>.<i>.<n>|<part>". The phone has the same codec in Java;
// test/frames.json holds the vectors both must agree on. No regular expressions: the lite engine may
// not have them, and the header is simple to read by hand.

export const PART = 960
export const MAX_PARTS = 16

// Every character outside 0x20..0x7E becomes \uXXXX (lower-case hex). In JSON such characters only
// occur inside strings, so JSON.parse gives the original text back. Text that needs nothing comes back
// as it is, and the rest is joined from pieces: a `+` per character would copy the string each time.
export function escape (text) {
  const out = []
  let from = 0
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code >= 0x20 && code <= 0x7e) continue
    out.push(text.substring(from, i), '\\u' + ('0000' + code.toString(16)).slice(-4))
    from = i + 1
  }
  if (from === 0) return text
  out.push(text.substring(from))
  return out.join('')
}

// The frames of one message, or null when it needs more than 16.
export function frames (text, id) {
  const esc = escape(text)
  const n = Math.max(1, Math.ceil(esc.length / PART))
  if (n > MAX_PARTS) return null
  const out = []
  for (let i = 0; i < n; i++) out.push(id + '.' + i + '.' + n + '|' + esc.substring(i * PART, (i + 1) * PART))
  return out
}

const isDigits = s => s.length > 0 && s.length <= 3 && s.split('').every(ch => ch >= '0' && ch <= '9')
const isId = s => s.length > 0 && s.length <= 6 && s.split('').every(ch => (ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'z'))

// [id, i, n, part] from a frame, or null when it is none of ours.
export function parse (frame) {
  if (typeof frame !== 'string') return null
  const bar = frame.indexOf('|')
  if (bar < 0) return null
  const head = frame.substring(0, bar).split('.')
  if (head.length !== 3 || !isId(head[0]) || !isDigits(head[1]) || !isDigits(head[2])) return null
  const i = parseInt(head[1], 10)
  const n = parseInt(head[2], 10)
  if (n < 1 || n > MAX_PARTS || i >= n) return null
  return [head[0], i, n, frame.substring(bar + 1)]
}

// The receiving end: one message in the making. accept(frame) gives the joined (still escaped) text
// when the last part arrives, else null. A frame of another message drops what was gathered.
export function createReceiver () {
  let cur = null
  return {
    // true while part of a message is gathered
    busy: function () { return cur !== null },
    accept: function (frame) {
      const p = parse(frame)
      if (!p) return null
      if (!cur || cur.id !== p[0] || cur.n !== p[2]) cur = { id: p[0], n: p[2], parts: [], have: 0 }
      if (cur.parts[p[1]] === undefined) cur.have += 1
      cur.parts[p[1]] = p[3]
      if (cur.have < cur.n) return null
      const text = cur.parts.join('')
      cur = null
      return text
    }
  }
}
