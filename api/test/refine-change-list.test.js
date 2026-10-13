/* #471: a revision that came back as a review-style change list.
 *
 * With a plan proposal pending, the chat sends every message as a refine, and the plan
 * validator only knows complete plans. A model that does not enforce the JSON schema (OpenAI's
 * json_schema without `strict`) answered "swap the leverage machine" with one `swap-exercise`
 * against the plan the person trains today, and the job failed as "the Coach answered with
 * something the app couldn't use" after the repair round said nothing useful. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { tempData } from './helpers.mjs';

tempData();
const { runPipeline } = await import('../coach/core/pipeline.js');
const { buildPromptParts } = await import('../coach/core/prompt.js');
const { build } = await import('../coach/core/payload.js');
const { changesOntoPlan, isChangeList } = await import('../coach/core/refine-changes.js');

// The answer from the issue, verbatim.
const ISSUE = {
  coach_contract: 1,
  nochange: false,
  summary: 'Your note says you do not have a leverage machine, and the Monday routine in your weekly schedule includes a lever triceps dip, so I propose swapping it for a cable exercise you have available.',
  evidence: { from: '2026-07-20', to: '2026-09-24', sessions: 23 },
  changes: [{
    id: 'c1', type: 'swap-exercise',
    target: { routineId: 'mumgkckgrla1g', exId: '0591' },
    before: '0591', after: { id: '0194' },
    why: 'You said you do not have a leverage machine, and the Monday routine assigned in your week includes a lever overhand triceps dip.'
  }],
  notes: []
};

// The plan they train today (ids the app minted when an earlier plan was imported) …
const S = equipment => ({
  lang: 'en', unit: 'kg',
  routines: [{ id: 'mumgkckgrla1g', name: 'Push', ex: [{ id: '0025', sets: 3, reps: 8 }, { id: '0591', sets: 3, reps: 10 }] }],
  week: { 1: ['mumgkckgrla1g'] },
  workouts: [], bodyweight: [],
  coach: { consent: { agreedAt: 'x', version: 1 }, profile: { goal: 'muscle', daysPerWeek: 2, equipment }, log: [] }
});
// … and the proposal they are questioning, which still has the lever dip in it.
const previous = {
  opengym_plan: 1, name: 'Upper / lower', summary: 'Two days.', basedOn: 'your last 12 weeks',
  week: { 1: 'r1', 4: 'r2' },
  routines: [
    { id: 'r1', name: 'Upper', emoji: 'arm', ex: [{ id: '0025', sets: 4, mode: 'reps', reps: 6 }, { id: '0591', sets: 3, mode: 'reps', reps: 12, why: 'triceps' }] },
    { id: 'r2', name: 'Lower', emoji: 'legs', ex: [{ id: '0043', sets: 4, mode: 'reps', reps: 8 }] }
  ],
  customEx: []
};
const payloadFor = equipment => build(S(equipment), { handle: 'h'.repeat(16), kind: 'create', refine: 'I do not own a leverage machine, replace the dip', previous });

function stub(answers) {
  const calls = [];
  return { calls, adapter: { spawns: false, async invoke(req) { calls.push(req); return { code: 0, text: answers[calls.length - 1] }; } } };
}

test('#471: the change list from the issue revises the pending plan instead of failing the job', async () => {
  const s = stub([JSON.stringify(ISSUE)]);
  const r = await runPipeline({ adapter: s.adapter, cfg: {}, kind: 'create', payload: payloadFor(['cable', 'barbell']) });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(s.calls.length, 1, 'no repair round was needed');
  const upper = r.result.bundle.routines.find(x => x.id === 'r1');
  // Swapped in place, the old prescription kept, the model's reason on it.
  assert.deepEqual(upper.ex.map(e => e.id), ['0025', '0194']);
  assert.equal(upper.ex[1].sets, 3);
  assert.equal(upper.ex[1].reps, 12);
  assert.match(upper.ex[1].why, /leverage machine/);
  // Everything they did not question stays as it was.
  assert.deepEqual(r.result.bundle.week, { 1: 'r1', 4: 'r2' });
  assert.deepEqual(r.result.bundle.routines.find(x => x.id === 'r2').ex.map(e => e.id), ['0043']);
  assert.match(r.result.summary, /leverage machine/);
});

test('#471: the plan validator still judges what comes out — an off-equipment swap goes to repair', async () => {
  const off = { ...ISSUE, changes: [{ ...ISSUE.changes[0], after: { id: '0194' } }] };
  const s = stub([JSON.stringify(off), JSON.stringify(off)]);
  const r = await runPipeline({ adapter: s.adapter, cfg: {}, kind: 'create', payload: payloadFor(['barbell']) });
  assert.equal(r.ok, false);
  assert.equal(r.errorClass, 'unusable');
  assert.ok(r.errors.some(e => /needs equipment the user does not have/.test(e)), r.errors.join('\n'));
});

test('#471: a change list that cannot be placed exactly asks for the whole plan on the repair round', async () => {
  const lost = { ...ISSUE, changes: [{ ...ISSUE.changes[0], target: { routineId: 'nope', exId: '9999' } }] };
  const fixed = {
    coach_contract: 1, name: 'Upper / lower', summary: 'Swapped the lever dip for a cable extension.',
    week: { 1: 'r1', 4: 'r2' },
    routines: [
      { id: 'r1', name: 'Upper', ex: [{ id: '0025', sets: 4, reps: 6 }, { id: '0194', sets: 3, reps: 12 }] },
      { id: 'r2', name: 'Lower', ex: [{ id: '0043', sets: 4, reps: 8 }] }
    ]
  };
  const s = stub([JSON.stringify(lost), JSON.stringify(fixed)]);
  const r = await runPipeline({ adapter: s.adapter, cfg: {}, kind: 'create', payload: payloadFor(['cable', 'barbell']) });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(s.calls.length, 2);
  assert.match(s.calls[1].prompt, /not a list of changes/);
  assert.match(s.calls[1].prompt, /A list of `changes` when the task asked for a plan/);
});

test('#471: only exercise-level changes are placed; anything wider is left to the repair round', () => {
  assert.equal(isChangeList(ISSUE), true);
  assert.equal(isChangeList({ routines: [{}], changes: [{}] }), false);
  const week = { ...ISSUE, changes: [{ id: 'c1', type: 'week', target: { weekday: 2 }, after: 'r1', why: 'x' }] };
  assert.equal(changesOntoPlan(previous, week), null);
  const badSets = { ...ISSUE, changes: [{ id: 'c1', type: 'sets', target: { routineId: 'r1', exId: '0025' }, after: '5 sets', why: 'x' }] };
  assert.equal(changesOntoPlan(previous, badSets), null);
  const sets = { ...ISSUE, changes: [{ id: 'c1', type: 'sets', target: { routineId: 'r1', exId: '0025' }, after: 5, why: 'x' }] };
  assert.equal(changesOntoPlan(previous, sets).routines[0].ex[0].sets, 5);
  // The plan being revised is copied, never edited.
  assert.equal(previous.routines[0].ex[0].sets, 4);
});

test('#471: the refine rules carry the plan format and say a change list is not an answer', () => {
  const { system, task } = buildPromptParts('create', payloadFor([]));
  assert.equal(task, 'refine');
  assert.match(system, /"opengym_plan": 1/);
  assert.match(system, /Never answer with a list of `changes`/);
  assert.match(system, /`plan` is what they train today/);
});
