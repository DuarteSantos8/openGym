import { test } from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { spawnSync } from 'node:child_process';
import * as food from '../food-lookup.js';

const barcode = '3017620422003', other = '96385074', third = '036000291452';
const payload = code => ({ code, status: 'success', result: { id: 'product_found' },
  product: { code, product_name: 'Example', nutrition: { aggregated_set: {
    per: '100g', preparation: 'as_sold', nutrients: { proteins: { value: 5, unit: 'g' } }
  } } } });
const reply = (value = payload(barcode), statusCode = 200) => ({ statusCode, headers: {},
  body: Readable.from([Buffer.from(JSON.stringify(value))]) });
const missing = { status: 'failure', result: { id: 'product_not_found' } };
function create(options = {}) {
  assert.equal(typeof food.createFoodLookup, 'function', 'createFoodLookup must be implemented');
  return food.createFoodLookup({ enabled: true, transport: async () => reply(), ...options });
}
const query = (hub, code = barcode, uid = 'user-a', nutrition = true) => hub.lookup({ uid, nutrition, barcode: code });
const isError = (status, code) => e => e.status === status && e.code === code && !e.message.includes('SECRET');

test('operator/user gates require explicit booleans and never call transport', async () => {
  let calls = 0;
  const transport = async () => { calls++; return reply(); };
  for (const enabled of [false, undefined, 'true', 1]) {
    const hub = create({ enabled, transport });
    await assert.rejects(query(hub), isError(403, 'food-lookup-disabled'));
  }
  const hub = create({ transport });
  for (const nutrition of [false, null, undefined, 'true', 1, {}]) {
    await assert.rejects(hub.lookup({ uid: 'user-a', barcode, nutrition }), isError(403, 'nutrition-disabled'));
  }
  await assert.rejects(query(hub, barcode, ''), isError(401, 'food-lookup-auth-required'));
  await assert.rejects(query(hub, 'bad'), isError(400, 'food-lookup-invalid-barcode'));
  assert.equal(calls, 0);
});

test('outbound request contains only fixed URL, headers and internal time bounds', async () => {
  let got;
  const hub = create({ contact: 'ops@example.org', transport: async (...args) => { got = args; return reply(); } });
  assert.equal((await query(hub)).label, 'Example');
  assert.equal(got[0], 'https://world.openfoodfacts.org/api/v3.6/product/3017620422003?fields=code,product_name,brands,quantity,serving_size,nutrition');
  assert.deepEqual(got[1].headers, { Accept: 'application/json', 'User-Agent': 'openGym/1.4.4 (ops@example.org)' });
  assert.deepEqual(Object.keys(got[1]).sort(), ['connectTimeoutMs', 'headers', 'signal']);
  assert.equal(got[1].connectTimeoutMs, 2000);
  assert.ok(got[1].signal instanceof AbortSignal);
  assert.equal(JSON.stringify(got).includes('user-a'), false);
});

test('operator contact cannot inject headers or arbitrary free text', async () => {
  for (const contact of ['', 'x\r\nAuthorization: SECRET', 'a'.repeat(300), '(bad)']) {
    let ua;
    const hub = create({ contact, transport: async (url, options) => { ua = options.headers['User-Agent']; return reply(); } });
    await query(hub); assert.equal(ua, 'openGym/1.4.4');
  }
});

for (const status of [301, 302, 307, 400, 429, 500, 503]) {
  test(`upstream ${status} is one safe 502 with no retry or redirect`, async () => {
    let calls = 0; const body = Readable.from(['SECRET']);
    const hub = create({ transport: async () => { calls++; return { statusCode: status, body,
      headers: { location: 'http://169.254.169.254/SECRET' } }; } });
    await assert.rejects(query(hub), isError(502, 'food-lookup-upstream'));
    assert.equal(calls, 1); assert.equal(body.destroyed, true);
  });
}

test('truncated JSON, bad shapes and a misleading 404 cannot become a product or negative cache', async () => {
  for (const r of [{ statusCode: 200, body: Readable.from(['{"status":"success",']) },
    reply({}, 200), reply({ status: 'failure', result: { id: 'internal_error', name: 'SECRET' } }, 404)]) {
    const hub = create({ transport: async () => r });
    await assert.rejects(query(hub), isError(502, 'food-lookup-upstream'));
  }
});

