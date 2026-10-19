// Scores a draft against a fixture's expected answer. Pure functions, no I/O.
//
// Labels: an exercise name, 'rest', or null (intro, talking, outro: not scored). Names are
// compared the way the worker compares them (sameName), with any left/right taken off, so
// "Quad stretch left" in the expected timeline matches a per-side "Quad Stretch" row.

import { sameName, sideOf, normName } from '../../src/text.js'

export const BOUNDARY_TOL = 1   // seconds: a move that starts within this of the truth started on time

const isRest = l => l === 'rest'
const base = l => sideOf(normName(l)).base || normName(l)
export const sameLabel = (a, b) => (isRest(a) || isRest(b) ? a === b : a !== '?' && b !== '?' && sameName(base(a), base(b)))

/** [label, seconds][] → one label per second. */
export function expand(timeline) {
  return timeline.flatMap(([l, n]) => Array(n).fill(l))
}

/** The draft → one label per second: the row whose occurrence covers it, 'rest' elsewhere. */
export function predictedLabels(draft, seconds) {
  const out = Array(seconds).fill('rest')
  for (const s of draft.sections || []) for (const r of s.rows || []) for (const o of r.occurrences || []) {
    for (let t = Math.max(0, o.start); t < o.start + o.dur && t < seconds; t++) out[t] = r.name || '?'
  }
  return out
}

/** Runs of the same work label: [{ label, start, dur }]. Rest and unscored seconds split runs. */
export function workRuns(labels) {
  const runs = []
  labels.forEach((l, t) => {
    const last = runs[runs.length - 1]
    if (l == null || isRest(l)) return
    if (last && last.start + last.dur === t && last.label === l) last.dur++
    else runs.push({ label: l, start: t, dur: 1 })
  })
  return runs
}

/** The draft's moves as runs, from the occurrences themselves (a per-side row's left and right
 *  are two runs even back to back). Runs that start in an unscored stretch are dropped. */
export function predictedRuns(draft, want) {
  return (draft.sections || []).flatMap(s => (s.rows || []).flatMap(r => (r.occurrences || []).map(o => ({ label: r.name || '?', start: o.start, dur: o.dur }))))
    .filter(r => want[r.start] !== null && r.start < want.length)
    .sort((a, b) => a.start - b.start)
}

function editDistance(a, b, eq) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (eq(a[i - 1], b[j - 1]) ? 0 : 1))
  }
  return d[a.length][b.length]
}

const round3 = x => Math.round(x * 1000) / 1000

/**
 * fixture.expected + draft → metrics, each 0..1, higher is better:
 *   frames     seconds labelled right (work by name, rest as rest), over scored seconds
 *   sequence   1 − edit distance between the expected and predicted order of moves
 *   boundaries F1 of move starts matched within BOUNDARY_TOL
 *   sections   share of section fields right (count, kind, rounds, work, rest), when given
 * plus `startError`: mean |Δ| in seconds over matched starts (lower is better, informational).
 */
export function score(expected, draft) {
  const want = expand(expected.timeline)
  const got = predictedLabels(draft, want.length)

  let hit = 0, n = 0
  want.forEach((w, t) => { if (w == null) return; n++; if (sameLabel(w, got[t])) hit++ })

  // Moves that start in an unscored stretch are dropped, so an intro is neither right nor wrong.
  const wr = workRuns(want)
  const gr = predictedRuns(draft, want)
  const ed = editDistance(wr.map(r => r.label), gr.map(r => r.label), sameLabel)
  const sequence = 1 - ed / Math.max(1, wr.length, gr.length)

  const used = new Set()
  const errs = []
  for (const w of wr) {
    let best = -1
    gr.forEach((g, i) => {
      if (used.has(i) || Math.abs(g.start - w.start) > BOUNDARY_TOL) return
      if (best < 0 || Math.abs(g.start - w.start) < Math.abs(gr[best].start - w.start)) best = i
    })
    if (best >= 0) { used.add(best); errs.push(Math.abs(gr[best].start - w.start)) }
  }
  const p = gr.length ? errs.length / gr.length : 1
  const r = wr.length ? errs.length / wr.length : 1
  const boundaries = p + r ? (2 * p * r) / (p + r) : 0

  const m = {
    frames: round3(n ? hit / n : 1),
    sequence: round3(sequence),
    boundaries: round3(boundaries),
    startError: round3(errs.length ? errs.reduce((a, b) => a + b, 0) / errs.length : 0)
  }
  if (Array.isArray(expected.sections)) m.sections = round3(sectionScore(expected.sections, draft.sections || []))
  return m
}

function sectionScore(want, got) {
  let ok = want.length === got.length ? 1 : 0, total = 1
  want.forEach((w, i) => {
    const g = got[i] || {}
    for (const k of ['kind', 'rounds', 'work', 'rest']) {
      if (w[k] === undefined) continue
      total++; if (w[k] === g[k]) ok++
    }
  })
  return ok / total
}

/** What changed for the worse: metric → { was, now }, for drops larger than `eps`. */
export function regressions(baseline, now, eps = 0.005) {
  const out = {}
  for (const [k, was] of Object.entries(baseline || {})) {
    if (k === 'startError' || now[k] === undefined) continue
    if (now[k] < was - eps) out[k] = { was, now: now[k] }
  }
  return out
}
