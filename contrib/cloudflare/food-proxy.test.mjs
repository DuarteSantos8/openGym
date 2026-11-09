// node --test contrib/cloudflare/food-proxy.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleFood, getJson } from './food-proxy.js';

const ok = body => new Response(JSON.stringify(body), { status: 200 });
const req = path => new Request('https://gym.example' + path);

test('retries a 503 once, then gives up on a second', async () => {
  let n = 0;
  assert.deepEqual(await getJson('u', async () => (++n === 1 ? new Response('', { status: 503 }) : ok({ a: 1 }))), { a: 1 });
  n = 0;
  await assert.rejects(getJson('u', async () => { n++; return new Response('', { status: 500 }); }));
  assert.equal(n, 2);
});

test('product: found, unknown, and upstream down', async () => {
  const p = await handleFood(req('/api/food/product/8710400002970'), null, { fetchFn: async () => ok({ status: 1, product: { product_name: 'Hagelslag' } }), cache: null });
  assert.equal(p.status, 200);
  assert.equal((await p.json()).product.code, '8710400002970');
  const none = await handleFood(req('/api/food/product/12345678'), null, { fetchFn: async () => ok({ status: 0 }), cache: null });
  assert.equal(none.status, 404);
  const down = await handleFood(req('/api/food/product/12345678'), null, { fetchFn: async () => { throw new Error('x'); }, cache: null });
  assert.equal(down.status, 502);
});

test('search falls back to the classic backend, Dutch first', async () => {
  const asked = [];
  const res = await handleFood(req('/api/food/search?q=kwark'), null, { cache: null, fetchFn: async url => {
    asked.push(new URL(url).hostname);
    if (url.includes('search.openfoodfacts.org')) throw new Error('down');
    return ok({ products: [{ product_name: 'Kwark' }] });
  } });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).products.length, 1);
  assert.ok(asked.includes('world.openfoodfacts.org'));
});