test('only an explicit not-found shape maps to 404 on HTTP 200 or 404', async () => {
  for (const statusCode of [200, 404]) {
    await assert.rejects(query(create({ transport: async () => reply(missing, statusCode) })), isError(404, 'food-lookup-not-found'));
  }
});

test('stream byte limit is enforced before parsing regardless of content-length', async () => {
  const body = Readable.from([Buffer.alloc(40 * 1024, 32), Buffer.alloc(30 * 1024, 32)]);
  const hub = create({ transport: async () => ({ statusCode: 200, headers: { 'content-length': '2' }, body }) });
  await assert.rejects(query(hub), isError(502, 'food-lookup-upstream'));
  assert.equal(body.destroyed, true);
});

test('byte cap counts UTF-8 bytes; compressed responses are refused', async () => {
  for (const r of [{ statusCode: 200, body: Readable.from(['€'.repeat(24000)]) },
    { ...reply(), headers: { 'content-encoding': 'gzip' } }]) {
    await assert.rejects(query(create({ transport: async () => r })), isError(502, 'food-lookup-upstream'));
  }
});

test('total deadline includes waiting for headers and aborts the transport', async () => {
  let signal;
  const hub = create({ totalTimeoutMs: 25, transport: (url, options) => {
    signal = options.signal; return new Promise(() => {});
  } });
  await assert.rejects(query(hub), isError(504, 'food-lookup-timeout'));
  assert.equal(signal.aborted, true);
});

test('total deadline includes stalled body reads and destroys the stream', async () => {
  const body = new Readable({ read() {} }); let signal;
  const hub = create({ totalTimeoutMs: 25, transport: async (url, opts) => {
    signal = opts.signal; return { statusCode: 200, body };
  } });
  await assert.rejects(query(hub), isError(504, 'food-lookup-timeout'));
  assert.equal(signal.aborted, true); assert.equal(body.destroyed, true);
});

test('cache hits keep original fetch time and recheck consent', async () => {
  let calls = 0, now = 1000;
  const hub = create({ now: () => now, transport: async () => { calls++; return reply(); } });
  const a = await query(hub); now = 2000;
  const b = await query(hub); assert.deepEqual(a, b); assert.equal(calls, 1);
  a.label = 'MUTATED'; assert.equal((await query(hub)).label, 'Example');
  await assert.rejects(query(hub, barcode, 'user-a', false), isError(403, 'nutrition-disabled'));
  assert.equal(calls, 1);
});

test('positive and shorter negative TTL expire; cache evicts at bounded size', async () => {
  let now = 0, calls = 0;
  const hub = create({ now: () => now, cacheMax: 2, cacheTtlMs: 100, notFoundTtlMs: 10,
    userMax: 100, instanceMax: 100, transport: async url => {
      calls++; const code = new URL(url).pathname.split('/').at(-1);
      return reply(code === other ? missing : payload(code));
    } });
  await query(hub);
  await assert.rejects(query(hub, other), isError(404, 'food-lookup-not-found'));
  now = 9; await assert.rejects(query(hub, other), isError(404, 'food-lookup-not-found')); assert.equal(calls, 2);
  now = 10; await assert.rejects(query(hub, other), isError(404, 'food-lookup-not-found')); assert.equal(calls, 3);
  now = 99; await query(hub); assert.equal(calls, 3);
  now = 100; await query(hub); assert.equal(calls, 4);
  await query(hub, third);
  await assert.rejects(query(hub, other), isError(404, 'food-lookup-not-found')); assert.equal(calls, 6);
  await query(hub); assert.equal(calls, 7, 'oldest product was evicted');
});

test('upstream failures are not cached', async () => {
  let calls = 0;
  const hub = create({ transport: async () => ++calls === 1 ? reply({}, 503) : reply() });
  await assert.rejects(query(hub), isError(502, 'food-lookup-upstream'));
  assert.equal((await query(hub)).label, 'Example'); assert.equal(calls, 2);
});

