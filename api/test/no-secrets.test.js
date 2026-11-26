// The fork is public (AGENTS.md: "scan the diff for … secrets"). This is that scan, for the
// kinds of key the Cloud edition handles (ADR 0008, ADR 0011), run with the API's suite so a
// committed key turns CI red. It reads the files git tracks and looks for the shape of a live
// credential, not for the word.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

// The key's prefix, then enough random characters to be a real one. Test fixtures use short
// stand-ins (`sk_test_x`, `whsec_test`) on purpose, and stay under the length.
export const PATTERNS = [
  ['Stripe live secret key', /\bsk_live_[A-Za-z0-9]{16,}/],
  ['Stripe restricted key', /\brk_live_[A-Za-z0-9]{16,}/],
  ['Stripe test secret key', /\bsk_test_[A-Za-z0-9]{24,}/],
  ['Stripe webhook secret', /\bwhsec_[A-Za-z0-9]{24,}/],
  ['Supabase secret key', /\bsb_secret_[A-Za-z0-9_-]{20,}/],
  // A legacy service-role JWT: a JWT whose payload says "role":"service_role".
  ['Supabase service-role JWT', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]*c2VydmljZV9yb2xl[A-Za-z0-9_-]*\.[A-Za-z0-9_-]{20,}/],
  ['private key block', /-----BEGIN (?:EC |RSA |OPENSSH )?PRIVATE KEY-----/],
]

/** [{ file, what }] for every tracked text file under `dir` that holds something key-shaped. */
export function scan(files, read = f => readFileSync(join(root, f), 'utf8')) {
  const found = []
  for (const f of files) {
    let text
    try { text = read(f) } catch { continue }
    for (const [what, re] of PATTERNS) if (re.test(text)) found.push({ file: f, what })
  }
  return found
}

const SKIP = /\.(png|jpe?g|gif|webp|avif|ico|icns|woff2?|ttf|otf|mp3|mp4|webm|wav|ogg|glb|gltf|bin|wasm|task|tflite|pdf|zip|gz|jar|keystore|lottie|svgz)$/i
// Files whose job is to hold a throwaway key on purpose (a test's own key pair, written in the
// test). Each entry needs a reason.
const ALLOW = new Set([
  'api/test/no-secrets.test.js',       // this file: the patterns and the samples below
])

test('the scan sees each kind of key, and leaves stand-ins alone', () => {
  const sample = {
    a: 'STRIPE=sk_live_' + 'a'.repeat(24),
    b: 'key: sb_secret_' + 'b'.repeat(32),
    c: 'whsec_' + 'c'.repeat(32),
    d: '-----BEGIN PRIVATE KEY-----\nMIIE',
    e: 'eyJhbGciOiJIUzI1NiJ9.' + Buffer.from('{"role":"service_role","iss":"supabase"}').toString('base64url') + '.' + 'd'.repeat(43),
    ok1: 'STRIPE_SECRET_KEY=sk_test_x  STRIPE_WEBHOOK_SECRET=whsec_test',
    ok2: 'set SUPABASE_SECRET_KEY to your sb_secret_… key',
    ok3: 'sk_live_ and sb_secret_ are prefixes, not keys',
  }
  const hits = scan(Object.keys(sample), f => sample[f]).map(h => h.file).sort()
  assert.deepEqual(hits, ['a', 'b', 'c', 'd', 'e'])
})

test('no tracked file holds a live key', t => {
  let files
  try { files = execFileSync('git', ['ls-files', '-z'], { cwd: root, maxBuffer: 64 * 1024 * 1024 }).toString('utf8').split('\0').filter(Boolean) }
  catch { t.skip('not a git checkout (a container build): nothing to list'); return }
  const text = files.filter(f => !SKIP.test(f) && !f.startsWith('catalogue/media/') && !ALLOW.has(f))
    .filter(f => { try { return statSync(join(root, f)).size < 2 * 1024 * 1024 } catch { return false } })
  assert.ok(text.length > 1000, 'the file list looks too short to be the repository')
  assert.deepEqual(scan(text), [])
})
