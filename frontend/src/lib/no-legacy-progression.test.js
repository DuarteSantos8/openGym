import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const src = join(dirname(fileURLToPath(import.meta.url)), '..')
const walk = dir => readdirSync(dir, { withFileTypes: true })
  .flatMap(item => item.isDirectory() ? walk(join(dir, item.name)) : [join(dir, item.name)])
const files = () => walk(src).filter(file => /\.(js|jsx)$/.test(file))

describe('legacy progression is gone', () => {
  it('removes the old modules and imports', () => {
    expect(existsSync(join(src, 'lib/progression.js'))).toBe(false)
    expect(existsSync(join(src, 'lib/finish-workout.js'))).toBe(false)
    expect(files().filter(file => /from\s+['"].*\/(progression|finish-workout)\.js['"]/.test(readFileSync(file, 'utf8')))).toEqual([])
  })

  it('keeps the legacy policy vocabulary only at the compatibility boundary', () => {
    const allowed = new Set([
      'lib/prescription/vocabulary.js',
      'lib/prescription/vocabulary.test.js',
      'lib/no-legacy-progression.test.js',
    ])
    const offenders = files()
      .filter(file => /\bPOLICIES\b/.test(readFileSync(file, 'utf8')))
      .map(file => file.slice(src.length + 1).replace(/\\/g, '/'))
      .filter(file => !allowed.has(file))
    expect(offenders).toEqual([])
  })

  it('removes the binding/snapshot engine and its v1→v2 migration', () => {
    expect(existsSync(join(src, 'lib/training-engine'))).toBe(false)
    const offenders = files()
      .filter(file => !file.endsWith('no-legacy-progression.test.js'))
      .filter(file => /training-engine|engineSnapshots|trainingReferences|snapshotId|needsMigration/.test(readFileSync(file, 'utf8')))
      .map(file => file.slice(src.length + 1))
    expect(offenders).toEqual([])
  })

  it('has exactly one v1→v2 profile migration, the shared one in api/migration', () => {
    const offenders = files()
      .filter(file => !file.endsWith('no-legacy-progression.test.js'))
      .filter(file => /function\s+migrateProfile/.test(readFileSync(file, 'utf8')))
    expect(offenders).toEqual([])
  })
})
