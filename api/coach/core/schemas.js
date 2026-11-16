/* JSON schemas for the three answer shapes, handed to providers that can enforce a schema
 * while decoding (Ollama/llama.cpp grammar sampling, LM Studio, vLLM, OpenAI json_schema).
 *
 * Deliberately flat: no $ref, no anyOf/oneOf, no additionalProperties tricks — llama.cpp's
 * grammar converter has a history of choking on those (ollama#8444, #8063). The schema
 * guarantees *shape* so a small model cannot ramble; validate.js remains the only judge of
 * whether the contents are safe to act on. Fields that may hold any JSON value (`before`,
 * `after`) say so with a type union, which the grammar converter does support.
 */
const ANY = { type: ['number', 'string', 'boolean', 'object', 'array', 'null'] };
const STR = { type: 'string' };
const STRINGS = { type: 'array', items: { type: 'string' } };

export const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    coach_contract: { type: 'integer' },
    nochange: { type: 'boolean' },
    reading: STR,
    summary: STR,
    evidence: {
      type: 'object',
      properties: { from: STR, to: STR, sessions: { type: 'integer' } }
    },
    changes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: STR,
          type: STR,
          target: {
            type: 'object',
            properties: { routineId: STR, exId: STR, weekday: { type: 'integer' }, programmeId: STR }
          },
          before: ANY,
          after: ANY,
          why: STR
        },
        required: ['type', 'why']
      }
    },
    notes: STRINGS
  },
  required: ['coach_contract']
};

const EX_SCHEMA = {
  type: 'object',
  properties: {
    id: STR, sets: { type: 'integer' }, mode: STR,
    reps: { type: 'integer' }, sec: { type: 'integer' },
    min: { type: 'integer' }, speed: { type: 'number' },
    weight: { type: 'number' }, prog: STR, inc: { type: 'number' },
    repsMin: { type: 'integer' }, repsMax: { type: 'integer' },
    bodyweight: { type: 'boolean' }, side: { type: 'boolean' },
    sg: STR, why: STR, position: { type: 'integer' },
    // A tip to keep in mind while doing it, and up to three library ids to do instead when the
    // machine is taken (#1003). Both kept with the routine; `why` is for the review screen only.
    note: STR, subs: { type: 'array', maxItems: 3, items: STR }
  },
  required: ['id', 'sets']
};

/* The week, spelled out day by day.
 *
 * It used to be a bare `{ type: 'object' }`, and that is a schema a constrained decoder can only
 * answer with `{}`: strict JSON Schema (and the grammar sampling llama.cpp/xgrammar do, which
 * enforces the same schema inside the sampler) will not let a key appear unless `properties`
 * declares it, and adding `additionalProperties: false` on top — which strictSchema() does for
 * the endpoints that demand it — leaves exactly one legal value, the empty object. A model asked
 * for a three-day plan therefore answered with a perfectly-formed empty week, and validate.js
 * could only reject it ("the week schedules 0 days but 3 were asked for") after a wasted
 * generation and a repair round.
 *
 * So every weekday is declared and all seven are required: `{}` is no longer representable, and
 * a day with no training says so with "rest" (validate.js skips it, so it neither schedules a day
 * nor counts against daysPerWeek). The value of a training day stays what it always was — one
 * routine id, the same map payload.js reads — so nothing downstream changes shape.
 *
 * additionalProperties is stated here rather than left to strictSchema() because these keys are
 * data, not a fixed field list: a decoder free to add keys also adds "7", which validate.js can
 * only reject. It is the one object in this file that says it.
 */
const WEEK_SCHEMA = {
  type: 'object',
  properties: { 0: STR, 1: STR, 2: STR, 3: STR, 4: STR, 5: STR, 6: STR },
  required: ['0', '1', '2', '3', '4', '5', '6'],
  additionalProperties: false
};

// `week` and `routines[].id` are required, not optional: the week is the only thing that says
// which day trains which routine, and it points at a routine by id. A schema that leaves either
// out lets a small local model answer with routines that have no id and a week naming "r1" —
// grammar-valid, and something validate.js can only ever reject ("the week schedules 0 days but
// 3 were asked for"), through the repair round and out as a failed job.
export const CREATE_SCHEMA = {
  type: 'object',
  properties: {
    coach_contract: { type: 'integer' },
    name: STR,
    summary: STR,
    basedOn: STR,
    week: WEEK_SCHEMA,
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
    coach_contract: { type: 'integer' },
    summary: STR,
    score: { type: 'integer' },
    highlights: STRINGS,
    watch: STRINGS,
    nextTime: STRINGS
  },
  required: ['coach_contract', 'summary', 'score']
};

// A question in the chat: a plain-text answer, and optionally actions the person confirms in the
// app (core/ask-actions.js). Flat items, scalar fields, so strict-schema gateways can write them.
const ITEM = { type: 'object', properties: { id: STR, sets: { type: 'integer' }, reps: { type: 'integer' }, sec: { type: 'integer' }, weight: { type: 'number' } }, required: ['id'] };
export const ASK_SCHEMA = {
  type: 'object',
  properties: {
    coach_contract: { type: 'integer' },
    answer: STR,
    actions: {
      type: 'array',
      maxItems: 8,
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['routine', 'schedule', 'swap', 'target', 'workout', 'start', 'note', 'exercise', 'show', 'import'] },
          name: STR, routineId: STR, exId: STR, to: STR, libraryId: STR, text: STR, why: STR, bp: STR, mode: STR,
          day: { type: 'integer' }, sets: { type: 'integer' }, reps: { type: 'integer' }, sec: { type: 'integer' },
          items: { type: 'array', maxItems: 14, items: ITEM }
        },
        required: ['type']
      }
    }
  },
  required: ['coach_contract', 'answer']
};

// A change to the workout running now (the `adapt` job). Every field flat and scalar, so a
// provider that closes every object for a strict schema (#804) can still write all of them.
const INT = { type: 'integer' };
export const ADAPT_SCHEMA = {
  type: 'object',
  properties: {
    coach_contract: INT,
    nochange: { type: 'boolean' },
    reading: STR,
    summary: STR,
    changes: {
      type: 'array',
      maxItems: 6,
      items: {
        type: 'object',
        properties: {
          type: STR, entry: INT, exId: STR, to: STR,
          sets: INT, reps: INT, sec: INT, weight: { type: 'number' }, pct: INT, rest: INT, place: STR,
          why: STR
        },
        required: ['type', 'why']
      }
    }
  },
  required: ['coach_contract']
};

export const SCHEMAS = { review: REVIEW_SCHEMA, create: CREATE_SCHEMA, refine: CREATE_SCHEMA, debrief: DEBRIEF_SCHEMA, ask: ASK_SCHEMA, adapt: ADAPT_SCHEMA };
