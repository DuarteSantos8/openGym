import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt, buildPromptParts, taskOf } from '../coach/core/prompt.js';
import { SCHEMAS } from '../coach/core/schemas.js';
import { build, FULL_DETAIL_SESSIONS } from '../coach/core/payload.js';
import { chatCompletionsSpec } from '../coach/core/adapters/openai.js';
import { validatePlan } from '../coach/core/validate.js';
import { runPipeline } from '../coach/core/pipeline.js';
import { D as fixtureDay } from './helpers.mjs';

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

// Model a decoder that can emit only declared object properties, as opposed to a server
// that merely requests JSON. Keep the candidate synthetic and let the real pipeline judge it.
function closedDecode(schema, value) {
  if (schema.type === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([key]) => schema.properties?.[key])
      .map(([key, item]) => [key, closedDecode(schema.properties[key], item)]));
  }
  if (schema.type === 'array') {
    if (value.length < (schema.minItems || 0)) throw new Error('array is below minItems');
    return value.map(item => closedDecode(schema.items, item));
  }
  return value;
}

const createdPlan = () => ({
  coach_contract: 1,
  name: 'Synthetic plan',
  week: { 1: 'r1', 4: 'r1' },
  routines: [{ id: 'r1', name: 'A', ex: [{ id: '0001', sets: 3, reps: 8 }] }]
});
const createPayload = () => ({
  coach_contract: 1, meta: { lang: 'en', unit: 'kg' },
  coachProfile: { daysPerWeek: 2, equipment: ['dumbbell'] },
  plan: { routines: [], week: {} }, library: [{ id: '0001' }]
});

test('a closed decoder can schedule the requested days instead of emitting an empty week', async () => {
  const run = async legacyWeek => {
    let calls = 0;
    const adapter = {
      spawns: false,
      invoke: async ({ schema }) => {
        calls++;
        const active = legacyWeek
          ? { ...schema, properties: { ...schema.properties, week: { type: 'object' } } }
          : schema;
        return { code: 0, text: JSON.stringify(closedDecode(active, createdPlan())) };
      }
    };
    return { result: await runPipeline({ adapter, cfg: {}, kind: 'create', payload: createPayload() }), calls };
  };
  const before = await run(true);
  assert.equal(before.calls, 2, 'the repair round cannot escape an object with no declared keys');
  assert.equal(before.result.errorClass, 'unusable');
  assert.deepEqual(before.result.errors, ['the week schedules 0 days but 2 were asked for']);

  const after = await run(false);
  assert.equal(after.calls, 1);
  assert.equal(after.result.ok, true);
  assert.deepEqual(after.result.result.bundle.week, { 1: 'r1', 4: 'r1' });
  const allDays = { ...createdPlan(), week: Object.fromEntries(Array.from({ length: 7 }, (_, d) => [d, 'r1'])) };
  assert.deepEqual(closedDecode(SCHEMAS.create, allDays).week, allDays.week);
});

test('a constrained plan cannot emit empty routines or an empty exercise list', () => {
  assert.throws(() => closedDecode(SCHEMAS.create, { ...createdPlan(), routines: [] }), /minItems/);
  const emptyExercises = { ...createdPlan(), routines: [{ id: 'r1', name: 'A', ex: [] }] };
  assert.throws(() => closedDecode(SCHEMAS.create, emptyExercises), /minItems/);
  assert.deepEqual(closedDecode(SCHEMAS.create, createdPlan()), createdPlan());
});

test('the plan pipeline still rejects semantic errors when a provider ignores its schema', async () => {
  const cases = [
    [{ ...createdPlan(), routines: [{ id: 'r1', name: 'A', ex: [{ id: 'not-a-library-id', sets: 3 }] }] }, /not in the exercise library/],
    [{ ...createdPlan(), routines: [{ id: 'r1', name: 'A', ex: [{ id: '0009', sets: 3 }] }] }, /needs equipment/],
    [{ ...createdPlan(), week: { 1: 'r1', 7: 'r1' } }, /not a weekday number/],
    [{ ...createdPlan(), week: { 1: 'r1', 3: 'r1', 4: 'r1' } }, /3 days but 2 were asked for/],
    [{ ...createdPlan(), week: { 1: 'missing', 4: 'r1' } }, /not one of the routines/]
  ];
  for (const [answer, expected] of cases) {
    const adapter = { spawns: false, invoke: async () => ({ code: 0, text: JSON.stringify(answer) }) };
    const result = await runPipeline({ adapter, cfg: {}, kind: 'create', payload: createPayload() });
    assert.equal(result.errorClass, 'unusable');
    assert.match(result.errors.join('; '), expected);
  }
});

test('older sessions in a review window are compacted, the recent ones keep full sets', () => {
  const many = Array.from({ length: FULL_DETAIL_SESSIONS + 4 }, (_, i) => workout(fixtureDay('2026-07-' + String(i + 1).padStart(2, '0'))));
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
