#!/usr/bin/env node
// A quick sanity check of the Garmin app that needs no Connect IQ SDK (the compiler needs the
// device files, which need a Garmin login: docs/GARMIN.md). Not a compiler: it catches the slips a
// compiler would, early and in CI-free comfort:
//   - brackets, braces and parentheses that do not pair up (strings and comments skipped)
//   - a Rez.Strings id the English strings do not have, or a language missing one
//   - a (:color) helper without its (:mono) twin, or the other way round
//   - a product in manifest.xml that is not a Connect IQ device id (when the SDK is there)
//   - an em dash in the copy
//
//   node frontend/garmin/check.mjs [path to the Connect IQ SDK]
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const problems = []
const bad = (file, msg) => problems.push(`${file}: ${msg}`)

// Strips comments and string/char literals, keeping line breaks for line numbers.
function code (src) {
  let out = ''
  for (let i = 0; i < src.length; i++) {
    const c = src[i], d = src[i + 1]
    if (c === '/' && d === '/') { while (i < src.length && src[i] !== '\n') i++; out += '\n'; continue }
    if (c === '/' && d === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') out += '\n'; i++ } i++; continue }
    if (c === '"' || c === "'") {
      const q = c
      i++
      while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; if (src[i] === '\n') break; i++ }
      out += q + q
      continue
    }
    out += c
  }
  return out
}

function pairs (file, src) {
  const open = { '(': ')', '[': ']', '{': '}' }
  const stack = []
  let line = 1
  for (const c of src) {
    if (c === '\n') line++
    if (open[c]) stack.push([c, line])
    else if (c === ')' || c === ']' || c === '}') {
      const top = stack.pop()
      if (!top || open[top[0]] !== c) { bad(file, `line ${line}: '${c}' does not close ${top ? `'${top[0]}' from line ${top[1]}` : 'anything'}`); return }
    }
  }
  if (stack.length) bad(file, `'${stack.at(-1)[0]}' from line ${stack.at(-1)[1]} is never closed`)
}

const ids = file => new Set([...readFileSync(file, 'utf8').matchAll(/<string id="([a-z0-9_]+)">/g)].map(m => m[1]))
const eng = ids(join(here, 'resources', 'strings', 'strings.xml'))

const srcDir = join(here, 'source')
for (const f of readdirSync(srcDir).filter(f => f.endsWith('.mc'))) {
  const raw = readFileSync(join(srcDir, f), 'utf8')
  const src = code(raw)
  pairs(f, src)
  for (const m of raw.matchAll(/Rez\.Strings\.([A-Za-z0-9_]+)/g)) if (!eng.has(m[1])) bad(f, `Rez.Strings.${m[1]} is not in resources/strings`)
  // statements that look cut off: a line ending in an operator before a closing brace
  src.split('\n').forEach((l, i) => { if (/[^=!<>]=\s*$/.test(l) && !/^\s*\/\//.test(l)) bad(f, `line ${i + 1}: ends in '=': ${l.trim()}`) })
  const color = [...src.matchAll(/\(:color\)\s*function\s+(\w+)/g)].map(m => m[1]).sort()
  const mono = [...src.matchAll(/\(:mono\)\s*function\s+(\w+)/g)].map(m => m[1]).sort()
  if (color.join() !== mono.join()) bad(f, `(:color) ${color} and (:mono) ${mono} differ`)
}

for (const dir of readdirSync(here).filter(d => d.startsWith('resources-'))) {
  const file = join(here, dir, 'strings', 'strings.xml')
  const got = ids(file)
  for (const k of eng) if (!got.has(k)) bad(dir, `missing ${k}`)
  for (const k of got) if (!eng.has(k)) bad(dir, `${k} is not in English`)
}
for (const dir of ['resources', ...readdirSync(here).filter(d => d.startsWith('resources-'))]) {
  const xml = readFileSync(join(here, dir, 'strings', 'strings.xml'), 'utf8')
  if (/—/.test(xml)) bad(dir, 'an em dash in the copy')
  if (/%\d\$[sd]/.test(xml)) bad(dir, 'an Android placeholder (%1$s) Monkey C does not fill')
}

const manifest = readFileSync(join(here, 'manifest.xml'), 'utf8')
const products = [...manifest.matchAll(/<iq:product id="([a-z0-9_]+)"\/>/g)].map(m => m[1])
const sdk = process.argv[2] || process.env.CIQ_SDK
const refDir = sdk && join(sdk, 'resources', 'device-reference')
if (refDir && existsSync(refDir)) {
  const known = new Set(readdirSync(refDir))
  for (const p of products) if (!known.has(p)) bad('manifest.xml', `${p} is not a Connect IQ device id`)
}
const jungle = readFileSync(join(here, 'monkey.jungle'), 'utf8')
for (const m of jungle.matchAll(/^(\w+)\.excludeAnnotations/gm)) if (m[1] !== 'base' && !products.includes(m[1])) bad('monkey.jungle', `${m[1]} is not in manifest.xml`)

if (problems.length) {
  console.error(problems.join('\n'))
  process.exit(1)
}
console.log(`garmin check: ${products.length} products, ${eng.size} strings, sources pair up`)
