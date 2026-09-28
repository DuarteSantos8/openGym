#!/usr/bin/env node
// Guards what every locale in src/locales/ has to get right about a string it translates:
// the key is there, it is not blank, and it keeps the {n} placeholders of the English original.
// English is the source language and has no locale file, so a key that exists in only
// some locales falls back to English silently, mid-sentence, with nothing failing
// anywhere. This catches that at review time instead of in the app.
//
//   node scripts/check-locales.mjs
//
// The reference is the union of all locales, not one blessed file: a key added to a
// single locale then flags the other ten instead of passing unnoticed.

import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const localesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'locales')
const files = readdirSync(localesDir).filter(f => f.endsWith('.js')).sort()

if (!files.length) {
  console.error(`No locale files found in ${localesDir}`)
  process.exit(1)
}

const locales = new Map()
for (const file of files) {
  const { default: dict } = await import(pathToFileURL(join(localesDir, file)).href)
  if (!dict || typeof dict !== 'object') {
    console.error(`${file}: no default-exported object`)
    process.exit(1)
  }
  locales.set(file.replace(/\.js$/, ''), dict)
}

// How many locales carry each key — 1 means the key was added to a single file only,
// which is the usual shape of the bug and worth naming separately from plain gaps.
const seen = new Map()
for (const dict of locales.values()) for (const k of Object.keys(dict)) seen.set(k, (seen.get(k) || 0) + 1)
const union = [...seen.keys()]

// t('…{0}…', x) substitutes by index, so a translation that loses a {0} drops the number out of
// the sentence and one that invents a {1} prints the braces at the reader. The KEY is the English
// original — English ships no pack — so the key is the reference. By multiset, not in order: a
// translation is free to move the placeholders around the sentence, never to change the set.
const marks = s => [...String(s).matchAll(/\{\d+\}/g)].map(m => m[0]).sort().join(' ')

let failed = false
for (const [lang, dict] of locales) {
  const keys = new Set(Object.keys(dict))
  const missing = union.filter(k => !keys.has(k))
  const orphans = union.filter(k => keys.has(k) && seen.get(k) === 1)
  // A blank value is worse than no translation: the English fallback only runs for a key that
  // is ABSENT, so an empty string reaches the screen as an empty screen.
  const blank = Object.entries(dict).filter(([, v]) => typeof v !== 'string' || !v.trim()).map(([k]) => k)
  const mangled = Object.entries(dict).filter(([k, v]) => typeof v === 'string' && marks(v) !== marks(k))
  if (missing.length || orphans.length || blank.length || mangled.length) {
    failed = true
    console.error(`\n${lang}.js: ${keys.size}/${union.length} keys`)
    for (const k of missing) console.error(`  missing:   ${JSON.stringify(k)}`)
    for (const k of orphans) console.error(`  only here: ${JSON.stringify(k)}`)
    for (const k of blank) console.error(`  blank:     ${JSON.stringify(k)}`)
    for (const [k, v] of mangled)
      console.error(`  placeholders: ${JSON.stringify(k)} has [${marks(k) || '—'}], ${JSON.stringify(v)} has [${marks(v) || '—'}]`)
  }
}

if (failed) {
  console.error('\nEvery locale must carry the same keys, each translated to something, with the source string\'s {n} placeholders.')
  process.exit(1)
}

console.log(`${locales.size} locales, ${union.length} keys each — in sync.`)
