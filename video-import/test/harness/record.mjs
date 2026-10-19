// Records a fixture for every video in test/corpus.json that has none yet, one after another,
// through src/cli.js. Needs YouTube, ffmpeg and the OCR, so it runs in the worker image:
//
//   docker compose --profile video-import run --rm -v "$PWD/video-import/test:/app/test" video-import \
//     node test/harness/record.mjs [--status calibrated] [--channel "Rowan Row"] [<videoId>…]
//
// A video read from its chapters alone (no --video) still goes through the frames, so every
// fixture has readings. A failure is logged and the next video goes on. The fixtures come out
// unreviewed: watch each video and correct `expected` (test/fixtures/README.md).

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { DIR } from './fixtures.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..', '..')
const corpus = JSON.parse(fs.readFileSync(path.join(here, '..', 'corpus.json'), 'utf8')).videos
const args = process.argv.slice(2)
const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null }
const ids = args.filter((a, i) => !a.startsWith('--') && !['--status', '--channel'].includes(args[i - 1]))

const todo = corpus.filter(v => (ids.length ? ids.includes(v.id) : v.status !== 'skip')
  && (!opt('--status') || v.status === opt('--status'))
  && (!opt('--channel') || v.channel === opt('--channel'))
  && !fs.existsSync(path.join(DIR, `${v.id}.json`)))

console.error(`${todo.length} video(s) to record`)
const failed = []
for (const v of todo) {
  console.error(`\n=== ${v.id} (${v.channel || '?'}): ${v.look}`)
  const out = path.join(here, '..', '.record', v.id)
  const a = ['src/cli.js', `https://www.youtube.com/watch?v=${v.id}`, '--video', '--out', out, '--fixture', path.join(DIR, `${v.id}.json`)]
  if (v.roi?.name) a.push('--name', v.roi.name)
  if (v.roi?.timer) a.push('--timer', v.roi.timer)
  const r = spawnSync('node', a, { cwd: root, stdio: 'inherit' })
  if (r.status !== 0 || !fs.existsSync(path.join(DIR, `${v.id}.json`))) failed.push(v.id)
}
if (failed.length) { console.error(`\nno fixture for: ${failed.join(' ')} (stills in test/.record/<id>)`); process.exitCode = 1 }
