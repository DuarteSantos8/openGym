/* The schemas are the contract a schema-constrained decoder is built from, so what they say has
 * to be something a decoder can actually produce. Two shapes were not:
 *
 *   - `week: { type: 'object' }` with no properties. Under strict JSON Schema — and under the
 *     grammar sampling a local endpoint does, which enforces the same schema inside the sampler
 *     — the only value such a schema admits is `{}`, so a model asked for a three-day plan
 *     answered with an empty week every time and the validator rejected a perfectly-formed
 *     answer. The tests below pin the week to seven named days so that cannot come back.
 *
 *   - the whole schema, sent to Gemini as `responseSchema`. That is an OpenAPI 3.0 subset: a
 *     keyword it does not define (maxItems, additionalProperties, …) is a 400, not a warning,
 *     and Gemini has no JSON-mode fallback here. geminiSchema() is the copy, and what it keeps
 *     and drops is what these tests assert.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { CREATE_SCHEMA, REVIEW_SCHEMA } from '../coach/core/schemas.js';
import { strictSchema } from '../coach/core/adapters/openai.js';
import { geminiSchema, geminiSpec } from '../coach/core/adapters/gemini.js';
import { validatePlan } from '../coach/core/validate.js';

const DAYS = ['0', '1', '2', '3', '4', '5', '6'];
const sorted = list => list.slice().sort();

test('the create schema spells out all seven weekdays', () => {
  const week = CREATE_SCHEMA.properties.week;
  assert.equal(week.type, 'object');
  assert.deepEqual(sorted(Object.keys(week.properties)), DAYS);
  for (const d of DAYS) assert.deepEqual(week.properties[d], { type: 'string' }, `week["${d}"] holds one routine id`);
  // All seven required: a strict decoder then cannot answer `{}`, which is what the bare
  // `{ type: 'object' }` used to force.
  assert.deepEqual(sorted(week.required), DAYS);
  assert.equal(week.additionalProperties, false, 'the day keys are data — no eighth key');
});

test('strictSchema keeps the week object spelled out instead of collapsing it to an empty one', () => {
  const week = strictSchema(CREATE_SCHEMA).properties.week;
  assert.deepEqual(sorted(Object.keys(week.properties)), DAYS);
  assert.deepEqual(sorted(week.required), DAYS);
  assert.equal(week.additionalProperties, false);
  // The bug, restated: this was the whole of `week` once strictSchema had added its one rule.
  assert.notDeepEqual(week, { type: 'object', additionalProperties: false });
});

test('strictSchema adds additionalProperties only where it is absent, and a second pass changes nothing', () => {
  const once = strictSchema(CREATE_SCHEMA);
  assert.equal(once.properties.routines.items.additionalProperties, false, 'added where the schema had none');
  assert.equal(once.properties.week.additionalProperties, false, 'already stated, left as it is');
  assert.deepEqual(strictSchema(once), once, 'idempotent — the retry cannot produce a different schema');
  // An explicit `true` is a decision the schema made; strictSchema does not overrule it.
  assert.equal(strictSchema({ type: 'object', properties: {}, additionalProperties: true }).additionalProperties, true);
  assert.ok(!('additionalProperties' in strictSchema({ type: 'string' })), 'not on a node that is not an object');
});

const answer = week => ({
  coach_contract: 1,
  week,
  routines: [{ id: 'r1', name: 'A', ex: [{ id: '0001', sets: 3, reps: 10 }] }]
});

test('a seven-day week with "rest" on the days off validates to the sparse map the app stores', () => {
  const r = validatePlan(answer({ 0: 'rest', 1: 'r1', 2: 'rest', 3: 'r1', 4: 'rest', 5: 'rest', 6: 'rest' }), { daysPerWeek: 2, sessionMin: 60 });
  assert.equal(r.ok, true, (r.errors || []).join('; '));
  assert.deepEqual(r.bundle.week, { 1: 'r1', 3: 'r1' }, 'rest is not a scheduled day');
});

test('a week of nothing but rest is still reported as the empty week it is', () => {
  const r = validatePlan(answer(Object.fromEntries(DAYS.map(d => [d, 'rest']))), { daysPerWeek: 2, sessionMin: 60 });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /the week schedules 0 days but 2 were asked for/);
});

test('geminiSchema drops the keywords Gemini\'s subset rejects, at every level', () => {
  const g = geminiSchema(CREATE_SCHEMA);
  assert.ok(g, 'the create shape is expressible');
  assert.deepEqual(sorted(Object.keys(g.properties.week.properties)), DAYS);
  assert.ok(!('additionalProperties' in g.properties.week));
  assert.ok(!('maxItems' in g.properties.routines));
  assert.ok(!('maxItems' in g.properties.routines.items.properties.ex));
  assert.equal(JSON.stringify(g).includes('maxItems'), false);
  // Everything Gemini does understand is still there, so the answer is still constrained.
  assert.equal(g.properties.routines.items.properties.ex.items.properties.sets.type, 'integer');
  assert.deepEqual(sorted(g.properties.week.required), DAYS);
  // …and the source keeps what the local grammars need.
  assert.equal(CREATE_SCHEMA.properties.routines.maxItems, 7);
});

test('geminiSchema declines a schema Gemini cannot express rather than sending one it will 400', () => {
  // before/after are type unions (`ANY`), which responseSchema has no way to say.
  assert.equal(geminiSchema(REVIEW_SCHEMA), null);
  assert.equal(geminiSchema({ type: 'object', properties: { x: { anyOf: [{ type: 'string' }] } } }), null);
  assert.equal(geminiSchema({ type: 'object', properties: { x: { type: ['string', 'null'] } } }), null);
});

test('the Gemini request carries responseSchema only when the schema fits its subset', () => {
  const create = geminiSpec.body({ prompt: 'P', system: null, schema: CREATE_SCHEMA, maxTokens: 100 }).generationConfig;
  assert.equal(create.responseMimeType, 'application/json');
  assert.ok(create.responseSchema, 'the create shape is sent');
  assert.deepEqual(sorted(create.responseSchema.properties.week.required), DAYS);
  assert.equal(JSON.stringify(create).includes('maxItems'), false);

  const review = geminiSpec.body({ prompt: 'P', system: null, schema: REVIEW_SCHEMA, maxTokens: 100 }).generationConfig;
  assert.equal('responseSchema' in review, false, 'review keeps the json-mime path');

  const none = geminiSpec.body({ prompt: 'P', system: null, maxTokens: 100 }).generationConfig;
  assert.equal('responseSchema' in none, false);
});
