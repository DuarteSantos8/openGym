import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt, buildPromptParts, taskOf } from '../coach/core/prompt.js';
import { SCHEMAS } from '../coach/core/schemas.js';
import { build, FULL_DETAIL_SESSIONS } from '../coach/core/payload.js';
import { chatCompletionsSpec } from '../coach/core/adapters/openai.js';
import { validatePlan } from '../coach/core/validate.js';

const S = (workouts = []) => ({
  lang: 'en', unit: 'kg', routines: [{ id: 'r1', name: 'A', ex: [{ id: '0001', sets: 3, reps: 8 }] }],
  week: { 1: 'r1' }, workouts, bodyweight: [],
  coach: { consent: { agreedAt: 'x', version: 1 }, profile: { goal: 'muscle', equipment: [] }, log: [] }
});
const workout = (d, done = true) => ({
  d, start: 1, end: 60001, name: 'A',
  entries: [{ id: '0001', target: { sets: 3, reps: 8, weight: 60 }, sets: [{ done, w: 60, r: 8, rir: 2 }] }]
});

test('the rules half of the prompt is byte-identical across jobs of the same task', () => {
  const a = buildPromptParts('review', build(S([workout('2026-08-01')]), { handle: 'h1', kind: 'review' }));
  const b = buildPromptParts('review', build(S([workout('2026-08-20')]), { handle: 'h2', kind: 'review' }));
  assert.equal(a.system, b.system);              // the whole point: a prefix cache can hit
  assert.notEqual(a.user, b.user);
  assert.ok(a.user.includes('## Payload'));
  assert.ok(!a.system.includes('Payload'));      // nothing dynamic ahead of the payload
});

test('a repair round changes only the user half', () => {
  const p = build(S([workout('2026-08-01')]), { handle: 'h1', kind: 'review' });
  const clean = buildPromptParts('review', p);
  const repaired = buildPromptParts('review', p, { previous: '{"x":1}', errors: ['bad id'] });
  assert.equal(clean.system, repaired.system);
  assert.ok(repaired.user.includes('bad id'));
});

test('buildPrompt is exactly the two parts joined, so the CLI adapters lose nothing', () => {
  const p = build(S([workout('2026-08-01')]), { handle: 'h1', kind: 'review' });
  const parts = buildPromptParts('review', p);
  assert.equal(buildPrompt('review', p), parts.system + '\n\n---\n\n' + parts.user);
});

test('every task has a flat schema — no $ref, no anyOf/oneOf (llama.cpp grammar limits)', () => {
  for (const task of ['review', 'create', 'refine', 'debrief']) {
    const text = JSON.stringify(SCHEMAS[task]);
    assert.ok(text.length > 50, task);
    assert.ok(!/\$ref|anyOf|oneOf|allOf/.test(text), task);
  }
  assert.equal(taskOf('review', {}), 'review');
  assert.equal(taskOf('create', { refine: 'x' }), 'refine');
});

test('the create schema requires what the week resolves through: a routine id, and a week', () => {
  // A schema handed to a grammar-constrained decoder is the only thing standing between a small
  // local model and an answer the validator can only reject. These two fields are where that
  // showed: llama3.2:3b and qwen2.5:3b both answer with routines that carry no `id` and a week
  // naming what they put in `name`, which costs a job and a repair round to find out.
  assert.ok(SCHEMAS.create.properties.routines.items.required.includes('id'));
  assert.ok(SCHEMAS.create.required.includes('week'));
  assert.equal(SCHEMAS.refine, SCHEMAS.create);          // refine reuses it, same guarantee

  const noId = {
    coach_contract: 1,
    routines: [{ name: 'r1', ex: [{ id: '0001', sets: 3, reps: 8 }] }],
    week: { 1: 'r1' }
  };
  const checked = validatePlan(noId, { daysPerWeek: 1 });
  assert.ok(!checked.ok);
  assert.ok(checked.errors.some(e => e.includes('week[1] points at "r1"')));
});

test('the create schema caps the two arrays the validator caps, so a repeating model stops', () => {
  // validate.js slices at MAX_ROUTINES / MAX_EX_PER_ROUTINE; a model that never stops emitting
  // otherwise runs to the output limit first and the answer arrives truncated and unparseable.
  assert.equal(SCHEMAS.create.properties.routines.maxItems, 7);
  assert.equal(SCHEMAS.create.properties.routines.items.properties.ex.maxItems, 20);
});

test('older sessions in a review window are compacted, the recent ones keep full sets', () => {
  const many = Array.from({ length: FULL_DETAIL_SESSIONS + 4 }, (_, i) => workout('2026-08-' + String(i + 1).padStart(2, '0')));
  const p = build(S(many), { handle: 'h1', kind: 'review' });
  const w = p.window.workouts;
  assert.equal(w.length, many.length);
  assert.ok(w[0].compact);
  assert.equal(w[0].entries[0].done, '1/1');
  assert.equal(w[0].entries[0].top, '60x8@RIR2');
  assert.ok(!w[0].entries[0].sets);
  const recent = w[w.length - 1];
  assert.ok(!recent.compact);
  assert.ok(Array.isArray(recent.entries[0].sets));
});

test('chat-completions spec: schema rides as json_schema, falls back to json_object, then none', () => {
  const spec = chatCompletionsSpec('compatible', { maxTokensField: 'max_tokens', temperature: 0 });
  const body = spec.body({ model: 'm', prompt: 'p', system: 'RULES', schema: SCHEMAS.review, maxTokens: 100 });
  assert.equal(body.response_format.type, 'json_schema');
  assert.equal(body.temperature, 0);
  assert.ok(body.messages[0].content.includes('RULES'));
  const step1 = spec.withoutJsonMode(body);
  assert.equal(step1.response_format.type, 'json_object');
  const step2 = spec.withoutJsonMode(step1);
  assert.equal(step2.response_format, undefined);
  // Cloud OpenAI gets no temperature override — some models refuse it.
  const cloud = chatCompletionsSpec('openai');
  assert.equal(cloud.body({ model: 'm', prompt: 'p', maxTokens: 9 }).temperature, undefined);
});
