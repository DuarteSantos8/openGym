import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
function fixture(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'opengym-website-i18n-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  for (const file of ['scripts/check-website-i18n.mjs', ...['index.html', 'docs.html', 'about.html', 'api.html', 'it/index.html', 'it/docs.html', 'it/about.html', 'sitemap.xml'].map(file => 'website/' + file)]) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
    cpSync(path.join(root, file), path.join(dir, file))
  }
  return {
    edit(file, change) { const p = path.join(dir, file); writeFileSync(p, change(readFileSync(p, 'utf8'))) },
    run() { return spawnSync(process.execPath, [path.join(dir, 'scripts/check-website-i18n.mjs')], { encoding: 'utf8' }) }
  }
}

test('accepts the shipped navigation and relative anchor destinations', t => {
  const f = fixture(t)
  assert.equal(f.run().status, 0)
  f.edit('website/docs.html', html => html.replaceAll('href="https://opengym.ch/it/docs.html" lang="it"', "href='/it/docs.html' lang=\"it\""))
  assert.equal(f.run().status, 0)
})

test('rejects metadata-only English language navigation', t => {
  const f = fixture(t)
  f.edit('website/docs.html', html => html.replace(/<a\b[^>]*href="https:\/\/opengym.ch\/it\/docs.html"[^>]*>[\s\S]*?<\/a>/g, ''))
  const result = f.run()
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /no Italian navigation anchor/)
})

test('rejects partial destinations on Italian pages even when metadata is intact', t => {
  const f = fixture(t)
  f.edit('website/it/index.html', html => html.replace(/(<a\b[^>]*href=")\/it\/docs.html"/g, '$1/it/docs.html-extra"'))
  const result = f.run()
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /navigation missing \/it\/docs.html/)
})
