import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestNutrition } from '../nutrition.js';

test('MCP Nutrition gateway preserves service errors and distinguishes uncertain writes from reads', async t => {
  const calls = [];
  let response = () => new Response('{"products":[]}', { status: 200 });
  t.mock.method(globalThis, 'fetch', async (url, options) => { calls.push({ url, options }); return response(); });
  assert.deepEqual(await requestNutrition('GET', '/api/nutrition/products', { search: 'rice', offset: 50, userId: 'other' }, undefined, 'ogn.internal'), { products: [] });
  assert.equal(calls[0].url.pathname + calls[0].url.search, '/api/nutrition/products?search=rice&offset=50');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer ogn.internal');
  assert.equal(calls[0].options.headers.Cookie, undefined);
  assert.equal(calls[0].options.redirect, 'error');
  const payload = { id: 'stable-id', quantityGrams: 200 };
  for (const [status, code] of [[409, 'idempotency_conflict'], [410, 'entry_deleted'], [404, 'not_found'], [401, 'unauthorized']]) {
    response = () => new Response(JSON.stringify({ code }), { status });
    await assert.rejects(requestNutrition('POST', '/api/nutrition/entries', {}, payload, 'ogn.internal'), error => {
      assert.equal(error.status, status);
      assert.equal(error.code, code);
      assert.equal(error.uncertain, undefined);
      return true;
    });
    assert.deepEqual(JSON.parse(calls.at(-1).options.body), payload);
  }
  for (const reply of [() => new Response('{}', { status: 503 }), () => new Response('<html>', { status: 200 }),
    () => new Response('[]', { status: 200 }), () => new Response('{}', { status: 302 }),
    () => { throw new TypeError('fetch failed'); }]) {
    response = reply;
    for (const method of ['GET', 'POST']) {
      await assert.rejects(requestNutrition(method, method === 'GET' ? '/api/nutrition/diary' : '/api/nutrition/entries', {},
        method === 'GET' ? undefined : payload, 'ogn.internal'), error => {
        assert.equal(error.code, 'nutrition_unavailable');
        assert.equal(error.status, 503);
        assert.equal(error.uncertain, method !== 'GET');
        return true;
      });
    }
  }
  const before = calls.length;
  await assert.rejects(requestNutrition('GET', 'https://evil.example/private'), /Unsupported Nutrition operation/);
  assert.equal(calls.length, before);
});
