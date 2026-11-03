/* DATA SAFETY on the server for the v1.4.2 small fixes: the new optional data (S.dayPhotos, and
   on a routine entry subs, warmupRestOff, sideRestSec) survives PUT /api/data's stamping, also when
   an app from before them writes over it without knowing them, and a document without them comes
   out exactly as it went in. Their photo files count as referenced (the GC keeps them). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stampPut, STAMPED_MAPS } from '../sync-stamps.js';
import { referencedHashes } from '../media.js';

const H = n => String(n).repeat(64).slice(0, 64);
const photo = h => ({ kind: 'image', hash: h, mime: 'image/webp', size: 1000, width: 800, height: 600, at: 1 });
const old = () => ({
  _ts: 100, unit: 'kg',
  routines: [{ id: 'r1', name: 'Upper', _ts: 7, ex: [{ id: '0025', sets: 3, reps: 8, weight: 60, warmupRestSec: 45 }, { id: '0098', sets: 3, reps: 10, side: true }] }],
  workouts: [{ id: 'w1', d: '2026-10-01', start: 1, entries: [], media: [photo(H(1))], _ts: 8 }],
  dayNotes: { '2026-10-02': { tag: 'sick', _ts: 10 } },
});
const withNew = () => {
  const S = old();
  S.routines[0].ex[0] = { ...S.routines[0].ex[0], warmupRestOff: true, subs: ['0047'] };
  S.routines[0].ex[1] = { ...S.routines[0].ex[1], sideRestSec: 20 };
  S.dayPhotos = { [H(2)]: { d: '2026-10-03', m: photo(H(2)), _ts: 11 } };
  return S;
};
const strip = S => JSON.parse(JSON.stringify(S, (k, v) => (['_ts', '_f', '_u', '_rev', 'edited', 'deleted', '_unstamped', '_prior'].includes(k) ? undefined : v)));

test('dayPhotos is a stamped map on the server too', () => {
  assert.ok(STAMPED_MAPS.includes('dayPhotos'));
});

test('a document from before the new fields is stored as it was sent', () => {
  const cur = old(), next = old();
  next._ts = 200;
  const out = stampPut(cur, next, { stamped: true, now: 300 });
  assert.deepEqual(strip(out), strip(old()));
  assert.doesNotMatch(JSON.stringify(out), /dayPhotos|"subs"|warmupRestOff|sideRestSec/);
});

test('an app from before them, writing over a document that has them, does not take them away', () => {
  const cur = withNew();
  const next = old();                // an older app's copy: it never knew dayPhotos
  next.routines = structuredClone(cur.routines);   // its routines as it read them, fields and all
  next._ts = 200;
  const out = stampPut(cur, next, { stamped: false, overRead: true, now: 300 });
  assert.deepEqual(out.dayPhotos, cur.dayPhotos);
  assert.deepEqual(out.routines[0].ex, cur.routines[0].ex);
});

test('their files are kept by the clean-up', () => {
  assert.deepEqual([...referencedHashes(withNew())].sort(), [H(1), H(2)]);
});
