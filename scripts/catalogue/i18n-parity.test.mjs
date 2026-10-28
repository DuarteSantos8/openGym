import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as core from '../../frontend/src/lib/i18n-core.js'
import { INSTR_LANGS } from '../../frontend/src/lib/i18n-core.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const id = '0025'
const sources = fs.readdirSync(path.join(root, 'catalogue/exercises'))
  .filter(file => /^\d{4,5}\.json$/.test(file))
  .map(file => JSON.parse(fs.readFileSync(path.join(root, 'catalogue/exercises', file), 'utf8')))
  .filter(exercise => !exercise.variantOf)
const italianRows = JSON.parse(fs.readFileSync(path.join(root, 'catalogue/i18n/it.json'), 'utf8'))
const italian = italianRows[id]

test('Italian catalogue stays aligned and untranslated details fall back to English', async () => {
  const [itDesc, enDesc, itInstr, enInstr] = await Promise.all([
    import(pathToFileURL(path.join(root, 'frontend/src/exercise-desc/it.js'))),
    import(pathToFileURL(path.join(root, 'frontend/src/exercise-desc/en.js'))),
    import(pathToFileURL(path.join(root, 'frontend/src/instr/it.js'))),
    import(pathToFileURL(path.join(root, 'frontend/src/instr/en.js'))),
  ])

  assert.equal(Object.keys(italianRows).length, sources.length)
  for (const source of sources) {
    const row = italianRows[source.id]
    assert.ok(row?.description, `${source.id}: missing Italian description`)
    assert.deepEqual(row.instructions, itInstr.default[source.id], `${source.id}: generated instruction mismatch`)
    assert.equal(row.description, itDesc.default[source.id], `${source.id}: generated description mismatch`)
    assert.equal(row.instructions.length, source.instructions.length, `${source.id}: instruction count differs from source`)
  }
  assert.ok(INSTR_LANGS.includes('it'))
  assert.ok(!INSTR_LANGS.includes('bn'))

  core._setLangState('it', {}, itInstr.default, null)
  core._setDetails(enInstr.default, enDesc.default, itDesc.default, 'it')
  assert.equal(core.getLang(), 'it')
  assert.equal(core.descFor({ id }), italian.description)
  assert.deepEqual(core.instrFor({ id }), italian.instructions)

  core._setLangState('bn', {}, null, null)
  core._setDetails(enInstr.default, enDesc.default, null, 'bn')
  assert.equal(core.descFor({ id }), enDesc.default[id])
  assert.deepEqual(core.instrFor({ id }), enInstr.default[id])

  core._setLangState('en', {}, null, null)
})
