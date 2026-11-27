/* NutriTrace reader hardening: what a broken, hostile or surprising NutriTrace answer can and cannot
 * do, the per-profile limits, the answer-size boundary and the address rules. Fakes and a local
 * socket only; nothing leaves the machine. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const { foodFromNutriTrace, judgeRead, nutritraceProvider, makeJsonGet, READ_MAX, TRANSIENT } = await import('../integrations/providers/nutritrace.js');
const { createIntegrations } = await import('../integrations/index.js');

const TOKEN = 'nt_pat_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0U1v';
const SECRET = 'b'.repeat(64);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gym-nth-'));
const ok = body => ({ status: 200, headers: {}, body: typeof body === 'string' ? body : JSON.stringify(body) });
const reveal = base => name => (name === 'base' ? base : TOKEN);

/* ---------- malformed answers ---------- */

test('an answer that is not a food list reads as no foods, never as an error that leaks or a crash', async () => {
  for (const body of ['null', '[]', '{}', '{"items":"x"}', '{"items":{"0":{}}}', '{"items":null,"total":"9"}', '42', '"str"']) {
    const p = nutritraceProvider({ get: async () => ok(body) });
    const out = await p.query('foods', { q: 'a' }, reveal('https://nt.example.com'));
    assert.deepEqual(out.foods, [], body);
    assert.equal(typeof out.total, 'number', body);
  }
  const html = nutritraceProvider({ get: async () => ok('<!doctype html><title>Login</title>') });
  assert.equal((await html.query('foods', { q: 'a' }, reveal('https://nt.example.com'))).error.code, 'parse');
})

test('items that are not foods are dropped; ids must be plain strings or numbers', () => {
  for (const item of [null, 1, 'x', [], true, {}, { name: 'no id' }, { id: 1 }, { id: 1, name: '   ' }, { id: {}, name: 'obj id' }, { id: [1], name: 'arr id' }, { id: true, name: 'bool id' }, { id: '', name: 'empty id' }]) {
    assert.equal(foodFromNutriTrace(item), null, JSON.stringify(item));
  }
  assert.equal(foodFromNutriTrace({ id: 'abc', name: 'ok' }).id, 'abc');
  assert.equal(foodFromNutriTrace({ id: 7, name: 'ok' }).id, '7');
})

test('names lose control characters and are cut; nutrition that is not an object counts as none', () => {
  const f = foodFromNutriTrace({ id: 1, name: 'Skyr\u0000\u0007\n\u001b[31m' + 'x'.repeat(10000), brand: 'Arla\r\n\u0000', portion: 100, unit: 'g', nutrition: ['calories', 59] });
  assert.ok(!/[\u0000-\u001f\u007f]/.test(f.name), 'no control characters in the name');
  assert.ok(f.name.startsWith('Skyr'));
  assert.ok(f.name.length <= 80);
  assert.equal(f.brand, 'Arla');
  assert.deepEqual(f.perPortion, { kcal: null, proteinG: null, carbohydrateG: null, fatG: null });
  assert.deepEqual(foodFromNutriTrace({ id: 1, name: 'a', nutrition: 'calories=59' }).perPortion.kcal, null);
})

test('negative, non-numeric and non-finite nutrient values are dropped, never turned into numbers', () => {
  const f = foodFromNutriTrace({ id: 1, name: 'a', portion: 100, unit: 'g', nutrition: { calories: -5, proteins: 'NaN', carbohydrates: Infinity, fat: '1e999' } });
  assert.deepEqual(f.per100, { kcal: null, proteinG: null, carbohydrateG: null, fatG: null });
})

test('a portion that is negative, zero, text or not finite gives no per-100 values', () => {
  for (const portion of [-100, 0, 'lots', '1e999', Infinity, null === 1]) {
    assert.equal(foodFromNutriTrace({ id: 1, name: 'a', portion, unit: 'g', nutrition: { calories: 100 } }).per100, null, String(portion));
  }
})

