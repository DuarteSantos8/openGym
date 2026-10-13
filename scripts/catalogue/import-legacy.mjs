#!/usr/bin/env node
// One-off: writes catalogue/ from the data openGym shipped up to v1.3.x, so the catalogue starts
// out holding exactly what the app already knew. Kept for the record and for re-running while
// v1.4.0 is in development; after that, catalogue/ is the source and this script is not needed.
//
//   node scripts/catalogue/import-legacy.mjs
//
// Reads frontend/src/lib/exercises-data.js (EXDB) with its muscle overlays, the instruction packs
// in frontend/src/instr/ and the exercise-name packs in frontend/src/exercise-names/. Every id
// keeps its number: workouts, routines and records store ids, and none of them is touched.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SRC = path.join(ROOT, 'frontend/src')
const OUT = path.join(ROOT, 'catalogue')

const { EXDB, CATALOGUE } = await import(pathToFileURL(path.join(SRC, 'lib/exercises.js')))
const { exerciseMuscleMetadataFor } = await import(pathToFileURL(path.join(SRC, 'lib/exercise-muscle-batch-1.js')))

const packs = async dir => {
  const out = {}
  for (const f of fs.readdirSync(path.join(SRC, dir)).filter(f => f.endsWith('.js'))) {
    out[f.replace(/\.js$/, '')] = (await import(pathToFileURL(path.join(SRC, dir, f)))).default
  }
  return out
}
const instr = await packs('instr')
const names = await packs('exercise-names')

fs.mkdirSync(path.join(OUT, 'exercises'), { recursive: true })
fs.mkdirSync(path.join(OUT, 'i18n'), { recursive: true })

let written = 0
EXDB.forEach((raw, i) => {
  const meta = exerciseMuscleMetadataFor(raw.id)
  const entry = {
    id: raw.id,
    name: raw.n,
    bodyPart: raw.bp,
    equipment: raw.eq,
    target: raw.tg,
    secondaryMuscles: [...(raw.sm || [])],
    description: '',
    instructions: [...(raw.st || [])],
  }
  if (Object.keys(meta).length) {
    const c = CATALOGUE[i]
    entry.muscleMap = {
      ...(c.bp !== raw.bp ? { bodyPart: c.bp } : {}),
      primaries: c.primaries,
      secondaries: c.secondaries,
      ...(c.muscleWeights ? { weights: c.muscleWeights } : {}),
    }
  }
  entry.textSource = 'exercisedb'
  fs.writeFileSync(path.join(OUT, 'exercises', raw.id + '.json'), JSON.stringify(entry, null, 2) + '\n')
  written++
})

const langs = new Set([...Object.keys(instr), ...Object.keys(names)])
for (const lang of [...langs].sort()) {
  const out = {}
  for (const { id } of EXDB) {
    const row = {}
    if (names[lang]?.[id]) row.name = names[lang][id]
    if (instr[lang]?.[id]) row.instructions = instr[lang][id]
    if (Object.keys(row).length) out[id] = row
  }
  fs.writeFileSync(path.join(OUT, 'i18n', lang + '.json'), JSON.stringify(out, null, 2) + '\n')
}
console.log(`${written} exercises, i18n: ${[...langs].sort().join(' ')}`)
