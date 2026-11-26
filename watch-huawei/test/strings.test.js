import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { render, build, LANGS, KEYS, REGIONS, I18N } from '../huawei-strings.mjs'

test('i18n/*.json and common/en.js are what the generator writes now, and nothing else is in i18n', async () => {
  const files = await render()
  Object.entries(files).forEach(([f, text]) => assert.equal(existsSync(f) && readFileSync(f, 'utf8'), text, f + ' is out of date: run node watch-huawei/huawei-strings.mjs'))
  readdirSync(I18N).forEach(f => assert.ok(files[join(I18N, f)], f + ' is not written by the generator: run node watch-huawei/huawei-strings.mjs'))
})

test('the regions are the spec\'s: the main one per language, none for the scripts the font may not draw', () => {
  const names = [].concat(...Object.values(REGIONS)).sort()
  assert.deepEqual(names, ['cs-CZ', 'da-DK', 'de-DE', 'en-US', 'es-ES', 'fr-FR', 'hu-HU', 'id-ID', 'it-IT', 'ko-KR', 'lt-LT', 'pl-PL', 'pt-BR', 'pt-PT',
    'ru-RU', 'sv-SE', 'tr-TR', 'uk-UA', 'vi-VN', 'zh-CN', 'zh-HK', 'zh-TW'])
  assert.deepEqual(readdirSync(I18N).sort(), names.map(n => n + '.json'))
  ;['ar', 'bn', 'fa', 'hi', 'th'].forEach(l => assert.equal(REGIONS[l], undefined, l))
})

test('every i18n file has every key, as {strings}, and stays small (the framework buffers 10 KB)', () => {
  readdirSync(I18N).forEach(f => {
    const j = JSON.parse(readFileSync(I18N + '/' + f, 'utf8'))
    assert.deepEqual(Object.keys(j), ['strings'], f)
    assert.deepEqual(Object.keys(j.strings), KEYS, f)
    assert.ok(statSync(I18N + '/' + f).size < 10240, f + ' is over 10 KB')
  })
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
    KEYS.forEach(k => { assert.ok(rows[l][k].length > 0, l + ' ' + k); assert.doesNotMatch(rows[l][k], /—|\n/, l + ' ' + k) })
  })
})

test('placeholders agree across languages: each word has the same {0} {1} {2} as English', async () => {
  const rows = await build()
  const holes = w => (w.match(/\{\d\}/g) || []).sort().join('')
  Object.keys(rows).forEach(l => KEYS.forEach(k => assert.equal(holes(rows[l][k]), holes(rows.en[k]), l + ' ' + k)))
})