test('values no food can have are refused as a whole (not clipped), with a reason the app can show', () => {
  // 50 kcal in a 1 g portion is 5000 kcal per 100 g: a typo or a unit mix-up in NutriTrace.
  const kcal = foodFromNutriTrace({ id: 1, name: 'Typo', portion: 1, unit: 'g', nutrition: { calories: 50, proteins: 0.1 } });
  assert.equal(kcal.per100, null);
  assert.equal(kcal.basis, null);
  assert.equal(kcal.problem, 'implausible');
  assert.equal(kcal.perPortion.kcal, 50, 'what NutriTrace said is still shown as it said it');
  const protein = foodFromNutriTrace({ id: 2, name: 'Typo', portion: 10, unit: 'g', nutrition: { calories: 40, proteins: 11 } });
  assert.equal(protein.problem, 'implausible');
  // Huge numbers that would overflow to Infinity (and serialise as null) are refused the same way.
  assert.equal(foodFromNutriTrace({ id: 3, name: 'Huge', portion: 1e-300, unit: 'g', nutrition: { calories: 1e300 } }).problem, 'implausible');
  // At the limits exactly: allowed.
  const edge = foodFromNutriTrace({ id: 4, name: 'Oil', portion: 100, unit: 'ml', nutrition: { calories: 900, fat: 100 } });
  assert.equal(edge.problem, undefined);
  assert.deepEqual(edge.per100, { kcal: 900, proteinG: null, carbohydrateG: null, fatG: 100 });
})

test('units: g and ml in any case and spelling convert; anything without a weight does not', () => {
  for (const [unit, basis] of [['g', '100g'], ['G', '100g'], ['grams', '100g'], ['Gram', '100g'], ['ml', '100ml'], ['ML', '100ml'], ['mL', '100ml'], ['millilitres', '100ml']]) {
    assert.equal(foodFromNutriTrace({ id: 1, name: 'a', portion: 50, unit, nutrition: { calories: 10 } }).basis, basis, unit);
  }
  for (const unit of ['cup', 'tbsp', 'oz', 'lb', 'piece', 'serving', 'slice (big)', '']) {
    const f = foodFromNutriTrace({ id: 1, name: 'a', portion: 1, unit, nutrition: { calories: 1 } });
    if (unit === '') { assert.equal(f.basis, '100g', 'NutriTrace defaults a missing unit to g'); continue; }
    assert.equal(f.per100, null, unit);
  }
})

/* ---------- auth versus connectivity ---------- */

test('NutriTrace\'s own refusals map to auth and scope; network trouble maps to transient codes', () => {
  assert.equal(judgeRead({ status: 401, headers: {} }).code, 'auth');   // auth_missing and auth_invalid both
  assert.equal(judgeRead({ status: 403, headers: {} }).code, 'scope');  // auth_scope
  for (const code of ['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET']) {
    assert.ok(TRANSIENT.has(judgeRead(null, Object.assign(new Error('x'), { code })).code), code);
  }
  for (const c of ['auth', 'scope', 'blocked', 'tls', 'redirect', 'parse', 'too-big', 'sealed']) assert.equal(TRANSIENT.has(c), false, c);
})

test('check connection: a network failure is not final, a token failure is', async () => {
  const err = code => async () => { throw Object.assign(new Error('x'), { code }); };
  const p1 = nutritraceProvider({ get: err('ECONNREFUSED') });
  assert.equal((await p1.deliver({}, reveal('https://nt.example.com'))).retry, true);
  const p2 = nutritraceProvider({ get: async () => ({ status: 401, headers: {}, body: '{"code":"auth_invalid"}' }) });
  assert.equal((await p2.deliver({}, reveal('https://nt.example.com'))).retry, false);
  const p3 = nutritraceProvider({ get: async () => ok({ scopes: [] }) });
  assert.equal((await p3.deliver({}, reveal('https://nt.example.com'))).retry, false);
})

test('the hub: a failed search for network reasons leaves the connection as it was', async () => {
  const hub = createIntegrations({ dataDir: tmp(), secret: SECRET, env: { INTEGRATIONS: 'nutritrace' }, getJson: async () => { throw Object.assign(new Error('x'), { code: 'ETIMEDOUT' }); } });
  hub.connect('u1', 'nutritrace', { url: 'https://nt.example.com', token: TOKEN });
  await assert.rejects(hub.query('u1', 'nutritrace', 'foods', { q: 'a' }), e => e.status === 502 && e.code === 'timeout');
  const c = hub.describe('u1').connections[0];
  assert.equal(c.status, 'connected');
  await hub.test('u1', c.id);
  assert.equal(hub.describe('u1').connections[0].status, 'connected', 'a timeout on check is not a broken connection');
})

