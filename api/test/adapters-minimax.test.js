import test from 'node:test';
import assert from 'node:assert/strict';
import { tempData } from './helpers.mjs';

tempData();
const minimax = (await import('../coach/core/adapters/minimax.js')).default;
const { HTTP_PROVIDERS } = await import('../coach/core/providers.js');

const answer = { choices: [{ message: { content: '{"coach_contract":1,"nochange":true,"reading":"fine"}' }, finish_reason: 'stop' }] };

test('MiniMax uses its default model and API endpoint', async () => {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    return { ok: true, status: 200, text: async () => JSON.stringify(answer) };
  };

  const result = await minimax.invoke({ cfg: {}, prompt: 'P', env: { MINIMAX_API_KEY: 'test-key' }, fetch });

  assert.equal(result.code, 0);
  assert.equal(calls[0].url, 'https://api.minimax.io/v1/chat/completions');
  assert.equal(calls[0].headers.authorization, 'Bearer test-key');
  assert.equal(calls[0].body.model, HTTP_PROVIDERS.minimax.defaultModel);
  assert.ok('max_tokens' in calls[0].body);
  assert.ok(!('max_completion_tokens' in calls[0].body));
});
