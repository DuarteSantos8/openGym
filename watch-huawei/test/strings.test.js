import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { render, build, LANGS, KEYS, OUT } from '../huawei-strings.mjs'

test('texts.js is what the generator writes now', async () => {
  assert.equal(readFileSync(OUT, 'utf8'), await render(), 'texts.js is out of date: run node watch-huawei/huawei-strings.mjs')
})

test('every language the app has is in, with every key, none empty', async () => {
  // Japanese is an app language, but the Wear OS watch (where these words come from) and the Garmin
  // have no Japanese yet, so the watch shows English for it. When values-ja appears, add 'ja' to LANGS.
  const noWear = ['ja']
  noWear.forEach(l => assert.equal(existsSync(new URL('../../frontend/android/wear/src/main/res/values-' + l + '/strings.xml', import.meta.url)), false, l + ' now has Wear OS words: add it'))
  const packs = readdirSync(new URL('../../frontend/src/locales/', import.meta.url)).filter(f => f.endsWith('.js')).map(f => f.slice(0, -3)).filter(l => noWear.indexOf(l) < 0)
  const rows = await build()
  assert.deepEqual(Object.keys(LANGS).sort(), packs.concat('en').sort()) // the phone app's languages, no more, no fewer
  Object.keys(rows).forEach(l => {
    assert.equal(rows[l].length, KEYS.length, l)
    rows[l].forEach((w, i) => { assert.ok(w.length > 0, l + ' ' + KEYS[i]); assert.doesNotMatch(w, /—|\n/, l + ' ' + KEYS[i]) })
  })
})

test('placeholders agree across languages: each word has the same {0} {1} {2} as English', async () => {
  const rows = await build()
  const holes = w => (w.match(/\{\d\}/g) || []).sort().join('')
  Object.keys(rows).forEach(l => rows[l].forEach((w, i) => assert.equal(holes(w), holes(rows.en[i]), l + ' ' + KEYS[i])))
})
