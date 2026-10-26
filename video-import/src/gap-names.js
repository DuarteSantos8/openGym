// Names for runs of a countdown that no caption named.
//
// A warm-up or a stretch has no rests: the moves follow one another, the countdown starts over, and
// the name of the next move shows in the last seconds of the one before it, often in a corner (a
// small preview with its caption) where the name box of the main sets does not look. So for each
// unnamed timed run, the tail of the run before it is read whole, and the caption that shows in
// most of those moments is the name. A caption seen once is noise; no name is better than a wrong one.

import { readMoments, columnRegions, captionLine, SIDE_TOKEN } from './auto-roi.js'
import { sameName, sectionTitle, cleanCaption, normName, similarity, sideOf, knownShare } from './text.js'

const TAIL = [8, 7, 6, 5, 4, 3, 2, 1]  // seconds before a run starts that are read (a preview can show for only 3 or 4 of them)
const DURING = [3, 6, 9, 12]      // seconds into the run that are read: the caption of the move being done (before the next one's preview)
const PREVIEW = 10                // the last seconds of a run are left alone: they show the next move's name
const LOOK_BACK = 12              // never further back than this, nor into the run before that
const MIN_VOTES = 2
const OWN = [0.25, 0.55]          // where in the move before its own caption is read (a preview is only at the end)
const OWN_CONF = 80               // a word is the move before's own when it is read this surely there ...
const LONGER = 1.3                // ... but only for a run this much longer than the move before: a rest, which has no name of its own
const OWN_SHARE = 0.4             // ... and this share of a candidate's words (at least two) are such words
const OUT_H = 160                 // narrow pieces are read this tall (a small "UP NEXT" card is lost at less)
const MIN_KNOWN = 0.34            // looser than the name box's: a name is only taken when it shows again and again
const GAP_K = 8                   // words of a caption set wide ("SWING & STEP") stay one line
const MIN_WORD_CONF = 75          // a word the OCR was less sure of is left out of the name (specks next to a caption) ...
const MIN_LONG_WORD_CONF = 55     // ... unless it is a real-sized word
const SAME_LENGTH = 3             // the other side takes as long as the first, give or take this many seconds
const MAX_SWITCH = 40             // the longest stretch between a move and itself on the other side, in seconds
const MAX_REPEATS = 2             // one name that wins this many runs is a label of the video, not a move
const MIN_DUR = 15                // a run shorter than this is not a move
const MAX_DUR = 180
const DOUBTFUL_CONF = 0.6         // a named run read less surely than this, with words nobody knows, is asked again
const DOUBTFUL_KNOWN = 0.5

/** The same move, as the OCR spelled it: the start of the longer name may carry a note after it. */
function nearly(a, b) {
  if (sameName(a, b)) return true
  const [x, y] = [normName(a), normName(b)].sort((p, q) => p.length - q.length)
  if (x.length >= 5 && similarity(x, y.slice(0, x.length + 2)) >= 0.8) return true
  // Only a stretch of the longer name (its end, or its middle, while the rest of it is cut off or covered).
  if (x.length >= 8 && y.includes(x)) return true
  // The same words in another order, a few of them garbled ("each split side squat" for "split squat (each side)").
  const wa = new Set(x.split(' ').filter(w => w.length >= 3)), wb = new Set(y.split(' ').filter(w => w.length >= 3))
  const shared = [...wa].filter(w => wb.has(w)).length
  return shared >= 3 && shared / (wa.size + wb.size - shared) >= 0.6
}

