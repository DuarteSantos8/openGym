import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-warmup-'));
process.env.DATA_DIR = DIR;
fs.writeFileSync(path.join(DIR, 'secret'), 'x'.repeat(64));

const cfgStore = await import('../coach/config.js');
const { warmOnce } = await import('../coach/warmup.js');
const { buildPromptParts } = await import('../coach/core/prompt.js');

test('warmup pings the compatible endpoint once per chat kind, with the real rules prefix', async t => {
  cfgStore.reset();
  cfgStore.save({ enabled: true, provider: 'compatible', models: { compatible: 'm1' }, providerOptions: { compatible: { baseUrl: 'http://ollama.test:11434' } } });
  const seen = [];
  const fakeFetch = async (url, init) => {
    seen.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"coach_contract":1}' }, finish_reason: 'stop' }] }), { status: 200 });
  };
  const quiet = { log: () => {} };
  t.after(() => cfgStore.reset());

  const r = await warmOnce({ log: quiet, fetch: fakeFetch });
  assert.equal(r.ok, true);
  assert.equal(seen.length, 2);
  const reviewPrefix = buildPromptParts('review', {}).system;
  assert.ok(seen[1].messages[0].content.endsWith(reviewPrefix), 'review is warmed LAST, so the single live slot ends up holding it');
  assert.ok(seen[0].messages[0].content.endsWith(buildPromptParts('debrief', {}).system));
  assert.equal(seen[0].model, 'm1');

  cfgStore.save({ provider: 'anthropic' });
  assert.equal((await warmOnce({ log: quiet, fetch: fakeFetch })).skipped, true, 'cloud providers are never pinged');
});