test('per-user limit counts cached reads and returns bounded Retry-After, other users are independent', async () => {
  let now = 0, calls = 0;
  const hub = create({ now: () => now, transport: async () => { calls++; return reply(); } });
  for (let i = 0; i < 5; i++) await query(hub);
  await assert.rejects(query(hub), e => e.status === 429 && e.retryAfter === 60);
  await query(hub, barcode, 'user-b'); assert.equal(calls, 1);
  now = 60000; await query(hub); assert.equal(calls, 1);
});

test('instance budget is reserved before concurrent upstream calls and resets after 61 seconds', async () => {
  let now = 0, calls = 0;
  const releases = [];
  const hub = create({ now: () => now, transport: () => {
    calls++; return new Promise(resolve => releases.push(() => resolve(reply())));
  } });
  const jobs = Array.from({ length: 7 }, (_, i) => query(hub, barcode, `u${i}`));
  await assert.rejects(query(hub, barcode, 'eighth'), e => e.status === 429 && e.retryAfter === 61);
  assert.equal(calls, 7); releases.splice(0).forEach(r => r()); await Promise.all(jobs);
  now = 61000;
  const last = query(hub, other, 'ninth'); releases.splice(0).forEach(r => r());
  // The transport deliberately replies with another product; the expired bucket still let it run.
  await assert.rejects(last, isError(502, 'food-lookup-upstream')); assert.equal(calls, 8);
});

test('connection-time guarded DNS rejects private, mixed, empty, invalid and rebinding answers', async t => {
  assert.equal(typeof food.foodLookupDns, 'function', 'foodLookupDns must be implemented');
  let answers = [{ address: '8.8.8.8', family: 4 }], optionsSeen;
  t.mock.method(dns, 'lookup', (host, options, cb) => { optionsSeen = options; cb(null, answers); });
  const lookup = host => new Promise((resolve, reject) => food.foodLookupDns(host, { all: true },
    (err, result) => err ? reject(err) : resolve(result)));
  assert.deepEqual(await lookup('world.openfoodfacts.org'), answers);
  assert.equal(optionsSeen.all, true);
  for (const values of [['127.0.0.1'], ['10.0.0.1'], ['169.254.169.254'], ['::1'], ['fc00::1'],
    ['::ffff:127.0.0.1'], ['8.8.8.8', '192.168.1.1'], [], ['not-an-ip']]) {
    answers = values.map(address => ({ address, family: address.includes(':') ? 6 : 4 }));
    await assert.rejects(lookup('world.openfoodfacts.org'));
  }
  await assert.rejects(lookup('evil.test'));
});

test('push address overrides cannot open private DNS for food lookup', () => {
  assert.equal(typeof food.foodLookupDns, 'function', 'foodLookupDns must be implemented');
  const script = `import dns from 'node:dns';
    dns.lookup = (host, options, cb) => cb(null, [{ address: '127.0.0.1', family: 4 }]);
    const { foodLookupDns } = await import('./api/food-lookup.js');
    foodLookupDns('world.openfoodfacts.org', { all: true }, err => process.exit(err ? 0 : 9));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: new URL('../../', import.meta.url), env: { ...process.env, ALLOWED_PRIVATE_IPS: '127.0.0.1' }, encoding: 'utf8'
  });
  assert.equal(r.status, 0, r.stderr);
});

test('HTTPS transport has a finite DNS/TCP/TLS connect deadline and refuses other origins', async () => {
  assert.equal(typeof food.createFoodTransport, 'function', 'createFoodTransport must be implemented');
  let got, destroyed = false;
  const transport = food.createFoodTransport({ request: (url, options) => {
    got = options;
    const req = new EventEmitter();
    req.end = () => {};
    req.destroy = err => { destroyed = true; req.emit('error', err); };
    return req;
  } });
  await assert.rejects(transport('https://evil.test/x', { headers: {}, connectTimeoutMs: 20 }));
  assert.equal(got, undefined);
  await assert.rejects(transport('https://world.openfoodfacts.org/api/v3.6/product/' + barcode, {
    headers: {}, connectTimeoutMs: 20
  }), isError(504, 'food-lookup-timeout'));
  assert.equal(destroyed, true); assert.equal(got.lookup, food.foodLookupDns); assert.equal(got.agent, false);
});
