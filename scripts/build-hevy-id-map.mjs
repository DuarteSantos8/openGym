#!/usr/bin/env node
/**
 * Build frontend/src/lib/hevy-id-map.js — a complete, deterministic
 * Hevy template-id → openGym catalogue-id table.
 *
 * Usage:
 *   HEVY_API_KEY=… node scripts/build-hevy-id-map.mjs
 *   # or put HEVY_API_KEY in .env and run: node scripts/build-hevy-id-map.mjs
 *   # or: node scripts/build-hevy-id-map.mjs /path/to/templates.json
 *
 * Import resolution uses ONLY this table (lookup by template id). Titles are
 * never guessed at runtime — regenerate this file when Hevy adds templates.
 * End users paste their own key in Settings; this env var is only for regenerating
 * the committed map.
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { matchExercise } from '../frontend/src/lib/import-csv.js'
import { EXIDX } from '../frontend/src/lib/exercises.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'frontend/src/lib/hevy-id-map.js')
const HEVY_API = 'https://api.hevyapp.com'

/** Read HEVY_API_KEY from the environment, or from a local `.env` if present. */
function hevyApiKey() {
  const fromEnv = (process.env.HEVY_API_KEY || '').trim()
  if (fromEnv) return fromEnv
  const envPath = join(ROOT, '.env')
  if (!existsSync(envPath)) return ''
  const m = readFileSync(envPath, 'utf8').match(/^HEVY_API_KEY\s*=\s*(.*)$/m)
  if (!m) return ''
  return m[1].trim().replace(/^['"]|['"]$/g, '')
}

/**
 * Exact Hevy English title (lowercased) → catalogue id.
 * Only entries we have verified against EXIDX. Gaps (hip thrust, rower, …)
 * are intentionally omitted so they import as custom exercises.
 */
// Titles whose closest catalogue entry is a different movement — better a custom exercise than
// a wrong one. Keep in sync with the note at the top of the generated map.
const NEVER_BY_TITLE = new Set(['crunch', 'side plank', 'squat (machine)', 'triceps extension (cable)', 'rear delt reverse fly (cable)'])

const BY_TITLE = {
  // Reported from a real import as customs — same lifts, Hevy vocabulary.
  'bulgarian split squat (dumbbell)': '0410',
  'bulgarian split squat (barbell)': '0099',
  'chest supported incline row (dumbbell)': '0327',
  'knee raise parallel bars': '0826',
  'lat pulldown - close grip (cable)': '2616',
  'rear delt reverse fly (dumbbell)': '0383',
  'rear delt reverse fly (machine)': '0602',
  'reverse lunge (dumbbell)': '0381',
  'reverse lunge (barbell)': '0078',
  'seated incline curl (dumbbell)': '0318',
  'seated shoulder press (machine)': '0603',
  'single leg standing calf raise (machine)': '0605',

  // Shared with import-csv ALIAS_EX / cardio pins.
  'ab wheel': '0857',
  'elliptical trainer': '2141',
  'treadmill': '3666',
  'cycling': '2331',
  'stationary bike': '2138',
  'exercise bike': '2138',
  'stair machine': '2311',
  'stair machine (steps)': '2311',
  'jumping jack': '3220',
  'jumping jacks': '3220',
  'battle ropes': '0128',
  'pallof press': '0979',
  'cable pallof press': '0979',
  'face pull': '0203',
  'hack squat (machine)': '0743',
  'iso-lateral row (machine)': '0571',
  'seated cable row - bar grip': '0218',
  'reverse grip lat pulldown (cable)': '0673',
  'single arm lateral raise (cable)': '0192',
  'plate front raise': '0310',
  'back extension (weighted hyperextension)': '0573',
  'behind the back bicep wrist curl (barbell)': '0104',
  'butterfly (pec deck)': '0596',
  'chest fly (machine)': '0596',
  'chest fly (dumbbell)': '0308',
  'incline chest fly (dumbbell)': '0319',
  'cable fly crossovers': '1269',
  'bicep curl (dumbbell)': '0294',
  'bicep curl (cable)': '0868',
  'bicep curl (barbell)': '0031',
  'chest supported reverse fly (dumbbell)': '0383',
  'bench press (smith machine)': '0748',
  'overhead press (smith machine)': '0766',

  // Common Hevy titles → canonical catalogue entries (verified ids).
  'bench press (barbell)': '0025',
  'bench press (dumbbell)': '0289',
  'incline bench press (barbell)': '0047',
  'incline bench press (dumbbell)': '0314',
  'overhead press (barbell)': '0091',
  'overhead press (dumbbell)': '0405',
  'shoulder press (machine)': '0603',
  'shoulder press (dumbbell)': '0405',
  'shoulder press (barbell)': '0091',
  'squat (barbell)': '0043',
  'front squat (barbell)': '0042',
  'deadlift (barbell)': '0032',
  'romanian deadlift (barbell)': '0085',
  'romanian deadlift (dumbbell)': '1459',
  'sumo deadlift (barbell)': '0117',
  'bent over row (barbell)': '0027',
  'bent over row (dumbbell)': '0292',
  'lat pulldown (cable)': '2330',
  'lat pulldown - wide grip (cable)': '2330',
  'leg press (machine)': '0739',
  'leg extension (machine)': '0585',
  'seated leg curl (machine)': '0586',
  'lying leg curl (machine)': '0586',
  'goblet squat (dumbbell)': '1760',
  'goblet squat (kettlebell)': '0534',
  'lunge (dumbbell)': '0336',
  'lunges (dumbbell)': '0336',
  'pull up': '0652',
  'pull-up': '0652',
  'chin up': '1326',
  'chin-up': '1326',
  'push up': '0662',
  'push-up': '0662',
  'chest dip': '0251',
  'plank': '2135',
  'russian twist': '0687',
  'hanging leg raise': '0472',
  'hanging knee raise': '0472',
  'cable crunch': '0175',
  'standing calf raise (machine)': '0605',
  'seated calf raise (machine)': '0594',
  'standing calf raise (dumbbell)': '0417',
  'shrug (barbell)': '0095',
  'shrug (dumbbell)': '0406',
  'hammer curl (dumbbell)': '0312',
  'concentration curl (dumbbell)': '0297',
  'preacher curl (barbell)': '0070',
  'skullcrusher (barbell)': '0060',
  'skull crusher (barbell)': '0060',
  'tricep kickback (dumbbell)': '0333',
  'kickback (dumbbell)': '0333',
  'lateral raise (dumbbell)': '0334',
  'good morning (barbell)': '0044',
}

const EQ_PAREN = {
  barbell: 'Barbell', dumbbell: 'Dumbbell', kettlebell: 'Kettlebell',
  machine: 'Machine', resistance_band: 'Band', none: null, other: null,
  plate: 'Plate', suspension: null,
}

function resolve(t) {
  const title = String(t.title || '').trim()
  const key = title.toLowerCase()
  if (Object.prototype.hasOwnProperty.call(BY_TITLE, key)) {
    const v = BY_TITLE[key]
    return v && EXIDX[v] ? v : null
  }
  const paren = EQ_PAREN[t.equipment]
  const tries = []
  if (paren) tries.push(`${title} (${paren})`)
  tries.push(title)
  const bare = title.replace(/\s*\([^)]*\)\s*$/, '').trim()
  if (bare !== title) {
    if (paren) tries.push(`${bare} (${paren})`)
    tries.push(bare)
  }
  if (t.equipment === 'machine') tries.push(`lever ${bare}`)
  for (const c of tries) {
    const id = matchExercise(c)
    if (id && EXIDX[id]) return id
  }
  return null
}

async function fetchTemplates(apiKey) {
  const items = []
  let page = 1, pageCount = 1
  while (page <= pageCount) {
    const url = `${HEVY_API}/v1/exercise_templates?page=${page}&pageSize=100`
    const res = await fetch(url, { headers: { 'api-key': apiKey } })
    if (!res.ok) throw new Error(`Hevy API ${res.status}`)
    const data = await res.json()
    pageCount = data.page_count || 1
    items.push(...(data.exercise_templates || []))
    page++
  }
  return items
}

async function main() {
  for (const [title, id] of Object.entries(BY_TITLE)) {
    if (id && !EXIDX[id]) throw new Error(`BY_TITLE "${title}" → missing catalogue id ${id}`)
  }

  const arg = process.argv[2]
  let templates
  if (arg && existsSync(arg)) {
    templates = JSON.parse(readFileSync(arg, 'utf8'))
  } else {
    const key = hevyApiKey()
    if (!key) {
      throw new Error('Set HEVY_API_KEY (env or .env), or pass a templates JSON path')
    }
    templates = await fetchTemplates(key)
  }

  const map = {}
  const titleMap = {}
  const unmatched = []
  for (const t of templates) {
    if (!t?.id || t.is_custom) { if (t?.id && t.is_custom) unmatched.push(t); continue }
    const id = resolve(t)
    if (id) {
      map[t.id] = id
      const titleKey = String(t.title || '').trim().toLowerCase()
      if (titleKey && !NEVER_BY_TITLE.has(titleKey) && !titleMap[titleKey]) titleMap[titleKey] = id
    } else unmatched.push(t)
  }

  // Stable key order for readable diffs.
  const keys = Object.keys(map).sort()
  const lines = keys.map(k => `  ${JSON.stringify(k)}: ${JSON.stringify(map[k])},`)
  const titleKeys = Object.keys(titleMap).sort()
  const titleLines = titleKeys.map(k => `  ${JSON.stringify(k)}: ${JSON.stringify(titleMap[k])},`)

  const body = `// AUTO-GENERATED by scripts/build-hevy-id-map.mjs — do not edit by hand.
// Hevy exercise_template id → openGym catalogue id, plus English title → id for CSV exports
// (Hevy CSV has titles, not template ids). Regenerated from the Hevy templates API +
// verified title aliases.
// ${keys.length} mapped · ${unmatched.length} left unmatched (import as custom).
// Source templates: ${templates.length} (built-in only).

export const HEVY_ID_MAP = {
${lines.join('\n')}
}

/** Lowercased Hevy English title → catalogue id (CSV / name path). */
export const HEVY_TITLE_MAP = {
${titleLines.join('\n')}
}
`

  writeFileSync(OUT, body)
  console.log(`Wrote ${OUT}`)
  console.log(`Mapped ${keys.length} / ${templates.filter(t => !t.is_custom).length} (titles ${titleKeys.length})`)
  console.log(`Unmatched ${unmatched.length} (become custom on import)`)
  if (process.env.VERBOSE) {
    unmatched.slice(0, 40).forEach(t => console.log('  -', t.title, `[${t.equipment}]`))
  }
}

main().catch(e => { console.error(e); process.exit(1) })
