import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
const root = resolve(process.argv[2] || '.')
const { exerciseVolumeSeries } = await import(pathToFileURL(resolve(root, 'frontend/src/lib/exercise-volume.js')))
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()

// Independent hand-built arithmetic oracle; no production volume helper is used.
let seed = 53401
const rand = n => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) % n)
let assertions = 0
for (let trial = 0; trial < 400; trial++) {
  const warmups = !!rand(2), workouts = [], expected = []
  for (let j = 0; j < 8; j++) {
    const entries = [], date = `2026-11-${String(j + 7).padStart(2, '0')}`
    let total = 0, sets = 0
    for (let k = 0; k < 2; k++) {
      const each = !!rand(2), side = !!rand(2), rows = []
      const factor = each && !side ? 2 : 1
      for (let r = 0; r < 3; r++) {
        const warm = !!rand(2), timed = rand(5) === 0
        const limb = () => {
          const w = 5 + rand(25), reps = 1 + rand(12), done = rand(4) > 0
          const dw = rand(5), dr = rand(4)
          if (done && !timed && (!warm || warmups)) {
            total += factor * (w * reps + dw * dr)
            sets++
          }
          return { w, r: reps, done, type: 'dropset', drops: [{ w: dw, r: dr }] }
        }
        rows.push({ ...(side ? { sides: { L: limb(), R: limb() } } : limb()),
          phase: warm ? 'warmup' : 'work', mode: timed ? 'time' : 'reps' })
      }
      entries.push({ id: '0025', target: { dbLoad: each ? 'each' : 'total', side }, sets: rows })
    }
    workouts.push({ d: date, entries })
    if (total > 0) expected.push({ d: date, y: total, sets })
  }
  const S = { unit: 'kg', volumeWarmups: warmups, workouts }
  const before = JSON.stringify(S)
  const got = exerciseVolumeSeries(S, '0025', { now: new Date(2026, 10, 14, 18).getTime() })
  assert.deepEqual(got.points.map(({ d, y, sets }) => ({ d, y, sets })), expected)
  assert.equal(got.included + got.excluded, workouts.length)
  assert.equal(JSON.stringify(S), before)
  assertions += 3
}
console.log(JSON.stringify({ head, timezone: process.env.TZ || 'default', fixtures: 400, sessions: 3200, assertions, status: 'pass' }))
