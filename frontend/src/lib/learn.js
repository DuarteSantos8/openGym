// Readers for the Learn content (content/learn.js): find a term, search the glossary, find a
// guide. Pure, so the term chip (components/Term.jsx) and the Learn screen share one answer.
import { GLOSSARY, GUIDES } from '../content/learn.js'

const TERM = Object.fromEntries(GLOSSARY.map(x => [x.id, x]))
const GUIDE = Object.fromEntries(GUIDES.map(x => [x.id, x]))

/** The glossary entry with this id, or null. */
export const termById = id => TERM[id] || null
/** The guide with this id, or null. */
export const guideById = id => GUIDE[id] || null

const fold = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/**
 * The glossary, narrowed to a search. A match in the term or one of its other names comes before
 * a match in the explanation, and a term that starts with the query before one that contains it.
 * `say(term)` is how the screen shows a string (its translation), so a search in another
 * language finds the words on screen as well as the English ones.
 */
export function searchGlossary(query, say = x => x) {
  const q = fold(query)
  const sorted = [...GLOSSARY].sort((a, b) => fold(say(a.term)).localeCompare(fold(say(b.term))))
  if (!q) return sorted
  const rank = x => {
    const names = [x.term, say(x.term), ...(x.also || [])].map(fold)
    if (names.some(n => n === q)) return 0
    if (names.some(n => n.startsWith(q))) return 1
    if (names.some(n => n.includes(q))) return 2
    if (fold(x.def).includes(q) || fold(say(x.def)).includes(q)) return 3
    return -1
  }
  return sorted.map(x => [rank(x), x]).filter(([r]) => r >= 0).sort((a, b) => a[0] - b[0]).map(([, x]) => x)
}

export { GLOSSARY, GUIDES }
