#!/usr/bin/env node
// The SHA-256 of every built-in catalogue media file, as a plain checksum of the bytes. The files
// are streamed into the hash and never decoded, opened as pictures or looked at. The API loads
// the list into the community library's blocklist (api/library/store.js), so a 1:1 copy of a
// licensed exercise picture or animation can never be shared on any server.
//
//   node scripts/catalogue/media-hashes.mjs           writes api/library/catalogue-hashes.json
//   node scripts/catalogue/media-hashes.mjs --check   fails when the file is out of date
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const MEDIA = path.join(ROOT, 'catalogue/media')
const OUT = path.join(ROOT, 'api/library/catalogue-hashes.json')

function* files(dir) {
  let entries = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const d of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const p = path.join(dir, d.name)
    if (d.isDirectory()) yield* files(p)
    else if (d.isFile() && /\.(webp|mp4|gif|png|jpg|jpeg|webm)$/i.test(d.name)) yield p
  }
}

export function catalogueHashes(dir = MEDIA) {
  const set = new Set()
  for (const f of files(dir)) set.add(crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'))
  return [...set].sort()
}

const render = hashes => JSON.stringify({ v: 1, algo: 'sha256', count: hashes.length, hashes }) + '\n'

if (import.meta.url === `file://${process.argv[1]}`) {
  const hashes = catalogueHashes()
  const text = render(hashes)
  if (process.argv.includes('--check')) {
    let have = ''
    try { have = fs.readFileSync(OUT, 'utf8') } catch { /* missing */ }
    if (have !== text) { console.error('api/library/catalogue-hashes.json is out of date: run node scripts/catalogue/media-hashes.mjs'); process.exit(1) }
    console.log(`catalogue hashes up to date (${hashes.length})`)
  } else {
    fs.writeFileSync(OUT, text)
    console.log(`wrote ${hashes.length} hashes to ${path.relative(ROOT, OUT)}`)
  }
}
