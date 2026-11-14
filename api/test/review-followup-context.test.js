import test from 'node:test';
import assert from 'node:assert/strict';
import { tempData, sampleState } from './helpers.mjs';

tempData();
const { build, CONVERSATION_CHARS, CONVERSATION_LINES } = await import('../coach/core/payload.js');
const { buildPromptParts } = await import('../coach/core/prompt.js');

test('a review follow-up keeps the suggested replacement after a long training summary', () => {
  const recommendation = 'For the exercise you want to replace, consider cable curls instead.';
  const reading = 'Your logged sessions show steady progress. '.repeat(8) + recommendation;
  assert.ok(reading.indexOf(recommendation) > 240, 'the old cut lost the recommendation');
  const note = 'Replace it with what you suggested.';
  const state = sampleState();
  state.coach = { chat: [
    { role: 'coach', kind: 'nochange', text: reading },
    { role: 'user', kind: 'text', text: note }
  ] };
  const payload = build(state, { handle: 'h'.repeat(16), kind: 'review', note });
  const { user } = buildPromptParts('review', payload);
  assert.equal(payload.userNote, note);
  assert.deepEqual(payload.conversation, [{ who: 'coach', text: reading }]);
  assert.ok(user.includes(recommendation), 'the model must receive the alternative the user refers to');
});

test('long conversations remain bounded and exclude proposal and error payloads', () => {
  const state = sampleState();
  state.coach = { chat: Array.from({ length: 20 }, (_, i) => ({
    role: i % 2 ? 'coach' : 'user', kind: i % 2 ? 'nochange' : 'text',
    text: `${i}:` + 'x'.repeat(CONVERSATION_CHARS + 500), privateField: 'not coaching context'
  })).concat([
    { role: 'coach', kind: 'proposal', text: 'proposal details' },
    { role: 'coach', kind: 'error', text: 'provider error details' }
  ]) };
  const payload = build(state, { handle: 'h'.repeat(16), kind: 'review', note: 'Review my training.' });
  assert.equal(payload.conversation.length, CONVERSATION_LINES);
  assert.ok(payload.conversation[0].text.startsWith('14:'));
  for (const line of payload.conversation) {
    assert.equal(line.text.length, CONVERSATION_CHARS);
    assert.deepEqual(Object.keys(line).sort(), ['text', 'who']);
  }
  assert.ok(!JSON.stringify(payload.conversation).includes('details'));
});
