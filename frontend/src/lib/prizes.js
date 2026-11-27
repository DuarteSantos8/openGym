// Presents that are kept for good (v1.4.6): the advent calendar's Saturday presents outlive the
// calendar, which starts empty every December (lib/advent.js). In the synced profile as a short
// list of known ids:  S.prizes = ['xmas-icon-2026', 'festive-flame']
// Only ids from PRIZES are kept, each once, so the field stays tiny whatever a device sends, and two
// copies merge by union (lib/sync-merge.js): a present once given is never taken back.

export const PRIZES = ['xmas-icon-2026', 'festive-flame']

/** The stored value made safe: the known ids, once each, in PRIZES order; null when none. */
export function cleanPrizes(v) {
  const have = new Set(Array.isArray(v) ? v : [])
  const out = PRIZES.filter(id => have.has(id))
  return out.length ? out : null
}

export const hasPrize = (S, id) => !!cleanPrizes(S?.prizes)?.includes(id)

/** Gives `id` inside an update(s => ...). True when it was new. */
export function grantPrize(s, id) {
  if (!PRIZES.includes(id) || hasPrize(s, id)) return false
  s.prizes = cleanPrizes([...(Array.isArray(s.prizes) ? s.prizes : []), id])
  return true
}

/** Two copies' prizes, for the sync merge: everything either one was given. */
export const mergePrizes = (a, b) => cleanPrizes([...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])]) || undefined
