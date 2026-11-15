#!/usr/bin/env node
/* Builds opengym-webhook-flow.json, the importable Node-RED flow, from verify.js. The Function
 * node's code is verify.js itself (everything above its export block) plus the glue below, so
 * what the tests check is what Node-RED runs.
 *
 *   node build-flow.mjs           write the JSON
 *   node build-flow.mjs --check   exit 1 when the committed JSON is not what this would write
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
export const OUT = join(here, 'opengym-webhook-flow.json')
export const SECRET_ENV = 'OPENGYM_WEBHOOK_SECRET'
export const PATH = '/opengym/webhook'

/** verify.js as it goes into the Function node: no export block. */
export function verifierSource() {
  const src = readFileSync(join(here, 'verify.js'), 'utf8')
  const cut = src.indexOf('/* --- export (not pasted into the flow) --- */')
  if (cut < 0) throw new Error('verify.js: export marker missing')
  return src.slice(0, cut).trimEnd()
}

export const GLUE = `
/* ---- Node-RED glue (build-flow.mjs) ----
 * Output 1: an authentic, new delivery, on to the handler. Output 2: the answer for everything
 * else (refused, too large, or already handled), straight to the http response node.
 * Seen ids are in flow context, shared with "Record as delivered", which adds a delivery only
 * after the handler finished: a handler that throws leaves it out, so openGym's retry runs again. */
const seen = flow.get('opengymSeen') || {};
const result = verifyOpenGymWebhook({
    rawBody: msg.payload,
    headers: msg.req && msg.req.headers,
    secret: env.get('${SECRET_ENV}'),
    crypto: crypto,
    seen: seen,
    now: Date.now(),
    toleranceSec: Number(env.get('OPENGYM_WEBHOOK_TOLERANCE_SEC')) || 300,
    maxBytes: Number(env.get('OPENGYM_WEBHOOK_MAX_BYTES')) || 65536,
    defer: true
});
msg.headers = { 'Content-Type': 'application/json' };
if (result.ok && !result.duplicate && !result.ignored) {
    msg._opengymRemember = result.remember;
    msg.opengym = result.envelope;
    msg.payload = result.envelope;
    node.status({ fill: 'green', shape: 'dot', text: result.envelope.type });
    return [msg, null];
}
if (result.ignored) { flow.set('opengymSeen', seen); node.status({ fill: 'grey', shape: 'ring', text: 'not handled: ' + result.type.slice(0, 30) }); }
else if (result.duplicate) node.status({ fill: 'blue', shape: 'ring', text: 'duplicate ignored' });
else if (result.status >= 500) { node.error('openGym webhook: ' + result.reason); node.status({ fill: 'red', shape: 'ring', text: 'not configured' }); }
else { node.warn('openGym webhook refused (' + result.status + '): ' + result.reason); node.status({ fill: 'yellow', shape: 'ring', text: 'refused ' + result.status }); }
msg.statusCode = result.status;
msg.payload = publicBody(result);
return [null, msg];
`

const HANDLER = `// A harmless demo: it only describes the event. Replace it with what you want to happen
// (a notification, a light, a log line). The envelope is in msg.opengym (docs/INTEGRATIONS.md).
const ev = msg.opengym;
const d = ev.data || {};
let summary = ev.type;
if (ev.type === 'workout.finished' && d.workout) summary = 'Workout finished: ' + (d.workout.name || 'workout') + ', ' + (d.workout.totals ? d.workout.totals.sets : 0) + ' sets';
else if (ev.type === 'workout.pr' && Array.isArray(d.records)) summary = 'New records: ' + d.records.map(r => r.name).join(', ');
else if (ev.type === 'weighin.logged' && d.weighin) summary = 'Weigh-in: ' + d.weighin.weight + ' ' + d.weighin.unit;
if (ev.test) summary = '(test) ' + summary;
msg.summary = summary;
msg.statusCode = 200;
msg.headers = { 'Content-Type': 'application/json' };
msg.payload = { ok: true, handled: ev.type };
return msg;`

