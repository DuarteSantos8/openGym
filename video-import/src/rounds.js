// Rounds: the smallest repeating sequence of exercise names in a block of intervals.
//
// [A, B, C, A, B, C, A, B, C] is three rounds of A-B-C. OCR leaves misreads in, and a video
// sometimes cuts a round short, so the match is a share rather than an equality: a period is
// accepted when at least MATCH of the positions after the first round repeat the name one
// period earlier. The smallest such period wins — [A, A, A, A] is four rounds of A, not two of
// A-A.

import { sameName } from './text.js'

export const MATCH = 0.8

/** { period, rounds, pattern } — period 0 when the names do not repeat at all. */
export function detectRounds(keys, same = sameName) {
  const n = (keys || []).length
  for (let p = 1; p <= n >> 1; p++) {
    let hits = 0
    for (let i = p; i < n; i++) if (same(keys[i], keys[i - p])) hits++
    if (hits / (n - p) >= MATCH) {
      return { period: p, rounds: Math.round(n / p), pattern: keys.slice(0, p) }
    }
  }
  return { period: 0, rounds: 1, pattern: (keys || []).slice() }
}
