// A picture for a custom exercise that has none of its own.
//
// An import (Hevy, Strong, a CSV) turns every name it did not recognise into a custom exercise, and
// a custom exercise only shows what its owner attached to it: nothing, so every list and every
// exercise page wore the grey dumbbell. It hits the lifts logged most, the ones with the names the
// catalogue spells differently ("Développé couché (Barre)" from a French Hevy, against the
// catalogue's "développé couché à la barre"). This finds the catalogue exercise the name means so
// its drawing can stand in. It changes nothing that is stored: the exercise keeps its own id and
// every set logged against it.
//
// Two ways of finding it, the second for names written in the language on screen:
//   1. the import's own matcher (lib/import-csv.js): an alias, an exact name or one unambiguous
//      near match, in English;
//   2. the same idea over the catalogue's names in the language of the app: accents and little
//      words ("à la", "de", "avec") ignored, a plural read as its singular, and the words in any
//      order. Exact, or a single catalogue name that holds every word with at most two more:
//      never a guess between two.
//
// A custom exercise with its own photo, video or link keeps it, and one nothing knows stays as it
// is (the dumbbell, the fallback for an exercise with no picture at all).
import { EXIDX } from './exercises.js'
import { matchExercise, matchHevyTitle } from './import-csv.js'
import { mediaOf, cleanUrl } from './media-refs.js'
import { getLang, localizedNames } from './i18n.js'

const FILLER = new Set(['a', 'la', 'le', 'les', 'l', 'de', 'du', 'des', 'd', 'au', 'aux', 'avec', 'en', 'sur', 'un', 'une', 'et', 'sans', 'the', 'with', 'on', 'of', 'and', 'con', 'el', 'los', 'las', 'del', 'mit', 'der', 'die', 'das', 'und', 'com', 'o', 'os', 'as', 'e', 'da', 'do', 'di', 'il'])

/** The significant words of a name, lower case, without accents, a plural as its singular. */
export function foldedWords(name) {
  const k = String(name || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim()
  return k.split(' ')
    .filter(w => w && !FILLER.has(w))
    .map(w => (w.length > 4 && /[sx]$/.test(w) ? w.slice(0, -1) : w))
}

// The catalogue's names in one language, as word sets, built once per pack that is on screen.
const indexes = new Map()   // pack object -> { exact: Map(key -> id), all: [{ id, set, n }] }
function indexOf(pack) {
  let idx = indexes.get(pack)
  if (idx) return idx
  idx = { exact: new Map(), all: [] }
  const longest = new Map()   // key -> how many raw words the name kept in the index has
  for (const [id, name] of Object.entries(pack)) {
    const w = foldedWords(name)
    if (!w.length || !EXIDX[id]) continue
    const key = w.slice().sort().join(' ')
    // two names that fold to the same words ("traction", "traction en L"): the plainer one stands for them
    const raw = String(name).split(/\s+/).length
    if (!idx.exact.has(key) || raw < longest.get(key)) { idx.exact.set(key, id); longest.set(key, raw) }
    idx.all.push({ id, set: new Set(w), n: w.length })
  }
  indexes.set(pack, idx)
  return idx
}

/** The catalogue id a name written in the language of `pack` means, or null. Never guesses between two. */
export function matchInPack(name, pack) {
  if (!pack) return null
  const w = foldedWords(name)
  if (!w.length) return null
  const idx = indexOf(pack)
  const exact = idx.exact.get(w.slice().sort().join(' '))
  if (exact) return exact
  const q = new Set(w)
  let best = null, bestExtra = Infinity, ties = 0
  for (const c of idx.all) {
    let ok = true
    for (const word of q) if (!c.set.has(word)) { ok = false; break }
    if (!ok) continue
    const extra = c.n - q.size
    if (extra > 2) continue
    if (extra < bestExtra) { best = c.id; bestExtra = extra; ties = 1 }
    else if (extra === bestExtra) ties++
  }
  return ties === 1 ? best : null
}

const memo = new Map()   // language + name -> catalogue exercise | null

/** The catalogue exercise whose drawing a custom exercise borrows, or null. */
export function catalogueTwin(ex) {
  if (!ex || typeof ex.n !== 'string' || !ex.n.trim()) return null
  if (mediaOf(ex) || cleanUrl(ex.url)) return null
  const pack = localizedNames()
  // The pack loads after the first screen: an answer found without it is not kept as final.
  const key = getLang() + (pack ? '+' : '-') + '|' + ex.n.trim().toLowerCase()
  if (memo.has(key)) return memo.get(key)
  const id = matchHevyTitle(ex.n) || matchExercise(ex.n) || matchInPack(ex.n, pack)
  const twin = id ? EXIDX[id] : null
  const out = twin && !twin.custom && twin.img ? twin : null
  memo.set(key, out)
  return out
}
