import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { StorageCorruptError, durableAtomicWrite, etagFor, normalizeIfMatch, readJson, readRevision } from './storage.js'

test('durable atomic replacement produces a strong revision and refuses corrupt JSON', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opengym-storage-'))
  const file = path.join(dir, 'state.json')
  durableAtomicWrite(file, JSON.stringify({ id: 'a', nested: { sets: [1, 2] } }))
  const first = readRevision(file)
  assert.equal(first, etagFor(fs.readFileSync(file)))
  assert.deepEqual(readJson(file), { id: 'a', nested: { sets: [1, 2] } })
  assert.equal(readJson(path.join(dir, 'optional.json'), { missing: undefined }), undefined)
  durableAtomicWrite(file, '{broken')
  assert.throws(() => readJson(file), error => error instanceof StorageCorruptError && error.code === 'STORAGE_CORRUPT')
  assert.equal(normalizeIfMatch(first), first)
  assert.equal(normalizeIfMatch(''), null)
  assert.equal(normalizeIfMatch('W/' + first), null)
  fs.rmSync(dir, { recursive: true, force: true })
})
