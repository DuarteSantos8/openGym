// The cheap path: a video whose chapters (or a timestamped list in its description) already
// name every exercise needs no frame looked at. Pure — the input is yt-dlp's info JSON.
//
// A chapter becomes a block the same shape segment() makes, so the same classify() runs on it.
// Titles that only name a section ("Warm up", "Cool down") or say nothing about an exercise
// ("Intro", "Round 2", "Subscribe!") are not exercises: the first kind become section hints,
// the second kind are dropped. The list is usable when at least MIN_EXERCISES distinct titles
// are left.

import { normName, restOf, sectionWord } from './text.js'

export const MIN_EXERCISES = 3
// Exercises in a follow-along last seconds to a few minutes. Chapters that run for ten minutes
// each are the video's parts ("Group 1: Lower body"), and the exercises are inside them.
export const MAX_EXERCISE_CHAPTER = 240

// "Group 1: Lower body", "Part 2 - Upper", "Circuit 3", "Superset A", "Round 2: legs": the title
// of a part of the video, never an exercise.
const PART_RE = /^(group|part|block|circuit|superset|round|set|section|phase|level|tier|complex|grupa|czesc|blok|runda|obwod|teil|gruppe|bloque|parte|grupo|circuito|partie|bloc|circuit)\s*([0-9]+|[a-e]|one|two|three|four|five)\b/

const NOISE_RE = /^(intro|introduction|outro|welcome|hello|hi|subscribe|thanks|thank you|thank you for watching|end|the end|finish|finished|done|bonus|explanation|overview|tips|start|lets go|round \d+|set \d+|block \d+|circuit \d+|part \d+|runde \d+|seria \d+|serie \d+|exercise \d+|uebung \d+)$/

// What a section-only title says besides its section word: "Introduction and warm-up",
// "Dynamic mobility warm up", "Cool down & conclusion". Left with nothing else, it names no exercise.
const SECTION_FILLER = /\b(warm ?up|warming up|cool ?down|cooldown|stretch|stretching|mobility|dynamic|static|full body|intro|introduction|conclusion|outro|and|the|a|quick|short|final|rozgrzewka|rozciaganie|i|und|y|et|e)\b/g

// "1. Burpees", "Exercise 3 - Burpees", "03 | Burpees", "Burpees (40s)"
function cleanTitle(title) {
  return String(title || '')
    .replace(/^\s*(?:exercise|ex|uebung|cwiczenie)?\s*\d{1,2}\s*[.)|:\-–—]\s*/i, '')
    .replace(/\(\s*\d+\s*(?:s|sec|secs|seconds|sek)?\s*\)/gi, '')
    .replace(/\s+\d+\s*(?:s|sec|secs|seconds|sek)\b/gi, '')
    .replace(/[|•·]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** [{ start, end, title }] from a description: one "mm:ss Title" (or "Title mm:ss") per line. */
export function descriptionChapters(description, duration) {
  const out = []
  for (const line of String(description || '').split(/\r?\n/)) {
    let m = /^\s*[[(]?((?:\d{1,2}:)?\d{1,2}:\d{2})[\])]?\s*[-–—:|.]?\s*(.+?)\s*$/.exec(line)
    let ts, title
    if (m) { ts = m[1]; title = m[2] } else {
      m = /^\s*(.+?)\s*[-–—:|]?\s*[[(]?((?:\d{1,2}:)?\d{1,2}:\d{2})[\])]?\s*$/.exec(line)
      if (!m) continue
      title = m[1]; ts = m[2]
    }
    const start = ts.split(':').reduce((s, p) => s * 60 + +p, 0)
    out.push({ start, title })
  }
  out.sort((a, b) => a.start - b.start)
  // A list that does not start near zero or goes backwards is not a chapter list.
  const clean = out.filter((c, i) => i === 0 || c.start > out[i - 1].start)
  return clean.map((c, i) => ({ ...c, end: i + 1 < clean.length ? clean[i + 1].start : (duration || c.start) }))
}

/** { blocks, hints, usable, source } for the chapters, or the description's timestamps. */
export function metadataDraft(info) {
  const duration = Number(info?.duration) || 0
  let chapters = Array.isArray(info?.chapters) && info.chapters.length
    ? info.chapters.map(c => ({ start: Number(c.start_time) || 0, end: Number(c.end_time) || 0, title: c.title }))
    : []
  let source = 'chapters'
  if (chapters.length < MIN_EXERCISES) {
    chapters = descriptionChapters(info?.description, duration)
    source = 'description'
  }
  const blocks = [], hints = []
  const parts = []
  for (const c of chapters) {
    const dur = Math.max(0, Math.round(c.end - c.start))
    if (!dur) continue
    const text = cleanTitle(c.title)
    const key = normName(text)
    if (!key) continue
    const section = sectionWord(key)
    const r = restOf(key)
    // A chapter titled only "Warm up" is a section; "Warm up: arm circles" is an exercise in it.
    const bare = section && !key.replace(SECTION_FILLER, ' ').trim()
    if (bare) { hints.push({ start: c.start, end: c.end, kind: section }); continue }
    if (NOISE_RE.test(key)) continue
    // On the title with its numbers: normName drops digits, and "Group 1" is all in the number.
    const numbered = String(c.title || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}0-9]+/gu, ' ').trim()
    if (PART_RE.test(numbered)) { parts.push({ start: Math.round(c.start), end: Math.round(c.end), label: String(c.title || '').trim().slice(0, 60) }); continue }
    blocks.push({
      start: Math.round(c.start), end: Math.round(c.start) + dur, dur,
      kind: r.rest ? 'rest' : 'work', key, text, conf: 0.9,
      variants: { [key]: 1 }, next: r.next, resets: false, timerMax: null
    })
  }
  const work = blocks.filter(b => b.kind === 'work')
  const distinct = new Set(work.map(b => b.key))
  const durs = work.map(b => b.dur).sort((a, b) => a - b)
  const medianDur = durs.length ? durs[durs.length >> 1] : 0
  const usable = distinct.size >= MIN_EXERCISES && medianDur <= MAX_EXERCISE_CHAPTER
  return { blocks, hints, parts, usable, source, ...(usable ? {} : { why: !distinct.size && parts.length ? 'parts' : medianDur > MAX_EXERCISE_CHAPTER ? 'long' : 'few' }) }
}

/** The facts about a video the job and the result carry; nothing else from the info JSON. */
export function sourceOf(info, url) {
  return {
    url,
    id: String(info?.id || ''),
    title: String(info?.title || '').slice(0, 200),
    channel: String(info?.channel || info?.uploader || '').slice(0, 120),
    channelId: String(info?.channel_id || info?.uploader_id || '').slice(0, 80),
    duration: Number(info?.duration) || 0,
    width: Number(info?.width) || 0,
    height: Number(info?.height) || 0
  }
}
