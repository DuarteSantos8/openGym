/* The recorded readings of real videos (test/fixtures), run through the same segmentation and
   classification the worker uses, scored against what a person saw when watching the video.
   A metric may not fall below test/fixtures/baseline.json; raising it is always fine and is
   recorded with `npm run score -- --update-baseline`. Unreviewed fixtures are not scored.
   No video, OCR or network: this runs everywhere, in a second. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { load, run, readBaseline } from './harness/fixtures.js'
import { regressions } from './harness/score.js'

const baseline = readBaseline()

for (const f of load()) {
  test(`fixture ${f.id}`, { skip: f.expected.reviewed ? false : 'not reviewed yet' }, () => {
    const { metrics } = run(f)
    const worse = regressions(baseline[f.id], metrics)
    assert.deepEqual(worse, {}, `${f.id} got worse: ${JSON.stringify(worse)} (now ${JSON.stringify(metrics)})`)
  })
}
