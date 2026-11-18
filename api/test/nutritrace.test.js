/* The NutriTrace food-library reader (integrations/providers/nutritrace.js): the form it accepts,
 * how a NutriTrace food becomes a diary food, how its answers are judged, and the hub's read path
 * end to end with a fake transport, so nothing here leaves the machine.
 *
 * NutriTrace Federation API v1, as its own source defines it (TraceApps/nutritrace @888c966,
 * server/routes/api/v1/foods.js `_toWire` and docs/federation.md, read 2026-11-13): Bearer
 * nt_pat_ + 43 base64url tokens with scopes; GET /api/v1/me answers { user, instance, scopes };
 * GET /api/v1/foods (read:foods) answers { items, total, limit, offset } with items { id, name,
 * brand, category, barcode, portion (default 100), unit (default g), img_url, notes, nutrition }.
 * `nutrition` is the stored blob: nutrient ids (`calories` kcal, `proteins`, `carbohydrates`,
 * `fat` g, …), "values are numbers per `portion`". The published docs page shows kcal, protein_g,
 * carbs_g and fat_g instead; the server never uses those, so they are only a fallback here. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { baseUrl, foodFromNutriTrace, judgeRead, nutritraceProvider, TOKEN_RE, makeJsonGet, READ_MAX } = await import('../integrations/providers/nutritrace.js');
import http from 'node:http';
const { createIntegrations } = await import('../integrations/index.js');

const TOKEN = 'nt_pat_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0U1v';
const SECRET = 'b'.repeat(64);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gym-nt-'));

test('the form: an https address (home network only when the admin allows it) and a NutriTrace token', () => {
  assert.ok(TOKEN_RE.test(TOKEN));
  const p = nutritraceProvider();
  const made = p.connect({ url: 'https://nt.example.com/', token: TOKEN });
  assert.deepEqual(made.secrets, { base: 'https://nt.example.com', token: TOKEN });
  assert.deepEqual(made.events, []);
  assert.deepEqual(made.info, { host: 'nt.example.com' });
  assert.equal(made.label, 'nt.example.com');
  assert.ok(!JSON.stringify(made.info).includes('nt_pat_'), 'the token is never in what the app sees');
  assert.throws(() => p.connect({ url: 'http://nt.example.com', token: TOKEN }), /https/);
  assert.throws(() => p.connect({ url: 'https://192.168.1.20', token: TOKEN }), /private/);
  assert.throws(() => p.connect({ url: 'https://nt.example.com', token: 'sk-not-a-nutritrace-token' }), /token/);
  assert.throws(() => p.connect({ url: 'https://nt.example.com', token: '' }), /token/);
  const lan = nutritraceProvider({ allowLan: true });
  assert.equal(lan.connect({ url: 'http://192.168.1.20:3000', token: TOKEN }).secrets.base, 'http://192.168.1.20:3000');
})

test('the address is cut back to the instance: no query, no fragment, no pasted /api/v1', () => {
  assert.equal(baseUrl('https://nt.example.com/api/v1/'), 'https://nt.example.com');
  assert.equal(baseUrl('https://example.com/nutritrace/?x=1#y'), 'https://example.com/nutritrace');
  assert.equal(baseUrl('not a url'), null);
})

test('a NutriTrace food becomes a diary food: per 100 from its portion in g or mL, nothing guessed otherwise', () => {
  assert.deepEqual(foodFromNutriTrace({
    id: 42, name: 'Overnight oats', brand: 'Home', barcode: '', portion: 250, unit: 'g',
    img_url: '/uploads/x.jpg', notes: 'private note',
    nutrition: { calories: 400, proteins: 20, carbohydrates: 55, fat: 10, sodium: 300 },
  }), {
    id: '42', name: 'Overnight oats', brand: 'Home', barcode: null, portion: 250, unit: 'g', basis: '100g',
    per100: { kcal: 160, proteinG: 8, carbohydrateG: 22, fatG: 4 },
    perPortion: { kcal: 400, proteinG: 20, carbohydrateG: 55, fatG: 10 },
  });
  const milk = foodFromNutriTrace({ id: 'm', name: 'Milk', portion: 200, unit: 'mL', nutrition: { calories: 128, proteins: 6.8, fat: 7 } });
  assert.equal(milk.basis, '100ml');
  assert.deepEqual(milk.per100, { kcal: 64, proteinG: 3.4, carbohydrateG: null, fatG: 3.5 });
  // A cup has no weight without a density: the food is listed, but cannot go into a g/mL diary.
  const cup = foodFromNutriTrace({ id: 'c', name: 'Rice', portion: 1, unit: 'cup', nutrition: { calories: 205, proteins: 4.3, carbohydrates: 45, fat: 0.4 } });
  assert.equal(cup.basis, null);
  assert.equal(cup.per100, null);
  assert.equal(cup.perPortion.kcal, 205);
  assert.equal(foodFromNutriTrace({ id: 'z', name: 'Zero portion', portion: 0, unit: 'g', nutrition: { calories: 1 } }).per100, null);
  assert.equal(foodFromNutriTrace({ name: 'no id' }), null);
  assert.equal(foodFromNutriTrace(null), null);
  assert.equal('img_url' in foodFromNutriTrace({ id: 1, name: 'a', img_url: 'x' }), false);
  assert.equal('notes' in foodFromNutriTrace({ id: 1, name: 'a', notes: 'x' }), false);
})

test('the example food from NutriTrace\'s own docs/federation.md reads as its label', () => {
  const skyr = foodFromNutriTrace({
    id: 412, name: 'Icelandic Skyr, Plain', brand: "Siggi's", category: 'Dairy', barcode: '0098463900008',
    portion: 100.0, unit: 'g', img_url: 'https://nutritrace.example.com/uploads/abc123.jpg', notes: '1 cup ≈ 245g cooked',
    nutrition: { calories: 59, fat: 0.2, 'saturated-fat': 0.1, carbohydrates: 4.0, sugars: 4.0, fiber: 0, proteins: 11.0, sodium: 65, calcium: 150 },
    created_at: '2026-04-12T18:32:11.000Z', updated_at: '2026-05-01T09:14:00.000Z',
  });
  assert.deepEqual(skyr.per100, { kcal: 59, proteinG: 11, carbohydrateG: 4, fatG: 0.2 });
  assert.equal(skyr.barcode, '0098463900008');
  assert.equal(skyr.basis, '100g');
})

test('the names on the published docs page are still read, when the real ones are absent', () => {
  const f = foodFromNutriTrace({ id: 1, name: 'Old', portion: 50, unit: 'g', nutrition: { kcal: 100, protein_g: 5, carbs_g: 10, fat_g: 2 } });
  assert.deepEqual(f.per100, { kcal: 200, proteinG: 10, carbohydrateG: 20, fatG: 4 });
  // The server's own name wins over the other when both are there.
  assert.equal(foodFromNutriTrace({ id: 2, name: 'Both', portion: 100, unit: 'g', nutrition: { calories: 80, kcal: 999 } }).per100.kcal, 80);
  // NutriTrace defaults: no portion means 100, no unit means g (_toWire).
  assert.equal(foodFromNutriTrace({ id: 3, name: 'Defaults', nutrition: { calories: 42 } }).per100.kcal, 42);
})

test('answers are judged in words the app can show, never with the token in them', () => {
  assert.equal(judgeRead({ status: 200 }).ok, true);
  assert.match(judgeRead({ status: 401 }).msg, /refused the token/);
  assert.equal(judgeRead({ status: 401 }).code, 'auth');
  assert.match(judgeRead({ status: 403 }).msg, /read:foods/);
  assert.equal(judgeRead({ status: 429, headers: { 'retry-after': '7' } }).retryAfter, 7);
  assert.equal(judgeRead({ status: 503 }).code, 'busy');
  assert.equal(judgeRead({ status: 302 }).code, 'redirect');
  assert.equal(judgeRead(null, Object.assign(new Error('x'), { code: 'ETIMEDOUT' })).code, 'timeout');
  assert.equal(judgeRead(null, Object.assign(new Error('x'), { code: 'EBLOCKED' })).code, 'blocked');
})

function hubWith(answer) {
  const calls = [];
  const get = async (url, req) => { calls.push({ url, ...req }); const a = answer(url); if (a instanceof Error) throw a; return a; };
  const dataDir = tmp();
  const hub = createIntegrations({ dataDir, secret: SECRET, env: { INTEGRATIONS: 'webhook,nutritrace' }, getJson: get });
  return { hub, calls, dataDir };
}
const ok = body => ({ status: 200, headers: {}, body: JSON.stringify(body) });

test('the hub: connect seals the token, check connection asks /me for read:foods, a search reads /foods', async () => {
  const { hub, calls, dataDir } = hubWith(url => url.includes('/api/v1/me')
    ? ok({ user: { id: 1 }, instance: { version: '1.0.0' }, scopes: ['read:foods'] })
    : ok({ items: [{ id: 7, name: 'Skyr', brand: 'Arla', portion: 150, unit: 'g', nutrition: { calories: 95, proteins: 16.5, carbohydrates: 6, fat: 0.3 } }, { nope: true }], total: 1, limit: 25, offset: 0 }));
  assert.deepEqual(hub.publicConfig().providers, ['webhook', 'nutritrace']);
  const { connection } = hub.connect('u1', 'nutritrace', { url: 'https://nt.example.com', token: TOKEN });
  assert.equal(connection.provider, 'nutritrace');
  // Sealed on disk: the token is nowhere in the files.
  const onDisk = fs.readdirSync(path.join(dataDir, 'integrations'), { recursive: true })
    .map(f => path.join(dataDir, 'integrations', String(f))).filter(f => fs.statSync(f).isFile()).map(f => fs.readFileSync(f, 'utf8')).join('');
  assert.ok(!onDisk.includes('nt_pat_'), 'token sealed at rest');

  const checked = await hub.test('u1', connection.id);
  assert.equal(checked.ok, true);
  assert.equal(calls[0].url, 'https://nt.example.com/api/v1/me');
  assert.equal(calls[0].headers.Authorization, 'Bearer ' + TOKEN);

  const found = await hub.query('u1', 'nutritrace', 'foods', { q: ' skyr ' });
  assert.equal(calls[1].url, 'https://nt.example.com/api/v1/foods?q=skyr&limit=25');
  assert.deepEqual(found.foods.map(f => f.name), ['Skyr']);
  assert.deepEqual(found.foods[0].per100, { kcal: 63, proteinG: 11, carbohydrateG: 4, fatG: 0.2 });
  // Another profile has no connection and reads nothing.
  await assert.rejects(hub.query('u2', 'nutritrace', 'foods', { q: 'x' }), e => e.status === 404);
  // A second NutriTrace for one profile is refused: one library per profile.
  assert.throws(() => hub.connect('u1', 'nutritrace', { url: 'https://other.example.com', token: TOKEN }), e => e.status === 409);
})

test('the hub: a missing scope fails the check; a refused token marks the connection for attention', async () => {
  let me = { scopes: ['write:workouts'] }, foods = { status: 401, headers: {}, body: '{"code":"auth_invalid"}' };
  const { hub } = hubWith(url => (url.includes('/me') ? ok(me) : foods));
  const { connection } = hub.connect('u1', 'nutritrace', { url: 'https://nt.example.com', token: TOKEN });
  const checked = await hub.test('u1', connection.id);
  assert.equal(checked.ok, false);
  assert.match(checked.msg, /read:foods/);
  await assert.rejects(hub.query('u1', 'nutritrace', 'foods', { q: 'a' }), e => e.status === 502 && /refused the token/.test(e.message));
  assert.equal(hub.describe('u1').connections[0].status, 'attention');
})

test('the hub: a search is bounded (query length, answer size, unparseable answers) and rate-limited per profile', async () => {
  const { hub, calls } = hubWith(() => ({ status: 200, headers: {}, body: 'not json' }));
  hub.connect('u1', 'nutritrace', { url: 'https://nt.example.com', token: TOKEN });
  await assert.rejects(hub.query('u1', 'nutritrace', 'foods', { q: 'a' }), e => e.status === 502);
  await hub.query('u1', 'nutritrace', 'foods', { q: 'x'.repeat(500) }).catch(() => {});
  assert.equal(new URL(calls.at(-1).url).searchParams.get('q').length, 80);
  await assert.rejects(hub.query('u1', 'nutritrace', 'nope', {}), e => e.status === 400);
  let limited = null;
  for (let i = 0; i < 40 && !limited; i++) await hub.query('u1', 'nutritrace', 'foods', { q: 'a' }).catch(e => { if (e.status === 429) limited = e; });
  assert.ok(limited, 'a profile cannot hammer its NutriTrace through openGym');
})

test('integrations off: no reader, and the webhook alone still works as before', async () => {
  const off = createIntegrations({ dataDir: tmp(), secret: SECRET, env: {} });
  await assert.rejects(off.query('u1', 'nutritrace', 'foods', {}), e => e.status === 404);
  const webhookOnly = createIntegrations({ dataDir: tmp(), secret: SECRET, env: { INTEGRATIONS: 'webhook' } });
  assert.deepEqual(webhookOnly.publicConfig().providers, ['webhook']);
  await assert.rejects(webhookOnly.query('u1', 'nutritrace', 'foods', {}), e => e.status === 404);
})

test('the real transport: reads the body, stops at READ_MAX, and does not follow a redirect', async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/big') { res.writeHead(200); res.end('x'.repeat(READ_MAX + 10)); return; }
    if (req.url === '/moved') { res.writeHead(302, { Location: 'http://169.254.169.254/' }); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ auth: req.headers.authorization, path: req.url }));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    // A literal address skips the guarded lookup; outboundUrlError refuses loopback before this in
    // real use (call()), so this exercises only the transport.
    const get = makeJsonGet({ allowLan: false });
    const r = await get(base + '/api/v1/me', { headers: { Authorization: 'Bearer t' } });
    assert.equal(r.status, 200);
    assert.deepEqual(JSON.parse(r.body), { auth: 'Bearer t', path: '/api/v1/me' });
    await assert.rejects(get(base + '/big', { headers: {} }), e => e.code === 'ETOOBIG');
    const moved = await get(base + '/moved', { headers: {} });
    assert.equal(moved.status, 302, 'the redirect is answered, not followed');
    assert.equal(judgeRead(moved).code, 'redirect');
  } finally { server.close(); }
})

test('in real use a loopback, link-local or private NutriTrace address is refused before any request', async () => {
  let sent = 0;
  const p = nutritraceProvider({ get: async () => { sent++; return { status: 200, headers: {}, body: '{}' }; } });
  for (const url of ['http://127.0.0.1:3000', 'https://169.254.169.254', 'https://10.0.0.5', 'https://localhost']) {
    assert.throws(() => p.connect({ url, token: TOKEN }), /url|private|https|server/, url);
  }
  // A sealed address that fails the rules later (the admin turned the home network off) is not called.
  const out = await p.query('foods', { q: 'a' }, name => (name === 'base' ? 'http://192.168.1.20' : TOKEN));
  assert.equal(out.error.code, 'blocked');
  assert.equal(sent, 0);
})
