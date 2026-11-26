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
const { LIB_BY_ID } = await import('../coach/core/library.js');

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
  // coach-146: an answer may carry actions that name exercises, so it gets a library slice,
  // what they train first.
  assert.deepEqual(p.library.slice(0, 2).map(e => e.id), ['0001', '0002']);
  assert.ok(p.library.length <= payloadLib.ASK_LIBRARY + 2);
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

// Discord, becory: weigh-ins from a smart scale through Apple Health showed on Home, and the Coach
// answered "I don't know your weight". The chat's payload had no body weight at all.
test('ask payload: the last four weeks of weigh-ins, the ones from Apple Health or Health Connect too', () => {
  const now = Date.parse('2026-11-03T12:00:00Z');
  const withHealth = {
    ...S, targetW: 75,
    bodyweight: [
      { d: '2026-09-01', w: 84, t: 1 },
      { d: '2026-10-20', w: 82.4, t: 2, ins: [{ id: 'hk1', at: '07:02', w: 82.4, t: 2, src: 'health', sid: 'HK-1' }] },
      { d: '2026-11-02', w: 81.9, t: 3, ins: [{ id: 'hk2', at: '07:10', w: 81.9, t: 3, src: 'health', sid: 'HK-2' }, { id: 'hk3', at: '20:00', w: 82.6, t: 4, src: 'health', sid: 'HK-3' }] },
    ],
  };
  const p = payloadLib.build(withHealth, { handle: 'h'.repeat(16), kind: 'ask', note: 'What do I weigh?', now });
  assert.equal(p.bodyweight.goal, 75);
  assert.deepEqual(p.bodyweight.series, [{ d: '2026-10-20', w: 82.4 }, { d: '2026-11-02', w: 81.9, n: 2 }]);
  // The prompt tells the model what it is reading.
  const parts = buildPromptParts('ask', p);
  assert.match(JSON.stringify(parts), /Apple Health or Health Connect/);
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

for (const qualifier of ['with no weights', 'without weights', 'with no equipment', 'without equipment',
  'with no equipment instead of my cable routine', 'with no bands and no weights']) {
  test(`a back workout ${qualifier}: propose floor exercises even for someone who trains with cables`, async () => {
    const question = `a back workout ${qualifier}`;
    const profile = { ...S, routines: [{ id: 'back', name: 'Back', ex: [{ id: '0007' }, { id: '3225' }] }] };
    const payload = payloadLib.build(profile, { handle: 'test', kind: 'ask', note: question });
    // A trained cable movement is deliberately offered by the stub on its first attempt.
    // The repair reply picks two real back movements performed on the floor.
    let attempts = 0;
    const adapter = { spawns: false, async invoke({ prompt }) {
      assert.ok(prompt.includes(question));
      const ids = ++attempts === 1 ? ['0007'] : ['1772', '3225'];
      return { code: 0, text: JSON.stringify({ coach_contract: 1, answer: 'Back session',
        actions: [{ type: 'workout', name: 'Back', items: ids.map(id => ({ id, sets: 2, reps: 8 })) }] }) };
    } };
    const result = await runPipeline({ adapter, cfg: {}, kind: 'ask', payload });
    assert.equal(result.ok, true);
    const ids = result.result.actions[0].items.map(item => item.id);
    assert.deepEqual(ids, ['1772', '3225']);
    assert.deepEqual(ids.map(id => LIB_BY_ID.get(id)?.n), ['elbow lift - reverse push-up', 'floor t raise']);
    assert.ok(ids.every(id => payload.library.some(e => e.id === id) && LIB_BY_ID.get(id).bp === 'back'));
    assert.ok(payload.library.every(e => LIB_BY_ID.get(e.id)?.eq === 'body weight'));
    assert.equal(attempts, 2);
  });
}

for (const type of ['workout', 'routine']) {
  test(`a no-equipment ${type} repairs a positive added load on a floor exercise`, async () => {
    const payload = payloadLib.build(S, { handle: 'test', kind: 'ask', note: 'a back workout with no equipment' });
    let attempts = 0;
    const adapter = { spawns: false, async invoke() {
      const item = { id: '1772', sets: 2, reps: 8 };
      if (++attempts === 1) item.weight = 10;
      return { code: 0, text: JSON.stringify({ coach_contract: 1, answer: 'Back session',
        actions: [{ type, name: 'Back', items: [item] }] }) };
    } };
    const r = await runPipeline({ adapter, cfg: {}, kind: 'ask', payload });
    assert.equal(r.ok, true);
    const items = type === 'routine' ? r.result.bundle.routines[0].ex : r.result.actions[0].items;
    assert.deepEqual(items.map(({ id, weight }) => [id, weight]), [['1772', undefined]]);
    assert.equal(attempts, 2);
  });
}

test('a full library of trained cable exercises still leaves room for an equipment-free back workout', () => {
  const pins = [...LIB_BY_ID.values()].filter(e => e.eq === 'cable').slice(0, payloadLib.ASK_LIBRARY);
  assert.equal(pins.length, payloadLib.ASK_LIBRARY);
  const profile = { ...S, routines: [{ id: 'gym', name: 'Gym', ex: pins.map(({ id }) => ({ id })) }] };
  const p = payloadLib.build(profile, { handle: 'test', kind: 'ask', note: 'a back workout with no equipment' });
  assert.equal(p.library.length, payloadLib.ASK_LIBRARY);
  assert.ok(p.library.every(e => LIB_BY_ID.get(e.id)?.eq === 'body weight'));
  assert.ok(p.library.some(e => e.bp === 'back'));
});

test('a back workout with resistance bands but no weights keeps band rows available', async () => {
  const profile = { ...S, routines: [{ id: 'back', name: 'Back', ex: [{ id: '0988' }] }],
    coach: { ...S.coach, profile: { equipment: ['band'] } } };
  for (const note of ['a back workout with resistance bands but no weights',
    'a back workout at home with resistance bands but no weights',
    'I have no weights, only resistance bands. Make me a band back workout.']) {
    const payload = payloadLib.build(profile, { handle: 'test', kind: 'ask', note });
    assert.ok(payload.library.some(e => e.id === '0988'), note);
    assert.ok(payload.library.some(e => e.id !== '0988' && LIB_BY_ID.get(e.id)?.eq === 'band'), note);
    let attempts = 0;
    const adapter = { spawns: false, async invoke() {
      const item = { id: '0988', sets: 2, reps: 8 };
      if (++attempts === 1) item.weight = 5;
      return { code: 0, text: JSON.stringify({ coach_contract: 1, answer: 'Band rows',
        actions: [{ type: 'workout', name: 'Back', items: [item] }] }) };
    } };
    const r = await runPipeline({ adapter, cfg: {}, kind: 'ask', payload });
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.actions[0].items.map(({ id, weight }) => [id, weight]), [['0988', undefined]]);
    assert.equal(attempts, 2);
  }
});
