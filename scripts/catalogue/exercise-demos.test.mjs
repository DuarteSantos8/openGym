// node --test scripts/catalogue/exercise-demos.test.mjs
// The hand-checked tables in exercise-demos.mjs stay consistent with the catalogue and with what the
// app accepts, without downloading anything.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { ATP, ATP_FIGURES, VIDEOS, commonsPage, notice } from './exercise-demos.mjs'

const catDir = new URL('../../catalogue/exercises/', import.meta.url)
const exists = id => fs.existsSync(new URL(id + '.json', catDir))

test('every mapped exercise exists in the catalogue', () => {
  for (const v of VIDEOS) assert.ok(exists(v.id), v.id)
  for (const [fig, ids] of Object.entries(ATP_FIGURES)) for (const id of ids) assert.ok(exists(id), `${fig} -> ${id}`)
})

test('one video per exercise, each under a licence the app shows', () => {
  const ids = VIDEOS.map(v => v.id)
  assert.equal(new Set(ids).size, ids.length)
  for (const v of VIDEOS) {
    assert.match(v.license, /^CC-BY(-SA)?-(3|4)\.0$/)
    assert.match(v.file, /\.(webm|ogv|mp4)$/)
    if (v.start != null) assert.ok(v.duration > 0 && v.duration <= 30, v.file)
  }
})

test('figure numbers look like ATP figures and the manual is the official public release', () => {
  for (const fig of Object.keys(ATP_FIGURES)) assert.match(fig, /^\d{1,2}-\d{1,2}$/)
  assert.match(ATP.url, /^https:\/\/armypubs\.army\.mil\/epubs\/.+ATP_7-22\.02.+\.pdf$/)
  assert.equal(ATP.license, 'PD-USGov')
})

test('Commons links are encoded file pages', () => {
  assert.equal(commonsPage('Hip Sled - How to perform a 45 degree leg press.webm'), 'https://commons.wikimedia.org/wiki/File:Hip_Sled_-_How_to_perform_a_45_degree_leg_press.webm')
})

test('NOTICE lists each file with its author, licence and source', () => {
  const md = notice({ '0025': [{ f: 'files/video-0025.mp4', poster: 'files/video-0025.webp', author: 'A', license: 'CC-BY-SA-4.0', source: 'https://s' }] }, { '0025': { name: 'barbell bench press' } })
  assert.match(md, /\| 0025 barbell bench press \| `files\/video-0025\.mp4` \| A \| CC BY-SA 4\.0 \| https:\/\/s \|/)
  assert.match(md, /`files\/video-0025\.webp`/)
})
