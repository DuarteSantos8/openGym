// What a video's chapters can still do once its frames are the main source: name the moves the
// screen never names. Some creators show nothing during a clustered set (the demo card says
// "right press, left press, both"), but write it in the chapters. Pure: a draft and the chapters
// as metadata.js makes them, nothing else.
//
// Chapters are only trusted for what they overlap and only when they read like exercises: a list
// of songs ("1. HUGEL - Better.") or the segments of a talk is also a chapter list.

import { normName, similarity, displayName, knownShare } from './text.js'

// The share of a title's words the exercise library knows, below which it is not an exercise.
const MIN_LIKE = 0.5
// How much of a row has to run inside a chapter for the chapter to name it.
const MIN_OVERLAP = 0.6
// A name read with less confidence than this may be replaced by a chapter that looks like it.
const DOUBTFUL = 0.5
const SIMILAR = 0.4

/** Whether a chapter title reads like the name of an exercise. */
export function exerciseLike(title) {
  const key = normName(title)
  if (!key || key.length > 60 || key.split(' ').length > 8) return false
  return knownShare(key) >= MIN_LIKE
}

/**
 * Name the rows of `draft` from `chapters` ([{ kind, key, text, start, dur }]) where they have
 * none, or only a doubtful one the chapter confirms. Changes the draft in place; the number of
 * rows it named.
 */
export function enrichFromChapters(draft, chapters) {
  const named = (chapters || []).filter(c => c && c.kind !== 'rest' && c.dur > 0 && exerciseLike(c.text))
  if (!named.length || !draft?.sections) return 0
  let n = 0
  for (const section of draft.sections) {
    for (const row of section.rows || []) {
      const o = row.occurrences?.[0]
      if (!o || !(o.dur > 0)) continue
      const best = named
        .map(c => ({ c, share: Math.max(0, Math.min(o.start + o.dur, c.start + c.dur) - Math.max(o.start, c.start)) / o.dur }))
        .filter(x => x.share >= MIN_OVERLAP)
        .sort((a, b) => b.share - a.share)[0]
      if (!best) continue
      const key = normName(best.c.text)
      if (!row.name) {
        Object.assign(row, { name: displayName(best.c.text), key, conf: 0.6, fromChapter: true })
        delete row.unnamed
        n++
      } else if ((row.conf ?? 1) < DOUBTFUL && similarity(row.key || row.name, key) >= SIMILAR) {
        Object.assign(row, { name: displayName(best.c.text), key, conf: Math.max(row.conf || 0, 0.7), fromChapter: true })
        n++
      }
    }
  }
  return n
}
