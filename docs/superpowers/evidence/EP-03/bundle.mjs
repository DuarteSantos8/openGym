import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'

if (!process.version.startsWith('v22.')) throw new Error('Use Node 22')
const root = 'frontend/dist/assets'
const result = { node: process.version, gzipLevel: 9, baseline: 'docs/product/BASELINE_REPORT.md', chunks: {} }
for (const [name, raw, gzip] of [['index-', 586454, 183316], ['Stats-', 42946, 14439]]) {
  const files = readdirSync(root).filter(f => f.startsWith(name) && f.endsWith('.js'))
  if (files.length !== 1) throw new Error('Expected exactly one ' + name + ' chunk')
  const file = files[0], bytes = readFileSync(root + '/' + file)
  const compressed = gzipSync(bytes, { level: 9 }).length
  result.chunks[name] = { file, raw: bytes.length, gzip: compressed, baseline: { raw, gzip }, deltaRaw: bytes.length - raw, deltaGzip: compressed - gzip }
}
writeFileSync('docs/superpowers/evidence/EP-03/bundle.json', JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify(result, null, 2))
