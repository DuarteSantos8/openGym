/* A set's own form video (frontend lib/set-videos.js, v1.4.4) is the lifter's alone: nothing of it
   may reach the Coach. The payload reads named fields of each set, never the row as it stands, and
   this pins that for a state whose sets carry videos, on every kind of request. The server's GC
   keeping those files is pinned by the shared fixture (media-refs.json). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { tempData, sampleState } from './helpers.mjs';

tempData();
const payloadLib = await import('../coach/core/payload.js');

const HASH = 'ab'.repeat(32);
const POSTER = 'cd'.repeat(32);
const video = (hash, extra = {}) => ({ kind: 'video', hash, mime: 'video/mp4', size: 4_000_000, width: 720, height: 1280, dur: 9.5, codec: 'avc1', poster: { hash: POSTER, mime: 'image/webp', size: 9000, width: 270, height: 480 }, at: 1, ...extra });

function filmed() {
  const S = sampleState();
  S.workouts[0].entries[0].sets[0].media = [video(HASH)];
  S.workouts[0].entries[0].sets[2].media = [video('ef'.repeat(32), { local: true })];
  S.workouts[0].media = [video('12'.repeat(32))];
  return S;
}

for (const kind of ['create', 'review', 'ask', 'debrief']) {
  test(`the Coach payload (${kind}) carries nothing of a set's form video`, () => {
    const p = payloadLib.build(filmed(), { handle: 'h'.repeat(16), kind, note: 'How is my squat depth?', workoutId: 'w1' });
    const json = JSON.stringify(p);
    for (const leak of [HASH, POSTER, 'ef'.repeat(32), '12'.repeat(32), 'video/mp4', 'avc1', '"media"', '"local"']) {
      assert.ok(!json.includes(leak), `${kind} payload leaks ${leak}`);
    }
  });
}

test('a filmed set reads exactly like the same set unfilmed', () => {
  const plain = sampleState();
  const a = JSON.stringify(payloadLib.build(filmed(), { handle: 'h'.repeat(16), kind: 'review' }));
  const b = JSON.stringify(payloadLib.build(plain, { handle: 'h'.repeat(16), kind: 'review' }));
  assert.equal(a, b);
});
