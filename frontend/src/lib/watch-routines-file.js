// The routines the watch can start, as a file: the snapshot has a size limit (fitSnapshot drops
// routines from its end), a file has none. The snapshot names the file it goes with (routinesHash).
// The watch only compares the hash, it never works it out.
export function routinesFile (ready) {
  const others = ready?.others
  if (!Array.isArray(others) || !others.length) return null
  const body = JSON.stringify(others)
  let h = 0x811c9dc5
  for (const b of new TextEncoder().encode(body)) h = Math.imul(h ^ b, 0x01000193) >>> 0 // FNV-1a
  const hash = h.toString(36) + '.' + body.length
  return { hash, json: `{"h":"${hash}","others":${body}}` }
}
