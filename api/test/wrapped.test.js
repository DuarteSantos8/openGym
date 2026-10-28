// "Your year in openGym" on the server (wrapped.js): when the December push is due, who is owed
// it, and what it says. The rules only; server-wrapped-push.test.js runs them in a real server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { wrappedPushYear, wrappedSummary, wrappedPushOwed, wrappedPush, WRAPPED_HOUR } from '../wrapped.js';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('due on Dec 1 from 18:00 to the end of the day, server time, and never else', () => {
  assert.equal(WRAPPED_HOUR, 18);
  assert.equal(wrappedPushYear(new Date(2026, 11, 1, 17, 59)), null);
  assert.equal(wrappedPushYear(new Date(2026, 11, 1, 18, 0)), 2026);
  assert.equal(wrappedPushYear(new Date(2026, 11, 1, 23, 59)), 2026);
  assert.equal(wrappedPushYear(new Date(2026, 11, 2, 18, 0)), null);
  assert.equal(wrappedPushYear(new Date(2026, 10, 30, 20, 0)), null);
  assert.equal(wrappedPushYear(new Date(NaN)), null);
  assert.equal(wrappedPushYear('2026-12-01'), null);
});

test('the summary is a few small facts whatever the state holds', () => {
  const workouts = Array.from({ length: 5000 }, (_, i) => ({ d: `${2000 + (i % 30)}-06-01` }));
  const sum = wrappedSummary({ workouts: [...workouts, { d: 'x'.repeat(1e5) }, null, { d: 7 }], wrapped: { phone: 2026, opened: Array(1e4).fill(1) }, lang: 'x'.repeat(500) });
  assert.deepEqual(sum, { notify: true, phone: 2026, lang: 'en', years: [2029, 2028, 2027] });
  assert.ok(JSON.stringify(sum).length < 100);
  assert.deepEqual(wrappedSummary(null), { notify: true, phone: null, lang: 'en', years: [] });
  assert.equal(wrappedSummary({ wrappedNotify: false }).notify, false);
  assert.equal(wrappedSummary({ wrapped: { phone: '2026' } }).phone, null);
  assert.equal(wrappedSummary({ lang: 'pt-BR' }).lang, 'pt-BR');
});

test('owed once per user and year, with a workout that year, not switched off, not planned on a phone', () => {
  const sum = over => ({ notify: true, phone: null, lang: 'en', years: [2026, 2025], ...over });
  const user = over => ({ id: 'u', ...over });
  assert.equal(wrappedPushOwed(user(), sum(), 2026), true);
  assert.equal(wrappedPushOwed(user({ wrappedPush: 2026 }), sum(), 2026), false, 'already sent this year');
  assert.equal(wrappedPushOwed(user({ wrappedPush: 2025 }), sum(), 2026), true, 'last year does not count');
  assert.equal(wrappedPushOwed(user(), sum({ notify: false }), 2026), false, 'switched off');
  assert.equal(wrappedPushOwed(user(), sum({ phone: 2026 }), 2026), false, 'a phone sends its own');
  assert.equal(wrappedPushOwed(user(), sum({ phone: 2025 }), 2026), true);
  assert.equal(wrappedPushOwed(user(), sum({ years: [2025] }), 2026), false, 'nothing logged this year');
  assert.equal(wrappedPushOwed(user({ disabled: true }), sum(), 2026), false);
  assert.equal(wrappedPushOwed(user(), null, 2026), false);
  assert.equal(wrappedPushOwed(user(), sum(), null), false);
});

test('the push is fixed words and the year: nothing from the profile rides along', () => {
  assert.deepEqual(wrappedPush('en', 2026), { title: 'Your 2026 in openGym is ready 🎉', body: 'Workouts, records and one very honest personality test. Tap to see your year.', tag: 'wrapped' });
  const de = wrappedPush('de', 2026);
  assert.match(de.title, /2026/);
  assert.notEqual(de.title, wrappedPush('en', 2026).title);
  assert.ok(!wrappedPush('de-CH', 2026).title.includes('ß'));
  assert.equal(wrappedPush('xx-nope', 2026).title, wrappedPush('en', 2026).title);
  assert.ok(JSON.stringify(wrappedPush('ar', 2026)).length < 600);
});

test('api/wrapped-copy.js matches the frontend strings (node scripts/build-wrapped-copy.mjs)', async t => {
  if (!fs.existsSync(path.join(API, '..', 'frontend', 'src', 'lib', 'wrapped-copy.js'))) return t.skip('no frontend next to the api');
  const { buildWrappedCopy } = await import('../scripts/build-wrapped-copy.mjs');
  assert.equal(fs.readFileSync(path.join(API, 'wrapped-copy.js'), 'utf8'), await buildWrappedCopy(),
    'api/wrapped-copy.js is out of date: run node scripts/build-wrapped-copy.mjs in api/');
});
