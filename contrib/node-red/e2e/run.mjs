// End to end in a real Node-RED: start the pinned version headless with the generated flow and a
// throwaway user dir, then send it what openGym sends (signed by api/integrations/crypto.js,
// shaped by events.js) and what an attacker might. Prints one line per case; exits 1 on any miss.
//
//   npm --prefix contrib/node-red/e2e ci && node contrib/node-red/e2e/run.mjs
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { signature, newSecret } from '../../../api/integrations/crypto.js'
import { envelope, testData } from '../../../api/integrations/events.js'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const RED = require.resolve('node-red/red.js')
const version = JSON.parse(readFileSync(join(dirname(RED), 'package.json'), 'utf8')).version

const freePort = () => new Promise(res => { const s = createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)) }) })
const SECRET = newSecret()
const port = await freePort()
const userDir = mkdtempSync(join(tmpdir(), 'og-nodered-'))
// The generated flow, with one change: the demo handler throws the first time it sees
// evt_e2e_flaky, so the run can show that a failed handler's delivery is retried, not lost.
const flow = JSON.parse(readFileSync(join(here, '..', 'opengym-webhook-flow.json'), 'utf8'))
const handler = flow.find(n => n.id === 'og_handle')
handler.func = "if (msg.opengym.id === 'evt_e2e_flaky' && !context.get('failedOnce')) { context.set('failedOnce', true); throw new Error('handler failed (e2e)'); }\n" + handler.func
writeFileSync(join(userDir, 'flows.json'), JSON.stringify(flow))

const child = spawn(process.execPath, [RED, '--userDir', userDir, '--port', String(port), 'flows.json'], {
  env: { ...process.env, OPENGYM_WEBHOOK_SECRET: SECRET, NODE_RED_ENABLE_PROJECTS: 'false' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let log = ''
child.stdout.on('data', d => { log += d })
child.stderr.on('data', d => { log += d })
const stop = () => { child.kill('SIGTERM'); rmSync(userDir, { recursive: true, force: true }) }

const started = await new Promise(res => {
  const t = setTimeout(() => res(false), 60_000)
  const iv = setInterval(() => { if (/Started flows/.test(log)) { clearTimeout(t); clearInterval(iv); res(true) } }, 100)
  child.on('exit', () => { clearTimeout(t); clearInterval(iv); res(false) })
})
if (!started) { console.error('Node-RED did not start:\n' + log); stop(); process.exit(1) }

const url = `http://127.0.0.1:${port}/opengym/webhook`
const now = Date.now()
const T = Math.floor(now / 1000)
const body = (id, type = 'workout.finished') => JSON.stringify(envelope({ id, type, data: testData(type, now), at: now }))
const post = async (raw, header, extra = {}) => {
  const headers = { 'Content-Type': 'application/json', 'X-OpenGym-Event': 'workout.finished', 'X-OpenGym-Delivery': 'evt_e2e', ...extra }
  if (header !== undefined) headers['X-OpenGym-Signature'] = header
  const r = await fetch(url, { method: 'POST', headers, body: raw })
  return { status: r.status, text: await r.text() }
}

const b1 = body('evt_e2e_1')
const tampered = b1.replace('Test workout', 'Test workoux')
const big = JSON.stringify({ ...JSON.parse(body('evt_big')), pad: 'x'.repeat(70 * 1024) })
const cases = [
  ['valid workout.finished', () => post(b1, signature(SECRET, b1)), 200, /"handled":"workout.finished"/],
  ['same delivery again (openGym retry, new t)', () => post(b1, signature(SECRET, b1, T + 2)), 200, /"duplicate":true/],
  // Recorded as seen only after the handler finished: a handler that threw answers 500 and
  // openGym's retry (same id) is handled, not dropped as a duplicate (Codex review on #8).
  ['handler throws: 500, so openGym retries', () => { const b = body('evt_e2e_flaky'); return post(b, signature(SECRET, b)) }, 500, /receiver error/],
  ['the retry after a failed handler is handled', () => { const b = body('evt_e2e_flaky'); return post(b, signature(SECRET, b, T + 5)) }, 200, /"handled":"workout.finished"/],
  ['and only then is the next copy a duplicate', () => { const b = body('evt_e2e_flaky'); return post(b, signature(SECRET, b, T + 9)) }, 200, /"duplicate":true/],
  ['valid weighin.logged', () => { const b = body('evt_e2e_2', 'weighin.logged'); return post(b, signature(SECRET, b)) }, 200, /"handled":"weighin.logged"/],
  // A type openGym may add later: acknowledged (a 4xx would be a final failure there), never handled.
  ['authentic but unknown event type: 200, not handled', () => { const b = JSON.stringify({ ...JSON.parse(body('evt_e2e_future')), type: 'workout.deleted' }); return post(b, signature(SECRET, b)) }, 200, /^\{"ok":true,"ignored":true\}$/],
  ['tampered body', () => post(tampered, signature(SECRET, b1)), 401, /unauthorized/],
  ['wrong secret', () => post(body('evt_e2e_3'), signature(newSecret(), body('evt_e2e_3'))), 401, /unauthorized/],
  ['stale timestamp (10 min)', () => post(body('evt_e2e_4'), signature(SECRET, body('evt_e2e_4'), T - 600)), 401, /unauthorized/],
  ['missing signature header', () => post(body('evt_e2e_5'), undefined), 401, /unauthorized/],
  ['malformed signature header', () => post(body('evt_e2e_6'), 'sha256=deadbeef'), 401, /unauthorized/],
  ['signed but not JSON', () => post('not json', signature(SECRET, 'not json')), 400, /bad request/],
  ['oversized (70 KiB), validly signed', () => post(big, signature(SECRET, big)), 413, /payload too large/],
  // Node-RED reads a raw body whole before the flow sees it (21-httpin.js rawBodyCapture has no
  // size limit), so this is refused only after it is in memory: the README says to cap it in front.
  ['8 MiB body: refused, Node-RED keeps running', () => { const b = 'x'.repeat(8 * 1024 * 1024); return post(b, signature(SECRET, b)) }, 413, /payload too large/],
  ['signed with extra whitespace (raw bytes, not re-serialised)', () => { const b = body('evt_e2e_7').replace('{', '{  '); return post(b, signature(SECRET, b)) }, 200, /"handled"/],
]

let failed = 0
console.log(`Node-RED ${version} on :${port}`)
for (const [name, run, status, re] of cases) {
  let res
  try { res = await run() } catch (e) { res = { status: 0, text: String(e) } }
  const ok = res.status === status && re.test(res.text) && !res.text.includes(SECRET) && !res.text.includes('ogwh_')
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${String(res.status).padEnd(3)} ${name}  ${res.text.slice(0, 80)}`)
}
const leaked = log.includes(SECRET)
if (leaked) { failed++; console.log('FAIL  the secret appears in the Node-RED log') } else console.log('PASS  the secret never appears in the Node-RED log')
stop()
console.log(`${cases.length + 1 - failed}/${cases.length + 1} passed`)
process.exit(failed ? 1 : 0)
