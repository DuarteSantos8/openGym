import test from 'node:test';
import assert from 'node:assert/strict';
import { candidatesFor, discoverLocal } from '../coach/core/local-discovery.js';

test('candidates: every known port per host, IPv6 bracketed, junk hosts dropped, capped', () => {
  const c = candidatesFor(['192.168.1.5', '::1', 'bad host/x', '192.168.1.5']);
  assert.deepEqual(c.map(x => x.base), [
    'http://192.168.1.5:11434/v1', 'http://192.168.1.5:1234/v1', 'http://192.168.1.5:8080/v1',
    'http://[::1]:11434/v1', 'http://[::1]:1234/v1', 'http://[::1]:8080/v1'
  ]);
  assert.equal(candidatesFor(Array.from({ length: 20 }, (_, i) => `10.0.0.${i}`), 5).length, 5);
});

test('discovery keeps what answers with a model list and ignores the rest', async () => {
  const f = async url => {
    if (url.startsWith('http://a:11434')) return { ok: true, text: async () => JSON.stringify({ data: [{ id: 'qwen3:4b' }] }) };
    if (url.startsWith('http://a:1234')) return { ok: true, text: async () => '<html>router</html>' };
    if (url.startsWith('http://a:8080')) return { ok: false, text: async () => '' };
    throw new Error('refused');
  };
  const found = await discoverLocal(candidatesFor(['a', 'b']), { fetch: f });
  assert.deepEqual(found, [{ base: 'http://a:11434/v1', kind: 'Ollama', models: ['qwen3:4b'] }]);
});

test('a host that never answers is given up on at the timeout', async () => {
  const never = (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))));
  const t0 = Date.now();
  const found = await discoverLocal(candidatesFor(['slow']), { fetch: never, timeoutMs: 50 });
  assert.deepEqual(found, []);
  assert.ok(Date.now() - t0 < 1000);
});