export const DONE = `
/* ---- Node-RED glue (build-flow.mjs) ----
 * The handler finished: record the delivery so openGym's next copy of it is a duplicate, then
 * pass the handler's answer on. */
if (msg._opengymRemember) {
    const seen = flow.get('opengymSeen') || {};
    rememberDelivery(seen, msg._opengymRemember, Date.now(), 10000);
    flow.set('opengymSeen', seen);
}
delete msg._opengymRemember;
return msg;
`

const FAILED = `// Something threw after the request arrived. openGym retries a 5xx later; no details are sent back.
msg.statusCode = 500;
msg.headers = { 'Content-Type': 'application/json' };
msg.payload = { error: 'receiver error' };
return msg;`

export function buildFlow() {
  const z = 'og_tab'
  return [
    { id: z, type: 'tab', label: 'openGym webhooks', disabled: false,
      info: 'Receives openGym webhooks, checks the signature, timestamp and delivery id, and hands authentic events to a demo handler.\n\nSet OPENGYM_WEBHOOK_SECRET in the Node-RED environment to the signing secret openGym showed when you added the webhook. See contrib/node-red/README.md.' },
    { id: 'og_in', type: 'http in', z, name: 'openGym webhook', url: PATH, method: 'post', upload: false,
      skipBodyParsing: true, swaggerDoc: '', x: 150, y: 120, wires: [['og_verify']] },
    { id: 'og_verify', type: 'function', z, name: 'Check openGym signature', func: verifierSource() + '\n' + GLUE,
      outputs: 2, timeout: 0, noerr: 0, initialize: '', finalize: '',
      libs: [{ var: 'crypto', module: 'crypto' }], x: 380, y: 120, wires: [['og_handle'], ['og_reply']] },
    { id: 'og_handle', type: 'function', z, name: 'Handle event (demo)', func: HANDLER,
      outputs: 1, timeout: 0, noerr: 0, initialize: '', finalize: '', libs: [], x: 620, y: 80, wires: [['og_done', 'og_debug']] },
    { id: 'og_done', type: 'function', z, name: 'Record as delivered', func: verifierSource() + '\n' + DONE,
      outputs: 1, timeout: 0, noerr: 0, initialize: '', finalize: '', libs: [], x: 860, y: 80, wires: [['og_reply']] },
    { id: 'og_debug', type: 'debug', z, name: 'Event summary', active: true, tosidebar: true, console: false,
      tostatus: true, complete: 'summary', targetType: 'msg', statusVal: 'summary', statusType: 'auto', x: 860, y: 30, wires: [] },
    { id: 'og_reply', type: 'http response', z, name: 'Answer openGym', statusCode: '', headers: {}, x: 1080, y: 120, wires: [] },
    { id: 'og_catch', type: 'catch', z, name: 'Errors after receipt', scope: ['og_verify', 'og_handle', 'og_done'], uncaught: false, x: 380, y: 200, wires: [['og_failed']] },
    { id: 'og_failed', type: 'function', z, name: '500, no details', func: FAILED,
      outputs: 1, timeout: 0, noerr: 0, initialize: '', finalize: '', libs: [], x: 620, y: 200, wires: [['og_reply']] },
  ]
}

export const render = () => JSON.stringify(buildFlow(), null, 2) + '\n'

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const next = render()
  if (process.argv.includes('--check')) {
    let cur = ''
    try { cur = readFileSync(OUT, 'utf8') } catch { /* missing counts as stale */ }
    if (cur !== next) { console.error('opengym-webhook-flow.json is stale: run node contrib/node-red/build-flow.mjs'); process.exit(1) }
    console.log('opengym-webhook-flow.json in sync with verify.js')
  } else {
    writeFileSync(OUT, next)
    console.log('wrote ' + OUT)
  }
}
