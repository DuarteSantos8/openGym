import test from 'node:test';
import assert from 'node:assert/strict';
import { tempData } from './helpers.mjs';

tempData();
process.env.COACH_CHATGPT_PLAN = 'on';
const cfgStore = await import('../coach/config.js');
const { default: adapter } = await import('../coach/adapters/chatgpt.js');

test('ChatGPT requests keep their deadline and caller cancellation while reading the body', async () => {
  cfgStore.reset();
  cfgStore.saveAuth('chatgpt', {
    type: 'oauth', account: 'a@b.c', connectedAt: new Date().toISOString(),
    data: cfgStore.encrypt({ token: 'access', exp: Date.now() + 3600000 })
  });

  function delayedResponse(signal, body, onStart = () => {}) {
    return new Response(new ReadableStream({
      start(stream) {
        const timer = setTimeout(() => {
          stream.enqueue(new TextEncoder().encode(body));
          stream.close();
        }, 80);
        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          stream.error(signal.reason);
        }, { once: true });
        onStart();
      }
    }));
  }

  const responseBody = 'data: {"type":"response.completed"}\n\n';
  const timedOut = await adapter.invoke({
    prompt: 'hi', model: 'gpt-x', timeoutMs: 10,
    fetch: async (url, { signal }) => delayedResponse(signal, responseBody)
  });
  assert.equal(timedOut.timedOut, true);

  const caller = new AbortController();
  const cancelled = await adapter.invoke({
    prompt: 'hi', model: 'gpt-x', signal: caller.signal,
    fetch: async (url, { signal }) => delayedResponse(signal, responseBody, () => queueMicrotask(() => caller.abort()))
  });
  assert.equal(cancelled.code, 1);
  assert.equal(cancelled.timedOut, false);
  assert.match(cancelled.stderr, /cancelled/);

  const models = await adapter.models(null, null, {
    timeoutMs: 10,
    fetch: async (url, { signal }) => delayedResponse(signal, '{"data":[{"id":"gpt-x"}]}')
  });
  assert.deepEqual(models, { ok: false, error: 'timed out', models: [] });

  let fetched = false;
  const preCancelled = await adapter.invoke({
    prompt: 'hi', model: 'gpt-x', signal: caller.signal,
    fetch: async () => { fetched = true; return new Response(responseBody); }
  });
  assert.equal(fetched, false);
  assert.match(preCancelled.stderr, /cancelled/);
});
