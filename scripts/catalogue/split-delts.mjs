#!/usr/bin/env node
// Front, side and rear delts, and the lats on their own (#638, v1.4.5).
//
// The catalogue used to say "delts" and "shoulders" for the whole shoulder, and its muscle maps
// drew "deltoids" and "upper-back" (the lats included). This names the head of each exercise from
// what it does, read off its name, and splits the lats off where a muscle map draws the back:
//
//   target "delts"                → "front delts" | "side delts" | "rear delts"
//   secondary "shoulders", "deltoids", "rear deltoids" → the head the movement works
//   muscleMap deltoids            → front-delts | side-delts | rear-delts (same weight)
//   muscleMap upper-back          → lats for a vertical pull or a pullover, lats AND upper-back
//                                   for a row, upper-back for everything else
//
// Only the exercise text files are read and written (catalogue/exercises/*.json); never media.
// It is idempotent: a file it already did has nothing left to rename.
//
//   node scripts/catalogue/split-delts.mjs           rewrite the catalogue
//   node scripts/catalogue/split-delts.mjs --check   fail when something is left to split
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const DIR = path.join(ROOT, 'catalogue/exercises')

// "Reverse" alone is not the rear: a reverse-grip bench press is a press.
const REAR = /\brear\b|revers(e)? ([a-z]+ )?(fly|flye|flyes|flies|pec|delt)|reverse shoulder|face pull|pull ?-?apart|pullapart|external (shoulder )?rotation|bent[- ]over (lateral|raise|fly|flye|rear|shoulder)|\bprone\b|\b[ytw][- ]raise|\by elevation|reverse pec|swimmer|cuban|infraspinatus|posterior|transverse (abduction|extension)|delt row|archer|iron cross|scarecrow|no money/i
const SIDE = /lateral|side raise|side delt|upright row|lu raise|\bl[- ]raise|lean[- ]away|side lying .*raise|shoulder abduction|high pull|empty can|full can|6 ways|y-?elevation|halo|around (the )?head|arm circl|circling/i
// A pull, for a supporting shoulder: the back of the shoulder does that work.
const PULL = /\brows?\b|rowing|pull[- ]?up|pullup|pull[- ]?down|pulldown|chin[- ]?up|\bchin\b|\bpull\b|shrug|face|inverted|muscle[- ]?up|rope climb|climb|superman|back extension|deadlift|good ?morning|swim|rear|y raise|t raise|row\b/i
// Overhead pressing works the side head hard too.
const OVERHEAD = /overhead|shoulder press|military|arnold|push press|jerk|handstand|pike|z press|seated press|standing press|landmine press|bradford|behind (the )?neck press|thruster|snatch/i
// Lat-led: a vertical pull or a pullover, where the lats are the muscle (not the mid back).
const LAT_LED = /pull[- ]?up|pullup|pull[- ]?down|pulldown|chin[- ]?up|\bchin\b|pullover|straight[- ]arm|\blats?\b|muscle[- ]?up|lat pull|kneeling lat|front lever|rope climb/i
const ROW = /\brows?\b|rowing|inverted|t-bar|meadows|seal row|kroc|pendlay/i

/** The head an exercise whose main muscle is the shoulder trains most. */
export function headOf(name) {
  const n = String(name || '')
  if (REAR.test(n)) return 'rear'
  if (SIDE.test(n)) return 'side'
  return 'front'
}
/** The head a supporting shoulder works in an exercise led by another muscle. */
export function supportingHeadOf(name) {
  const n = String(name || '')
  if (REAR.test(n) || PULL.test(n)) return 'rear'
  if (SIDE.test(n)) return 'side'
  return 'front'
}
const WORD = { front: 'front delts', side: 'side delts', rear: 'rear delts' }
const SLUG = { front: 'front-delts', side: 'side-delts', rear: 'rear-delts' }
const GENERIC_SECONDARY = new Set(['shoulders', 'deltoids'])