// What a screen between moves says: not a move.
const OVERLAY_RE = /^(switch sides?|change sides?|round \d+|water break|get ready|rest|break|take a break|next|next up|up next|up first|end of .*|link\b.*|block\b.*|workout details|subscribe|like|follow us|well done|good job|great job|that'?s it)$/

/** A reading's caption as a name, or null when it is not one: empty, the NEXT label, a screen between moves, a section title, the move before. */
export function usableText(l, exclude = [], own = null) {
  if (!l) return null
  const text = cleanCaption(l.text).replace(/^\s*next\s+/i, '').trim()
  if (!/\p{L}{3}/u.test(text) || OVERLAY_RE.test(normName(text)) || sectionTitle(text) || exclude.some(e => nearly(e, text)) || (own && own(text))) return null
  return text
}

/**
 * The name a few readings agree on: `lines` is one { text, conf } (or null) per moment, `exclude`
 * names that are not it (the move before, which can still be on screen). { text, conf, votes } or null.
 */
export function voteName(lines, { exclude = [], own = null } = {}) {
  const groups = []
  for (const l of lines) {
    const text = usableText(l, exclude, own)
    if (!text) continue
    const g = groups.find(x => sameName(x.text, text))
    if (g) { g.votes++; g.conf += l.conf; if (text.length > g.text.length) g.text = text } else groups.push({ text, votes: 1, conf: l.conf })
  }
  groups.sort((a, b) => b.votes - a.votes || b.conf - a.conf)
  const [best, second] = groups
  if (!best || best.votes < MIN_VOTES || (second && second.votes === best.votes)) return null
  return { text: best.text, conf: Math.round(best.conf / best.votes), votes: best.votes }
}

/** The move before, for its other side, spelled as it was: "Hip flexor (R)" → "Hip flexor (L)", "(right)" → "(left)". */
export function otherSide(text) {
  const m = /\s*[(\[]?\s*(right|left|r|l)\s*[)\]]?\s*$/i.exec(text)
  const left = sideOf(text).side === 'L'
  const mark = m && m[1].length > 1 ? (left ? 'right' : 'left') : (left ? 'R' : 'L')
  return `${m ? text.slice(0, m.index) : text} (${mark})`
}

/**
 * Names for the timed gaps of `blocks` (and for runs named doubtfully): [{ index, text, conf, votes }]. Reads the frame whole, at
 * a few moments before each gap (its preview) and early in it (its own caption).
 */
export async function nameGaps(file, blocks, { dims, workDir, signal } = {}) {
  const jobs = []
  blocks.forEach((b, i) => {
    const unnamed = b.kind === 'gap' && b.timed && !b.text
    const doubtful = b.kind === 'work' && b.text && b.conf < DOUBTFUL_CONF && knownShare(b.text) < DOUBTFUL_KNOWN
    if (!(unnamed || doubtful) || b.dur < MIN_DUR || b.dur > MAX_DUR) return
    const lo = Math.max(0, b.start - LOOK_BACK, i > 0 ? blocks[i - 1].start + 1 : 0)
    const tail = TAIL.map(d => b.start - d).filter(t => t >= lo && t < b.start && t < dims.duration)
    const during = DURING.map(d => b.start + d).filter(t => t <= b.end - PREVIEW && t < dims.duration)
    // What the move before says about itself, from the middle of it (a preview is only at the end).
    const prev = i > 0 ? blocks[i - 1] : null
    const mids = prev && prev.kind !== 'rest' && prev.dur >= MIN_DUR ? OWN.map(f => Math.round(prev.start + prev.dur * f)) : []
    if (tail.length + during.length >= MIN_VOTES) jobs.push({ index: i, tail, during, mids })
  })
  if (!jobs.length) return []
  // Narrow pieces of the frame, not whole rows: a small "UP NEXT" card is read out of a piece 40% wide
  // and not out of a row. No piece is skipped for the timer: its digits are not captions.
  const regions = columnRegions()
  const o = { width: dims.width, avoid: [], keepSides: true, maxH: 0.8 * OUT_H }
  const read = times => (times.length ? readMoments(file, times, { dims, workDir, signal, outH: OUT_H, regions }) : Promise.resolve(regions.map(() => [])))
  /** The best caption of the frame at moment `p` of `readings`: { text, letters, conf } or null. */
  const lineAt = (readings, p) => {
    let best = null
    for (let s = 0; s < regions.length; s++) {
      const ln = captionLine(readings[s][p], o, MIN_KNOWN, GAP_K)
      // A line that is all in brackets is a subtitle ("(FULL BODY ACTIVATION)"), not the move's name.
      if (!ln || /^\W*[(\[].*[)\]]\W*$/.test(ln.text)) continue
      const sure = ln.words.filter(w => w.conf >= MIN_WORD_CONF || (w.conf >= MIN_LONG_WORD_CONF && ((w.text.match(/\p{L}/gu) || []).length >= 4 || SIDE_TOKEN.test(w.text))))
      const text = sure.map(w => w.text).join(' ')
      const letters = (text.match(/\p{L}/gu) || []).length
      if (letters >= 6 && (!best || letters > best.letters)) best = { text, letters, conf: sure.reduce((t, w) => t + w.conf, 0) / sure.length }
    }
    return best
  }
  // The preview in the move before, for every run; then the caption of the move itself, only for the
  // runs the preview did not name.
  const tails = await read(jobs.flatMap(j => [...j.mids, ...j.tail]))
  /** The words read surely at moment `p`, lowercased: what is on the screen then. */
  const wordsAt = (readings, p) => regions.flatMap((_, s) => (readings[s][p] || []).filter(w => w.conf >= OWN_CONF).map(w => w.text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')))
  let p = 0
  for (const j of jobs) {
    // What the move before says about itself: its words, as the OCR read them, whatever it made of the line.
    const ownWords = new Set(j.mids.flatMap(() => wordsAt(tails, p++)).filter(w => w.length >= 4))
    const rest = blocks[j.index - 1] && blocks[j.index].dur >= LONGER * blocks[j.index - 1].dur
    j.own = text => {
      if (!rest) return false
      const ws = normName(text).split(' ').filter(w => w.length >= 4)
      const hit = ws.filter(w => ownWords.has(w)).length
      return hit >= 2 && hit / ws.length >= OWN_SHARE
    }
    j.tailLines = j.tail.map(() => lineAt(tails, p++))
    const prev = blocks[j.index - 1]
    j.exclude = prev?.text ? [prev.text] : []
    j.fromTail = voteName(j.tailLines, { exclude: j.exclude, own: j.own })
  }
  const later = jobs.filter(j => !j.fromTail && j.during.length)
  const duringReads = await read(later.flatMap(j => j.during))
  p = 0
  for (const j of later) j.duringLines = j.during.map(() => lineAt(duringReads, p++))

  const out = []
  for (const j of jobs) {
    // The move before: its name, from the screen or from this pass.
    const known = k => blocks[k].text || out.find(n => n.index === k)?.text
    let k = j.index - 1
    while (k >= 0 && !(blocks[k].kind !== 'rest' && known(k))) k--
    const before = k >= 0 ? sideOf(known(k)) : null
    const fromDuring = j.fromTail ? null : voteName(j.duringLines || [], { exclude: j.exclude, own: j.own })
    const named = j.fromTail || fromDuring
    // Only a run as long as the move before can be that move on its other side; a rest is not.
    const near = k >= 0 && j.index - k <= 3 && blocks[j.index].start - blocks[k].end <= MAX_SWITCH && Math.abs(blocks[j.index].dur - blocks[k].dur) <= SAME_LENGTH
    if (named) {
      // "Hip/ham stretch (R)", then "Hip/ham stretch" with its bracket cut off by the picture: the other side.
      const mine = sideOf(named.text)
      const text = near && before?.side === 'R' && !mine.side && sameName(before.base, mine.base || named.text) ? otherSide(known(k)) : named.text
      out.push({ index: j.index, via: j.fromTail ? 'tail' : 'during', ...named, text })
    } else if (near && before?.side === 'R' && !j.tailLines.some(l => usableText(l, j.exclude, j.own))) {
      // The move before was its right side ("Hip flexor (R)"; the left comes second, as in these videos)
      // and no preview names another move: after the side is switched it is the same move again, on
      // the other side. (A preview that shows even part of another name, as it is typed out, says it is not.)
      out.push({ index: j.index, via: 'side', text: otherSide(known(k)), conf: 70, votes: 1 })
    }
  }
  // A "name" that won three runs or more is on screen all the time (a logo, a channel name). One
  // read from inside its own run says what is on screen then, so it must be the only run with it.
  const same = (n, via) => out.filter(m => (!via || m.via === via) && sameName(m.text, n.text)).length
  return out.filter(n => (n.via === 'side' ? true : n.via === 'tail' ? same(n, 'tail') <= MAX_REPEATS : same(n) === 1)).map(({ via, ...n }) => n)
}
