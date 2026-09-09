/* The server-side fetch must outlast undici's default 300-second headers timeout, or a local
 * model that needs six minutes fails as "could not reach" at five — which is exactly how the
 * first staging run died. Asserted with a server that answers slower than a short dispatcher
 * allows: undici's own limit fires, ours does not. */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fetch as undiciFetch, Agent } from 'undici';

const { fetchFor, dispatcherFor } = await import('../coach/node-fetch.js');

function slowServer(delayMs) {
  const server = http.createServer((req, res) => setTimeout(() => { res.setHeader('content-type', 'application/json'); res.end('{"ok":true}'); }, delayMs));
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ url: `http://127.0.0.1:${server.address().port}/`, close: () => server.close() })));
}

test('the job fetch waits as long as the job timeout, where a short-headers dispatcher gives up', async () => {
  const s = await slowServer(2500);
  try {
    // A dispatcher with a 300 ms headers timeout is "undici's default, only smaller" — its timers
    // are second-granular, hence the 2.5 s server. The transport error is what the adapter
    // reports as "could not reach", which is the message the staging run died with.
    await assert.rejects(undiciFetch(s.url, { dispatcher: new Agent({ headersTimeout: 300, bodyTimeout: 300 }) }), /fetch failed/);
    const r = await fetchFor(60000)(s.url);
    assert.equal((await r.json()).ok, true);
  } finally { s.close(); }
});

test('the dispatcher budget follows the job timeout and never drops below a minute plus grace', () => {
  assert.ok(dispatcherFor(25 * 60000)._coachBudget >= 25 * 60000);
  assert.ok(dispatcherFor(1000)._coachBudget >= 60000);
  assert.equal(dispatcherFor(300000), dispatcherFor(300000), 'one agent per budget, not one per call');
});

test('an AbortController still wins over the transport budget', async () => {
  const s = await slowServer(1500);
  try {
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), 100);
    await assert.rejects(fetchFor(60000)(s.url, { signal: ctl.signal }), e => e.name === 'AbortError');
  } finally { s.close(); }
});
