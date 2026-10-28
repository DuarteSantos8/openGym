// Whether a read that used boxes the program found by itself can be trusted, judged from the read
// alone (no answer to compare with): names on most rows, read with some confidence, and, where a
// timer was followed, a countdown over most of the video. A read that fails this is not shown as
// done; the user is asked to mark the boxes instead (jobs.js).

import { countdownRuns } from './segment.js'

export const MIN_NAMED = 0.6      // share of rows that have a name
export const MIN_CONF = 0.5       // mean confidence of the rows
export const MIN_COVER = 0.6      // share of the video inside countdown runs, when it was timed

/**
 * Signals of one analysis: { timed, expectTimed, rows, namedShare, meanConf, runCover }.
 * `expectTimed`: a timer box was given, and the finder only gives one whose numbers count down.
 */
export function quality(frames, draft, timed, { expectTimed = false } = {}) {
  const rows = (draft?.sections || []).flatMap(s => s.rows || [])
  const runs = timed && frames.length ? countdownRuns(frames) : []
  const round = v => Math.round(v * 100) / 100
  return {
    timed: !!timed,
    expectTimed: !!expectTimed,
    rows: rows.length,
    namedShare: rows.length ? round(rows.filter(r => r.name).length / rows.length) : 0,
    meanConf: rows.length ? round(rows.reduce((t, r) => t + (r.conf || 0), 0) / rows.length) : 0,
    runCover: frames.length ? round(runs.reduce((t, r) => t + r.top + 1, 0) / frames.length) : 0
  }
}

/** True when the read is too thin to hand to the user as it is. */
export function poorRead(q) {
  if (!q) return false             // nothing measured: nothing to doubt
  if (!q.rows) return true
  if (q.namedShare < MIN_NAMED || q.meanConf < MIN_CONF) return true
  // A countdown was found in the video and the read could not follow it: the boxes are wrong.
  if (q.expectTimed && !q.timed) return true
  return q.timed && q.runCover < MIN_COVER
}
