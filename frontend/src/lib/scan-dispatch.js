// One scanner, several kinds of code. The workout's scan button reads a code once and hands it
// here: each handler says whether the text is one of its own (`match` returns what it read, or
// null), and the first that recognises it handles it. The exercise stickers (lib/exercise-qr.js)
// come last and take anything, as they always did — so a code no other handler knows behaves
// exactly as before.

/**
 * The handler a scanned text belongs to: { handler, match } for the first handler whose
 * `match(text, context)` returns something other than null/undefined/false, or null.
 */
export function dispatchScan(text, handlers, context) {
  for (const handler of handlers || []) {
    if (!handler || typeof handler.match !== 'function') continue
    let match
    try { match = handler.match(text, context) } catch { match = null }
    if (match != null && match !== false) return { handler, match }
  }
  return null
}

/** Dispatches and runs: true when a handler took the code. */
export function handleScannedCode(text, handlers, context) {
  const hit = dispatchScan(text, handlers, context)
  if (!hit) return false
  hit.handler.handle(hit.match, context, text)
  return true
}
