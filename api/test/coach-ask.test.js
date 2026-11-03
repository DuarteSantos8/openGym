/* A question in the Coach's chat (the `ask` job): answered in words, with the recent sessions,
 * and the session running on the phone. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { tempData } from './helpers.mjs';

tempData();
const payloadLib = await import('../coach/core/payload.js');
const { runPipeline } = await import('../coach/core/pipeline.js');
const { buildPromptParts } = await import('../coach/core/prompt.js');
const { validateAsk } = await import('../coach/core/validate.js');
const { SCHEMAS } = await import('../coach/core/schemas.js');

const set = (w, r, done = true) => ({ w, r, done });
const S = {
  unit: 'kg', lang: 'it',
  routines: [{ id: 'legs', name: 'Legs', ex: [{ id: '0001', sets: 3, reps: 8 }] }],
  week: { 2: ['legs'] },
  workouts: [{
    id: 'w1', d: '2026-10-06', name: 'Legs', start: 1, end: 3600001, routineIds: ['legs'],
    entries: [
      { id: '0001', rid: 'legs', sets: [set(100, 8), set(100, 8), set(100, 7)] },
      { id: '0002', rid: 'legs', sets: [set(40, 12), set(40, 12)] }
    ]
  }],
  bodyweight: [{ d: '2026-10-01', w: 80, t: 1 }],
  coach: { consent: { agreedAt: 1 }, chat: [{ role: 'user', kind: 'text', text: 'ciao' }, { role: 'coach', kind: 'text', text: 'Ciao!' }] }
};

test('ask payload: the question, the recent sessions, the chat so far', () => {
  const p = payloadLib.build(S, { handle: 'h'.repeat(16), kind: 'ask', note: 'Quanto recupero tra le serie?' });
  assert.equal(p.task, 'ask');
  assert.equal(p.question, 'Quanto recupero tra le serie?');
  assert.deepEqual(p.window.workouts[0].entries.map(e => e.id), ['0001', '0002']);
  assert.deepEqual(p.conversation.map(c => c.who), ['user', 'coach']);
  assert.equal(p.library, undefined, 'an answer names no ids, so no library');
});

test('ask payload: the running session the phone sent is bounded like a logged one', () => {
  const today = {
    name: 'Legs', minutes: 40, extraKey: 'dropped',
    entries: [{ id: '0001', note: 'private', sets: Array.from({ length: 80 }, () => set(100, 5)) }, { id: '0002', sets: [set(30, 10, false)] }]
  };
  const p = payloadLib.build(S, { handle: 'h'.repeat(16), kind: 'ask', note: 'e adesso?', today });
  assert.equal(p.today.minutes, 40);
  assert.equal(p.today.entries[0].sets.length, 30);
  assert.ok(!JSON.stringify(p.today).includes('private'));
  assert.ok(!JSON.stringify(p.today).includes('dropped'));
  assert.equal(payloadLib.build(S, { handle: 'h'.repeat(16), kind: 'ask', note: 'x', today: 'nope' }).today, undefined);
});

test('validateAsk: one answer, no changes', () => {
  assert.deepEqual(validateAsk({ coach_contract: 1, answer: '  Due minuti.  ' }), { ok: true, proposal: { answer: 'Due minuti.' } });
  assert.equal(validateAsk({ coach_contract: 1, answer: '' }).ok, false);
  assert.equal(validateAsk({ coach_contract: 1, answer: 'ok', changes: [{ type: 'sets' }] }).ok, false);
  assert.ok(SCHEMAS.ask.required.includes('answer'));
});

test('ask pipeline: the ask rules and schema reach the provider, and an answer comes back', async () => {
  const calls = [];
  const adapter = { spawns: false, async invoke(req) { calls.push(req); return { code: 0, text: JSON.stringify({ coach_contract: 1, answer: 'Due o tre minuti tra le serie pesanti.' }) }; } };
  const payload = payloadLib.build(S, { handle: 'h'.repeat(16), kind: 'ask', note: 'Quanto recupero?' });
  const r = await runPipeline({ adapter, cfg: {}, kind: 'ask', payload });
  assert.equal(r.ok, true);
  assert.equal(r.result.answer, 'Due o tre minuti tra le serie pesanti.');
  assert.match(calls[0].system, /# Task: answer a question/);
  assert.equal(calls[0].schema, SCHEMAS.ask);
});
