// Heart rate per set, from the Apple Watch (lib/watch-sync.js, ios/App/Watch). Two optional
// fields on a logged set, written only when the watch measured something:
//
//   hr      { avg, max }  beats per minute while the set was done (from its start to its tick)
//   restHr  { avg, max }  during the rest after it
//
// Nothing else changes: a set without them is exactly the set it always was, and every reader
// that does not know them (older apps, the server, the exports) carries them along untouched.

const BPM_MIN = 25
const BPM_MAX = 250

/** { avg, max } as whole beats per minute, or null for anything that is not a plausible reading. */
export function sanitizeHr(v) {
  if (!v || typeof v !== 'object') return null
  const avg = Math.round(Number(v.avg)), max = Math.round(Number(v.max))
  if (!Number.isFinite(avg) || !Number.isFinite(max)) return null
  if (avg < BPM_MIN || avg > BPM_MAX || max < BPM_MIN || max > BPM_MAX || max < avg) return null
  return { avg, max }
}

/** " ♥ 132/151" after a set's label, or '' for a set without a reading. */
export function hrLabel(set) {
  const hr = sanitizeHr(set && set.hr)
  return hr ? ` ♥ ${hr.avg}/${hr.max}` : ''
}
