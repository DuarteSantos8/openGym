// The importable flow: in sync with verify.js, no secret in it, wired the way the README says, and
// its Function node's code run as Node-RED runs it (an async function with msg, env, context, node
// and the `crypto` lib in scope), so the glue is tested, not only the verifier.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { render, verifierSource, GLUE, OUT, SECRET_ENV, PATH } from '../build-flow.mjs'
import { signature, newSecret } from '../../../api/integrations/crypto.js'
import { envelope, testData } from '../../../api/integrations/events.js'

const text = readFileSync(OUT, 'utf8')
const flow = JSON.parse(text)
const byId = Object.fromEntries(flow.map(n => [n.id, n]))

test('the committed JSON is what build-flow.mjs writes from verify.js', () => {
  assert.equal(text, render())
  assert.equal(byId.og_verify.func, verifierSource() + '\n' + GLUE)
  assert.match(byId.og_verify.func, /function verifyOpenGymWebhook/)
  assert.doesNotMatch(byId.og_verify.func, /module\.exports/)
})

test('no secret in the flow: it reads the environment', () => {
  assert.doesNotMatch(text, /ogwh_/)
  assert.ok(byId.og_verify.func.includes(`env.get('${SECRET_ENV}')`))
  assert.doesNotMatch(text, /"credentials"/)
})

test('wired as documented: raw POST in, crypto lib, two outputs, every failure answered', () => {
  assert.deepEqual([byId.og_in.method, byId.og_in.url, byId.og_in.skipBodyParsing], ['post', PATH, true])
  assert.deepEqual(byId.og_in.wires, [['og_verify']])
  assert.deepEqual(byId.og_verify.libs, [{ var: 'crypto', module: 'crypto' }])
  assert.deepEqual(byId.og_verify.wires, [['og_handle'], ['og_reply']])
  // The answer to a handled delivery goes out only after it is recorded (og_done).
  assert.ok(byId.og_handle.wires[0].includes('og_done'))
  assert.ok(!byId.og_handle.wires[0].includes('og_reply'))
  assert.deepEqual(byId.og_done.wires, [['og_reply']])
  assert.deepEqual(byId.og_catch.scope.sort(), ['og_done', 'og_handle', 'og_verify'])
  assert.deepEqual(byId.og_failed.wires, [['og_reply']])
  assert.equal(byId.og_reply.type, 'http response')
  for (const n of flow) if (n.type !== 'tab') assert.equal(n.z, 'og_tab', n.id)
})

/** The Function node's code in a sandbox like Node-RED's 10-function.js gives it. */
function functionNode(code, { env = {}, flowStore = {} } = {}) {
  const store = {}, logs = []
  const sandbox = {
    Buffer, Date, console, crypto,
    env: { get: k => env[k] },
    context: { get: k => store[k], set: (k, v) => { store[k] = v } },
    flow: { get: k => flowStore[k], set: (k, v) => { flowStore[k] = v } },
    node: { status: () => {}, warn: m => logs.push(['warn', m]), error: m => logs.push(['error', m]) },
  }
  const fn = vm.runInNewContext(`(async function (msg) {\n${code}\n})`, sandbox)
  return { run: msg => fn(msg), store, flowStore, logs }
}

// Objects made inside the vm have its own prototypes; compare their JSON.
const plain = v => JSON.parse(JSON.stringify(v))
const SECRET = newSecret()
const now = Date.now()
const body = JSON.stringify(envelope({ id: 'evt_flow1', type: 'workout.finished', data: testData('workout.finished', now), at: now }))
const msgFor = (raw, header) => ({ payload: Buffer.from(raw), req: { headers: { 'x-opengym-signature': header } } })

test('the verify node: authentic goes to output 1, a forgery or a repeat to output 2 with a fixed body', async () => {
  const flowStore = {}
  const node = functionNode(byId.og_verify.func, { env: { [SECRET_ENV]: SECRET }, flowStore })
  const [ok, refused] = await node.run(msgFor(body, signature(SECRET, body)))
  assert.equal(refused, null)
  assert.equal(ok.opengym.id, 'evt_flow1')
  await functionNode(byId.og_done.func, { flowStore }).run(ok)
  const [, dup] = await node.run(msgFor(body, signature(SECRET, body)))
  assert.deepEqual(plain([dup.statusCode, dup.payload]), [200, { ok: true, duplicate: true }])
  const [, bad] = await node.run(msgFor(body, signature(newSecret(), body)))
  assert.deepEqual(plain([bad.statusCode, bad.payload]), [401, { error: 'unauthorized' }])
  assert.deepEqual(plain(Object.keys(flowStore.opengymSeen)), ['k:evt_flow1'])
  assert.ok(node.logs.some(([lvl, m]) => lvl === 'warn' && /refused \(401\)/.test(m)))
  assert.ok(!JSON.stringify(node.logs).includes(SECRET), 'the secret is never logged')
})

test('the verify node without its secret answers 500 and logs why', async () => {
  const node = functionNode(byId.og_verify.func)
  const [, out] = await node.run(msgFor(body, signature(SECRET, body)))
  assert.deepEqual(plain([out.statusCode, out.payload]), [500, { error: 'receiver not configured' }])
  assert.ok(node.logs.some(([lvl, m]) => lvl === 'error' && /OPENGYM_WEBHOOK_SECRET/.test(m)))
})

test('the demo handler only describes the event and answers 200', async () => {
  const node = functionNode(byId.og_handle.func)
  const out = await node.run({ opengym: JSON.parse(body) })
  assert.deepEqual(plain([out.statusCode, out.payload]), [200, { ok: true, handled: 'workout.finished' }])
  assert.match(out.summary, /^Workout finished: Test workout, 3 sets$/)
})

test('a delivery is recorded only after the handler: verify leaves it out, og_done puts it in', async () => {
  const flowStore = {}
  const verify = functionNode(byId.og_verify.func, { env: { [SECRET_ENV]: SECRET }, flowStore })
  const done = functionNode(byId.og_done.func, { flowStore })
  const t = Math.floor(Date.now() / 1000)
  const first = await verify.run(msgFor(body, signature(SECRET, body, t)))
  assert.ok(first[0], 'authentic: on to the handler')
  assert.equal(Object.keys(flowStore.opengymSeen || {}).length, 0, 'not recorded before the handler ran')
  // The handler threw (og_done never ran): the retry is handled again.
  const retry = await verify.run(msgFor(body, signature(SECRET, body, t + 30)))
  assert.ok(retry[0], 'retry after a failed handler is handled, not a duplicate')
  // The handler finished: og_done records it and passes the answer on, without its bookkeeping.
  const out = await done.run(retry[0])
  assert.equal(out._opengymRemember, undefined)
  assert.equal(Object.keys(flowStore.opengymSeen).length, 1)
  const again = await verify.run(msgFor(body, signature(SECRET, body, t + 60)))
  assert.equal(again[0], null)
  assert.deepEqual(plain(again[1].payload), { ok: true, duplicate: true })
})
