// Loading and checking the regression fixtures in test/fixtures (format: test/fixtures/README.md).

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { draftFromFrames } from '../../src/pipeline.js'
import { score } from './score.js'

export const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures')
export const BASELINE = path.join(DIR, 'baseline.json')

export function validate(f, file) {
  const fail = m => { throw new Error(`${path.basename(file)}: ${m}`) }
  if (f.version !== 1) fail(`unknown version ${f.version}`)
  if (!Array.isArray(f.frames) || !f.frames.length) fail('no frames')
  f.frames.forEach((x, i) => { if (x.t !== i) fail(`frames[${i}].t is ${x.t}, expected ${i} (one frame per second, no gaps)`) })
  const e = f.expected
  if (!e || !Array.isArray(e.timeline)) fail('no expected.timeline')
  for (const [i, s] of e.timeline.entries()) {
    if (!Array.isArray(s) || s.length !== 2 || !(s[0] === null || typeof s[0] === 'string') || !Number.isInteger(s[1]) || s[1] < 1) {
      fail(`expected.timeline[${i}] must be [label|null, seconds ≥ 1], got ${JSON.stringify(s)}`)
    }
  }
  const total = e.timeline.reduce((t, s) => t + s[1], 0)
  if (total !== f.frames.length) fail(`expected.timeline covers ${total} s, the frames ${f.frames.length} s`)
  return f
}

/** Every fixture, sorted by id. `filter` matches the id (file name without .json). */
export function load(filter = '') {
  if (!fs.existsSync(DIR)) return []
  return fs.readdirSync(DIR)
    .filter(n => n.endsWith('.json') && n !== 'baseline.json' && n.includes(filter))
    .sort()
    .map(n => {
      const file = path.join(DIR, n)
      return { id: n.replace(/\.json$/, ''), file, ...validate(JSON.parse(fs.readFileSync(file, 'utf8')), file) }
    })
}

export function run(f) {
  const { draft } = draftFromFrames(f.frames, f.inputs || {})
  return { draft, metrics: score(f.expected, draft) }
}

export const readBaseline = () => (fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : {})
