#!/usr/bin/env node
// Folds the v1.4.0 drafting work into catalogue/: the new exercises of the Gym visual pack and
// descriptions for the ones that shipped before. One-off, kept for the record like import-legacy.
//
//   node scripts/catalogue/import-drafts.mjs /path/to/opengym-media
//
// Reads <archive>/work/drafts.json (ids, female drawings) and <archive>/work/meta/out/*.json (the
// text, checked against work/meta/SPEC.md). Existing entries only ever gain a description and a
// category; nothing they already had is changed.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const EX = path.join(ROOT, 'catalogue/exercises')
const archive = path.resolve(process.argv[2] || '/mnt/backup-hdd/opengym-media')
const outDir = path.join(archive, 'work/meta/out')
const { drafts, femaleVariants } = JSON.parse(fs.readFileSync(path.join(archive, 'work/drafts.json'), 'utf8'))

const read = id => JSON.parse(fs.readFileSync(path.join(EX, id + '.json'), 'utf8'))
const write = e => fs.writeFileSync(path.join(EX, e.id + '.json'), JSON.stringify(e, null, 2) + '\n')
const ORDER = ['id', 'name', 'bodyPart', 'equipment', 'target', 'secondaryMuscles', 'category', 'description', 'instructions', 'muscleMap', 'femaleVariant', 'variantOf', 'textSource']
const ordered = e => Object.fromEntries(ORDER.filter(k => e[k] !== undefined).map(k => [k, e[k]]))

const rows = new Map()
for (const f of fs.readdirSync(outDir).filter(f => f.endsWith('.json')).sort()) {
  for (const r of JSON.parse(fs.readFileSync(path.join(outDir, f), 'utf8'))) rows.set(r.id, r)
}

const existing = new Set(fs.readdirSync(EX).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)))
const names = new Map([...existing].map(id => [read(id).name, id]))
let described = 0, added = 0, renamed = 0, missing = []

for (const id of existing) {
  const r = rows.get(id)
  if (!r) continue
  const e = read(id)
  if (!e.description && r.description) { e.description = r.description; described++ }
  if (!e.category && r.category) e.category = r.category
  write(ordered(e))
}

for (const d of drafts) {
  if (existing.has(d.id)) continue
  const r = rows.get(d.id)
  if (!r) { missing.push(d.id); continue }
  // Two drawings can carry the same title (a second camera angle, a corrected re-draw). Names stay
  // unique so a search result is never ambiguous: the later id becomes "v. 2", "v. 3", ...
  let name = r.name
  if (names.has(name)) {
    let k = 2
    const base = name.replace(/ v\. \d+$/, '')
    while (names.has(`${base} v. ${k}`)) k++
    name = `${base} v. ${k}`
    renamed++
  }
  names.set(name, d.id)
  write(ordered({
    id: d.id, name, bodyPart: r.bodyPart, equipment: r.equipment, target: r.target,
    secondaryMuscles: r.secondaryMuscles, category: r.category, description: r.description,
    instructions: r.instructions, textSource: 'opengym',
  }))
  added++
}

let linked = 0
for (const [male, female] of Object.entries(femaleVariants)) {
  if (!fs.existsSync(path.join(EX, male + '.json'))) continue
  const e = read(male)
  e.femaleVariant = female
  write(ordered(e))
  write({ id: female, variantOf: male })
  linked++
}

console.log(`described ${described} existing, added ${added} new (${renamed} renamed to stay unique), linked ${linked} female drawings`)
if (missing.length) console.log(`no text yet for ${missing.length}: ${missing.slice(0, 20).join(' ')}${missing.length > 20 ? ' ...' : ''}`)
