// Writes src/vocab.json: the words of the exercise library's names (frontend/src/lib/exercises-data.js),
// which the worker uses to mend a word OCR broke ("BIC S" → "biceps"). Re-run when the library grows:
//   node test/harness/make-vocab.mjs

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const { EXDB } = await import(path.join(here, '..', '..', '..', 'frontend', 'src', 'lib', 'exercises-data.js'))
const count = {}
for (const e of EXDB) for (const w of String(e.n || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').split(/[^a-z]+/)) if (w.length >= 3) count[w] = (count[w] || 0) + 1
// Words seen once are often typos of the library's own; keep the ones that recur or are long enough to be rare words.
const words = Object.entries(count).filter(([w, n]) => n >= 2 || w.length >= 7).map(([w]) => w).sort()
fs.writeFileSync(path.join(here, '..', '..', 'src', 'vocab.json'), JSON.stringify(words) + '\n')
console.log(words.length, 'words')
// The names themselves, for snapping a caption that is a few letters off a known exercise.
const names = [...new Set(EXDB.map(e => String(e.n || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()).filter(n => n.length >= 6))].sort()
fs.writeFileSync(path.join(here, '..', '..', 'src', 'names.json'), JSON.stringify(names) + '\n')
console.log(names.length, 'names')
