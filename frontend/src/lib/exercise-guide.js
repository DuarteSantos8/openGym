// Readers for the per-exercise form guidance (content/exercise-guides.js, EP23). Pure. The
// content is a few dozen kilobytes of text, so the one screen that shows it
// (components/ExerciseGuide.jsx) is loaded on demand and brings this file with it.
import { EXERCISE_GUIDES, PATTERNS } from '../content/exercise-guides.js'

export const GUIDE_LEVELS = ['beginner', 'intermediate', 'advanced']

/** The guide for a catalogue id, or null. */
export const guideFor = id => (id != null && Object.hasOwn(EXERCISE_GUIDES, String(id)) ? EXERCISE_GUIDES[String(id)] : null)

/** Every id that has a guide. */
export const guidedIds = () => Object.keys(EXERCISE_GUIDES)

/**
 * The easier and the harder version of an exercise, as catalogue ids, each only when `exists(id)`
 * says the catalogue still has it: { easier, harder }, either may be null.
 */
export function ladderFor(id, exists = () => true) {
  const g = guideFor(id)
  const ok = x => (x != null && String(x) !== String(id) && exists(String(x)) ? String(x) : null)
  return { easier: ok(g?.easier), harder: ok(g?.harder) }
}

/** Whether a named person has read this guide. Only then may a screen say so. */
export const isReviewed = g => !!g && g.review === 'reviewed' && typeof g.reviewer === 'string' && g.reviewer.trim().length > 0

/**
 * What is wrong with the guides, as a list of sentences; empty when nothing is. `exists(id)`
 * says whether the catalogue has an exercise. Used by the test, and cheap enough to run by hand:
 *   node -e "import('./src/lib/exercise-guide.js').then(m => console.log(m.problems()))"
 */
export function problems(exists = () => true) {
  const out = []
  for (const [id, g] of Object.entries(EXERCISE_GUIDES)) {
    const say = msg => out.push(`${id}: ${msg}`)
    if (!exists(id)) say('not in the catalogue')
    if (!GUIDE_LEVELS.includes(g.level)) say('level is not one of ' + GUIDE_LEVELS.join(', '))
    if (!PATTERNS.includes(g.pattern)) say('pattern is not one of the known patterns')
    if (!Array.isArray(g.cues) || g.cues.length < 3 || g.cues.length > 4 || g.cues.some(c => typeof c !== 'string' || c.trim().length < 10)) say('needs 3 or 4 cues')
    if (!Array.isArray(g.mistakes) || g.mistakes.length < 2 || g.mistakes.length > 3) say('needs 2 or 3 mistakes')
    else if (g.mistakes.some(m => !Array.isArray(m) || m.length !== 2 || m.some(x => typeof x !== 'string' || x.trim().length < 5))) say('every mistake needs a fix')
    if (typeof g.feel !== 'string' || g.feel.trim().length < 5) say('needs where it should be felt')
    if (typeof g.breathing !== 'string' || g.breathing.trim().length < 10) say('needs a line on breathing')
    for (const key of ['easier', 'harder']) {
      if (g[key] == null) continue
      if (String(g[key]) === id) say(key + ' points at itself')
      else if (!exists(String(g[key]))) say(key + ' is not in the catalogue')
    }
    if (g.easier != null && g.harder != null && String(g.easier) === String(g.harder)) say('easier and harder are the same exercise')
    if (g.review === 'reviewed') { if (!isReviewed(g) || !/^\d{4}-\d{2}-\d{2}$/.test(g.reviewed || '')) say('reviewed needs a reviewer and a date') }
    else if (g.review !== 'draft') say('review is neither draft nor reviewed')
  }
  // A ladder must lead somewhere: following "harder" (or "easier") may never come back round.
  for (const key of ['easier', 'harder']) {
    for (const start of Object.keys(EXERCISE_GUIDES)) {
      const seen = new Set([start])
      let at = start
      while (EXERCISE_GUIDES[at]?.[key] != null) {
        at = String(EXERCISE_GUIDES[at][key])
        if (seen.has(at)) { out.push(`${start}: the ${key} ladder goes round in a circle`); break }
        seen.add(at)
      }
    }
  }
  return out
}

export { EXERCISE_GUIDES, PATTERNS }
