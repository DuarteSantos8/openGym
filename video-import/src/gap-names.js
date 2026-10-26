// Names for runs of a countdown that no caption named.
//
// A warm-up or a stretch has no rests: the moves follow one another, the countdown starts over, and
// the name of the next move shows in the last seconds of the one before it, often in a corner (a
// small preview with its caption) where the name box of the main sets does not look. So for each
// unnamed timed run, the tail of the run before it is read whole, and the caption that shows in
// most of those moments is the name. A caption seen once is noise; no name is better than a wrong one.

import { readMoments, stripGeometry, captionLine } from './auto-roi.js'
import { sameName, sectionTitle, cleanCaption, normName, similarity } from './text.js'

const TAIL = [10, 8, 6, 4, 2]     // seconds before a run starts that are read
const LOOK_BACK = 12              // never further back than this, nor into the run before that
const MIN_VOTES = 2
const MIN_KNOWN = 0.34            // looser than the name box's: a name is only taken when it shows again and again
const MAX_REPEATS = 2             // one name that wins this many runs is a label of the video, not a move
const MIN_DUR = 15                // a run shorter than this is not a move
const MAX_DUR = 180

/** The same move, as the OCR spelled it: the start of the longer name may carry a note after it. */
function nearly(a, b) {
  if (sameName(a, b)) return true
  const [x, y] = [normName(a), normName(b)].sort((p, q) => p.length - q.length)
  return x.length >= 5 && similarity(x, y.slice(0, x.length + 2)) >= 0.8
}

/**
 * The name a few readings agree on: `lines` is one { text, conf } (or null) per moment, `exclude`
 * names that are not it (the move before, which can still be on screen). { text, conf, votes } or null.
 */
export function voteName(lines, { exclude = [] } = {}) {
  const groups = []
  for (const l of lines) {
    if (!l) continue
    const text = cleanCaption(l.text).replace(/^\s*next\s+/i, '').trim()
    if (!/\p{L}{3}/u.test(text) || /^next$/i.test(text) || sectionTitle(text) || exclude.some(e => nearly(e, text))) continue
    const g = groups.find(x => sameName(x.text, text))
    if (g) { g.votes++; g.conf += l.conf; if (text.length > g.text.length) g.text = text } else groups.push({ text, votes: 1, conf: l.conf })
  }
  groups.sort((a, b) => b.votes - a.votes || b.conf - a.conf)
  const [best, second] = groups
  if (!best || best.votes < MIN_VOTES || (second && second.votes === best.votes)) return null
  return { text: best.text, conf: Math.round(best.conf / best.votes), votes: best.votes }
}

/**
 * Names for the timed gaps of `blocks`: [{ index, text, conf, votes }]. Reads the frame whole, at
 * a few moments before each gap; `avoid` is the timer boxes, whose columns are skipped.
 */
export async function nameGaps(file, blocks, { dims, workDir, signal, avoid = [] } = {}) {
  const jobs = []
  blocks.forEach((b, i) => {
    if (b.kind !== 'gap' || !b.timed || b.text || b.dur < MIN_DUR || b.dur > MAX_DUR) return
    const lo = Math.max(0, b.start - LOOK_BACK, i > 0 ? blocks[i - 1].start + 1 : 0)
    const times = TAIL.map(d => b.start - d).filter(t => t >= lo && t < b.start && t < dims.duration)
    if (times.length >= MIN_VOTES) jobs.push({ index: i, times })
  })
  if (!jobs.length) return []
  const all = jobs.flatMap(j => j.times)
  const readings = await readMoments(file, all, { dims, workDir, signal })
  const { list, scale } = stripGeometry(dims)
  const o = { width: dims.width * scale, avoid }
  const out = []
  let p = 0
  for (const j of jobs) {
    const lines = j.times.map(() => {
      let best = null
      for (let s = 0; s < list.length; s++) {
        const ln = captionLine(readings[s][p], o, MIN_KNOWN)
        // A line that is all in brackets is a subtitle ("(FULL BODY ACTIVATION)"), not the move's name.
        if (ln && !/^\W*[(\[].*[)\]]\W*$/.test(ln.text) && (!best || ln.letters > best.letters)) best = { ...ln, conf: ln.words.reduce((t, w) => t + w.conf, 0) / ln.words.length }
      }
      p++
      return best
    })
    const prev = blocks[j.index - 1]
    const named = voteName(lines, { exclude: prev?.text ? [prev.text] : [] })
    if (named) out.push({ index: j.index, ...named })
  }
  // A "name" that won three runs or more is on screen all the time (a logo, a channel name).
  return out.filter(n => out.filter(m => sameName(m.text, n.text)).length <= MAX_REPEATS)
}