/** One exercise with its shoulder and back named precisely. A copy; the input is left alone. */
export function splitExercise(e) {
  if (!e || typeof e !== 'object' || e.variantOf) return e
  const out = JSON.parse(JSON.stringify(e))
  const n = out.name || ''
  let main = null
  if (out.target === 'delts') {
    main = headOf(n)
    out.target = WORD[main]
  }
  if (Array.isArray(out.secondaryMuscles)) {
    const sec = []
    const push = m => { if (m !== out.target && !sec.includes(m)) sec.push(m) }
    for (const m of out.secondaryMuscles) {
      if (GENERIC_SECONDARY.has(m)) push(WORD[main ? (main === 'front' && OVERHEAD.test(n) ? 'side' : main === 'rear' ? 'side' : 'front') : supportingHeadOf(n)])
      else if (m === 'rear deltoids') push('rear delts')
      else push(m)
    }
    // An overhead press works the side head almost as hard as the front.
    if (main === 'front' && OVERHEAD.test(n)) push('side delts')
    out.secondaryMuscles = sec
  }
  if (out.muscleMap) out.muscleMap = splitMap(out.muscleMap, n, main)
  return out
}

// A muscle map's own names: deltoids to the head, upper-back to the lats where they lead.
function splitMap(m, name, main) {
  const head = main || supportingHeadOf(name)
  const back = LAT_LED.test(name) ? ['lats'] : ROW.test(name) ? ['lats', 'upper-back'] : ['upper-back']
  const swap = list => {
    if (!Array.isArray(list)) return list
    const out = []
    for (const x of list) {
      const to = x === 'deltoids' ? [SLUG[head]] : x === 'upper-back' ? back : [x]
      for (const y of to) if (!out.includes(y)) out.push(y)
    }
    return out
  }
  const res = { ...m }
  if (m.primaries) res.primaries = swap(m.primaries)
  if (m.secondaries) res.secondaries = swap(m.secondaries).filter(x => !(res.primaries || []).includes(x))
  if (m.weights) {
    const w = {}
    for (const [k, v] of Object.entries(m.weights)) {
      const to = k === 'deltoids' ? [SLUG[head]] : k === 'upper-back' ? back : [k]
      // A row's lats are a supporting muscle of the mid back, not its equal.
      for (const y of to) w[y] = Math.max(w[y] ?? 0, k === 'upper-back' && to.length > 1 && y === 'lats' ? Math.min(v, 0.4) : v)
    }
    res.weights = w
  }
  // An overhead press works the side head almost as hard as the front one (as in the words above).
  const hadDelts = (m.primaries || []).includes('deltoids')
  if (hadDelts && head === 'front' && OVERHEAD.test(name) && !(res.primaries || []).includes('side-delts')) {
    res.secondaries = [...new Set([...(res.secondaries || []), 'side-delts'])]
    if (res.weights) res.weights['side-delts'] = Math.max(res.weights['side-delts'] ?? 0, 0.4)
  }
  if (m.weights && back.length > 1 && res.primaries?.includes('lats') && !(res.weights.lats >= 1)) {
    res.primaries = res.primaries.filter(x => x !== 'lats')
    res.secondaries = [...new Set([...(res.secondaries || []), 'lats'])]
  }
  return res
}

/** What is still generic in one exercise: a list of reasons, empty when it is done. */
export function leftToSplit(e) {
  const out = []
  if (!e || e.variantOf) return out
  if (e.target === 'delts') out.push('target "delts"')
  for (const m of e.secondaryMuscles || []) if (GENERIC_SECONDARY.has(m) || m === 'rear deltoids') out.push(`secondary "${m}"`)
  const mm = e.muscleMap || {}
  for (const k of ['primaries', 'secondaries']) if ((mm[k] || []).some(x => x === 'deltoids' || x === 'upper-back' && LAT_LED.test(e.name || ''))) out.push(`muscleMap.${k}`)
  if (mm.weights && 'deltoids' in mm.weights) out.push('muscleMap.weights')
  return out
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const check = process.argv.includes('--check')
  let changed = 0
  const left = []
  for (const f of fs.readdirSync(DIR).filter(x => x.endsWith('.json')).sort()) {
    const p = path.join(DIR, f)
    const text = fs.readFileSync(p, 'utf8')
    const e = JSON.parse(text)
    if (check) {
      const why = leftToSplit(e)
      if (why.length) left.push(`${f}: ${why.join(', ')}`)
      continue
    }
    const next = splitExercise(e)
    const out = JSON.stringify(next, null, 2) + '\n'
    if (out !== text) { fs.writeFileSync(p, out); changed++ }
  }
  if (check) {
    if (left.length) { console.error(left.slice(0, 20).join('\n') + (left.length > 20 ? `\n… and ${left.length - 20} more` : '')); process.exit(1) }
    console.log('Every shoulder names its head.')
  } else console.log(`Split ${changed} exercise files.`)
}
