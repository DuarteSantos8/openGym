/* JSON schemas for the three answer shapes, handed to providers that can enforce a schema
 * while decoding (Ollama/llama.cpp grammar sampling, LM Studio, vLLM, OpenAI json_schema).
 *
 * Deliberately self-contained: no $ref or additionalProperties tricks. Review changes use
 * oneOf because their required targets differ by type — without it a grammar-constrained model
 * can legally omit the exact exercise it wants removed. Providers that reject the richer schema
 * already fall back to plain JSON mode in adapters/http.js. validate.js remains the final judge
 * of whether the contents are safe to act on.
 */
import { CONTRACT } from './payload.js';
import { CHANGE_TYPES } from './validate.js';

const ANY = { type: ['number', 'string', 'boolean', 'object', 'array', 'null'] };
const STR = { type: 'string' };
const STRINGS = { type: 'array', items: { type: 'string' } };

const EX_SCHEMA = {
  type: 'object',
  properties: {
    id: STR, sets: { type: 'integer' }, mode: STR,
    reps: { type: 'integer' }, sec: { type: 'integer' },
    min: { type: 'integer' }, speed: { type: 'number' },
    weight: { type: 'number' }, prog: STR, inc: { type: 'number' },
    repsMin: { type: 'integer' }, repsMax: { type: 'integer' },
    bodyweight: { type: 'boolean' }, side: { type: 'boolean' },
    sg: STR, why: STR, position: { type: 'integer' }
  },
  required: ['id', 'sets']
};

const TARGET_PROPERTIES = { routineId: STR, exId: STR, weekday: { type: 'integer' } };
const EXERCISE_TARGETS = new Set([
  'remove-exercise', 'swap-exercise', 'sets', 'reps', 'repsMin', 'repsMax',
  'sec', 'cardio', 'superset', 'exercise-prog', 'inc'
]);
const NO_ROUTINE_TARGET = new Set(['add-routine', 'week']);
const AFTER_SCHEMAS = {
  'add-exercise': EX_SCHEMA,
  'remove-exercise': { type: 'null' },
  'swap-exercise': { type: 'object', properties: { id: STR, sets: { type: 'integer' }, reps: { type: 'integer' }, weight: { type: 'number' } }, required: ['id'] },
  sets: { type: 'integer' },
  reps: { type: 'integer' },
  repsMin: { type: 'integer' },
  repsMax: { type: 'integer' },
  sec: { type: 'integer' },
  cardio: { type: 'object', properties: { min: { type: 'integer' }, speed: { type: 'number' } } },
  reorder: STRINGS,
  superset: { type: 'object', properties: { link: { type: 'boolean' }, with: STR }, required: ['link'] },
  'routine-prog': STR,
  'exercise-prog': STR,
  inc: { type: 'number' },
  'add-routine': { type: 'object', properties: { name: STR, emoji: STR, prog: STR, ex: { type: 'array', items: EX_SCHEMA } }, required: ['name', 'ex'] },
  'remove-routine': { type: 'null' },
  'rename-routine': STR,
  week: { type: ['string', 'null'] }
};

function reviewChangeSchema(type) {
  const targetRequired = type === 'week' ? ['weekday']
    : EXERCISE_TARGETS.has(type) ? ['routineId', 'exId']
      : NO_ROUTINE_TARGET.has(type) ? [] : ['routineId'];
  const required = ['type', 'after', 'why'];
  if (targetRequired.length) required.splice(1, 0, 'target');
  return {
    type: 'object',
    properties: {
      id: STR,
      type: { const: type },
      target: {
        type: 'object',
        properties: TARGET_PROPERTIES,
        ...(targetRequired.length ? { required: targetRequired } : {})
      },
      before: ANY,
      after: AFTER_SCHEMAS[type],
      why: STR
    },
    required
  };
}

export const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    coach_contract: { const: CONTRACT },
    nochange: { type: 'boolean' },
    reading: STR,
    summary: STR,
    evidence: {
      type: 'object',
      properties: { from: STR, to: STR, sessions: { type: 'integer' } }
    },
    changes: {
      type: 'array',
      items: { oneOf: CHANGE_TYPES.map(reviewChangeSchema) }
    },
    notes: STRINGS
  },
  required: ['coach_contract', 'changes']
};

// `week` and `routines[].id` are required, not optional: the week is the only thing that says
// which day trains which routine, and it points at a routine by id. A schema that leaves either
// out lets a small local model answer with routines that have no id and a week naming "r1" —
// grammar-valid, and something validate.js can only ever reject ("the week schedules 0 days but
// 3 were asked for"), through the repair round and out as a failed job.
export const CREATE_SCHEMA = {
  type: 'object',
  properties: {
    coach_contract: { const: CONTRACT },
    name: STR,
    summary: STR,
    basedOn: STR,
    week: { type: 'object' },
    // The caps are the validator's own (MAX_ROUTINES, MAX_EX_PER_ROUTINE), stated here as well
    // because "1-7 routines, each 3-12 exercises" in create.md is only a request. A small model
    // that starts repeating itself does not stop at a request: qwen2.5:3b walks the library id by
    // id, three sets of eight apiece, until it hits the output limit — twelve minutes for an
    // answer that arrives cut in half and cannot be parsed. maxItems ends that run at seven
    // routines instead.
    routines: {
      type: 'array',
      maxItems: 7,
      items: {
        type: 'object',
        properties: {
          id: STR, name: STR, emoji: STR, prog: STR, why: STR,
          ex: { type: 'array', maxItems: 20, items: EX_SCHEMA }
        },
        required: ['id', 'name', 'ex']
      }
    },
    customEx: {
      type: 'array',
      items: { type: 'object', properties: { id: STR, n: STR, bp: STR, desc: STR }, required: ['id', 'n'] }
    }
  },
  required: ['coach_contract', 'week', 'routines']
};

export const DEBRIEF_SCHEMA = {
  type: 'object',
  properties: {
    coach_contract: { const: CONTRACT },
    summary: STR,
    score: { type: 'integer' },
    highlights: STRINGS,
    watch: STRINGS,
    nextTime: STRINGS
  },
  required: ['coach_contract', 'summary', 'score']
};

export const SCHEMAS = { review: REVIEW_SCHEMA, create: CREATE_SCHEMA, refine: CREATE_SCHEMA, debrief: DEBRIEF_SCHEMA };
