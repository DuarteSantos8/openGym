#!/usr/bin/env node
// Folds the v1.4.0 name translations (<archive>/work/names/out/<lang>-NN.json) into
// catalogue/i18n/<lang>.json. Only fills names that are missing; a name someone already wrote is
// never replaced. One-off, kept for the record.
//
//   node scripts/catalogue/import-names.mjs /path/to/opengym-media
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const dir = path.join(path.resolve(process.argv[2] || '/mnt/backup-hdd/opengym-media'), 'work/names/out')
const byLang = {}
for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
  const lang = f.replace(/-\d+\.json$/, '')
  Object.assign(byLang[lang] ||= {}, JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')))
}
// German ships only names a native speaker has read (scripts/de-name-rules.mjs): the v1.3
// exercises it left in English stay that way. Names of the new exercises go in, for review.
const V13 = new Set(JSON.parse(fs.readFileSync(path.join(ROOT, 'frontend/src/lib/catalogue-v13-ids.json'), 'utf8')))
const skip = (lang, id) => lang === 'de' && V13.has(id)

for (const [lang, names] of Object.entries(byLang)) {
  const p = path.join(ROOT, 'catalogue/i18n', lang + '.json')
  const cur = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {}
  let added = 0
  for (const [id, name] of Object.entries(names)) {
    if (skip(lang, id)) continue
    const row = cur[id] ||= {}
    if (!row.name) { row.name = name; added++ }
  }
  // Rows in id order, and inside a row name, description, instructions: the order a translator reads.
  const sorted = Object.fromEntries(Object.keys(cur).sort().map(id => {
    const r = cur[id]
    return [id, Object.fromEntries(['name', 'description', 'instructions'].filter(k => r[k] != null).map(k => [k, r[k]]))]
  }))
  fs.writeFileSync(p, JSON.stringify(sorted, null, 2) + '\n')
  console.log(`${lang}: +${added} names`)
}
