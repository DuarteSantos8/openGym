/* A note on one set (frontend lib/set-notes.js, v1.4.5) follows the rule a workout's own note
   follows: it rides along in the full workouts a review or a question reads, and nowhere else. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { tempData, sampleState } from './helpers.mjs';

tempData();
const payloadLib = await import('../coach/core/payload.js');

test('a set note reaches the Coach with its workout, cut to 140 characters', () => {
  const S = sampleState();
  S.workouts[0].entries[0].sets[1].note = '  grip slipped ' + 'x'.repeat(200);
  const p = payloadLib.build(S, { handle: 'h'.repeat(16), kind: 'review' });
  const json = JSON.stringify(p);
  assert.ok(json.includes('"note":"grip slipped '), 'the note is in the payload');
  const m = json.match(/"note":"(grip slipped x*)"/);
  assert.equal(m[1].length, 140);
});

test('a set without a note reads exactly as before', () => {
  const a = JSON.stringify(payloadLib.build(sampleState(), { handle: 'h'.repeat(16), kind: 'review' }));
  const S = sampleState();
  S.workouts[0].entries[0].sets[1].note = '   ';
  const b = JSON.stringify(payloadLib.build(S, { handle: 'h'.repeat(16), kind: 'review' }));
  assert.equal(a, b);
});
