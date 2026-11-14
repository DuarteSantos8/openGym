// A node:test reporter that writes one JSON line per finished test, with the file it is in.
// The built-in tap/junit reporters leave the file out for passing tests, and test-report.mjs
// needs it to count tests per app area.
//
//   node --test --test-reporter=../scripts/ci/node-test-reporter.mjs --test-reporter-destination=test-results.jsonl
export default async function* jsonLines(source) {
  for await (const ev of source) {
    if (ev.type !== 'test:pass' && ev.type !== 'test:fail') continue
    const d = ev.data
    if (d.details?.type === 'suite') continue
    const err = d.details?.error
    yield JSON.stringify({
      file: d.file,
      name: d.name,
      nesting: d.nesting,
      status: d.skip || d.todo ? 'skipped' : ev.type === 'test:pass' ? 'passed' : 'failed',
      ms: d.details?.duration_ms || 0,
      message: err ? String(err.cause?.message || err.message || err).split('\n')[0].slice(0, 300) : undefined,
    }) + '\n'
  }
}