/* ---------- limits ---------- */

test('one profile using up its searches does not slow another profile down', async () => {
  const hub = createIntegrations({ dataDir: tmp(), secret: SECRET, env: { INTEGRATIONS: 'nutritrace' }, getJson: async () => ok({ items: [], total: 0 }) });
  hub.connect('u1', 'nutritrace', { url: 'https://nt.example.com', token: TOKEN });
  hub.connect('u2', 'nutritrace', { url: 'https://nt.example.com', token: TOKEN });
  let limited = 0;
  for (let i = 0; i < 40; i++) await hub.query('u1', 'nutritrace', 'foods', { q: 'a' }).catch(e => { if (e.status === 429) limited++; });
  assert.ok(limited >= 10, 'u1 is limited after 30');
  assert.deepEqual((await hub.query('u2', 'nutritrace', 'foods', { q: 'a' })).foods, [], 'u2 is not');
})

test('the answer cap is exact: READ_MAX bytes are read, one more is refused', async () => {
  const server = http.createServer((req, res) => { res.writeHead(200); res.end('x'.repeat(req.url === '/at' ? READ_MAX : READ_MAX + 1)); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const get = makeJsonGet({ allowLan: false });
    assert.equal((await get(base + '/at', { headers: {} })).body.length, READ_MAX);
    await assert.rejects(get(base + '/over', { headers: {} }), e => e.code === 'ETOOBIG');
  } finally { server.close(); }
})

/* ---------- where it may connect ---------- */

test('connect refuses every address openGym never calls, home network or not', () => {
  const strict = nutritraceProvider();
  const lan = nutritraceProvider({ allowLan: true });
  const never = ['https://127.0.0.1', 'http://127.0.0.1:3000', 'https://[::1]', 'https://169.254.169.254/latest/meta-data', 'https://[fe80::1]', 'https://0.0.0.0', 'https://[::ffff:127.0.0.1]', 'https://localhost', 'https://nt.localhost', 'https://user:pw@nt.example.com', 'ftp://nt.example.com', 'file:///etc/passwd', 'javascript:alert(1)'];
  for (const url of never) {
    assert.throws(() => strict.connect({ url, token: TOKEN }), e => e.status === 400, 'strict ' + url);
    assert.throws(() => lan.connect({ url, token: TOKEN }), e => e.status === 400, 'lan ' + url);
  }
  for (const url of ['https://10.0.0.5', 'https://172.16.0.1', 'https://192.168.1.20', 'https://[fd00::1]', 'http://192.168.1.20', 'http://nt.example.com']) {
    assert.throws(() => strict.connect({ url, token: TOKEN }), e => e.status === 400, 'strict ' + url);
  }
  for (const url of ['http://192.168.1.20:3000', 'https://10.0.0.5', 'http://[fd00::1]']) assert.ok(lan.connect({ url, token: TOKEN }), 'lan ' + url);
})

test('a name that resolves to a private address is refused in the lookup itself (DNS rebinding)', async () => {
  // `localhost` passes no literal-address check here because the transport is called directly; the
  // guarded lookup is what refuses it, as it would a public name whose DNS answer turns private.
  const server = http.createServer((req, res) => res.end('{}'));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    for (const allowLan of [false, true]) {
      const get = makeJsonGet({ allowLan });
      await assert.rejects(get(`http://localhost:${server.address().port}/api/v1/me`, { headers: {} }), e => /BLOCKED/.test(e.code), 'allowLan ' + allowLan);
    }
  } finally { server.close(); }
})

test('a redirect is never followed, even to an address that would be allowed', async () => {
  let followed = 0;
  const p = nutritraceProvider({ get: async url => { if (url.includes('/moved')) followed++; return { status: 301, headers: { location: 'https://nt.example.com/moved' }, body: '' }; } });
  const out = await p.query('foods', { q: 'a' }, reveal('https://nt.example.com'));
  assert.equal(out.error.code, 'redirect');
  assert.equal(followed, 0);
})
