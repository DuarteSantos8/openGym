import test from 'node:test';
import assert from 'node:assert/strict';
import { WARMUP_MOVEMENTS, WARMUP_IDS, MAX_WARMUP_STEPS, WARMUP_TIME_LIMITS, WARMUP_REP_LIMITS, defaultWarmupStep, normalizeWarmup } from '../training/guided-warmup.js';
import { EXDB } from '../../frontend/src/lib/exercises-data.js';

test('reviewed movements resolve to existing equipment-free catalogue animations', () => {
  assert.equal(new Set(WARMUP_IDS).size, WARMUP_IDS.length);
  assert.ok(WARMUP_IDS.length >= 10 && WARMUP_IDS.length <= 15);
  for (const movement of WARMUP_MOVEMENTS) {
    const exercise = EXDB.find(ex => ex.id === movement.id);
    assert.ok(exercise, movement.id);
    assert.equal(exercise.eq, 'body weight');
    assert.ok(exercise.img.endsWith('.webp'));
    assert.ok(exercise.gif.endsWith('.mp4'));
    assert.ok(movement.coverage.length > 0);
    assert.ok(movement.family);
    const step = defaultWarmupStep(movement.id);
    assert.deepEqual(normalizeWarmup({ enabled: true, steps: [step] }).steps, [step]);
    assert.equal('coverage' in step, false);
    assert.equal('family' in step, false);
  }
  assert.equal(defaultWarmupStep('unknown'), undefined);
});

test('absent and malformed configurations do not enable a warm-up in legacy plans', () => {
  for (const value of [undefined, null, false, 'yes', [], {}, { enabled: true }, { enabled: 'true', steps: [] }, { enabled: 1, steps: [] }]) {
    assert.equal(normalizeWarmup(value), undefined);
  }
  assert.deepEqual(normalizeWarmup({ enabled: true, steps: [] }), { enabled: true, steps: [] });
});

test('disabled warm-ups retain valid edits and strip imported extra fields', () => {
  const input = { enabled: false, malicious: 'ignore', steps: [{ id: '1368', mode: 'time', sec: 25, reps: 800, perSide: true, done: true }] };
  const before = structuredClone(input);
  assert.deepEqual(normalizeWarmup(input), { enabled: false, steps: [{ id: '1368', mode: 'time', sec: 25, perSide: true }] });
  assert.deepEqual(input, before);
});

test('rejects unknown exercises and invalid numeric targets instead of coercing imported input', () => {
  const malformed = [null, [], false, { id: 'unknown', mode: 'time', sec: 30 }, { id: '__proto__', mode: 'time', sec: 30 },
    { id: '1368', mode: 'distance', sec: 30 }, { id: '1368', mode: 'time', sec: '30' },
    { id: '1368', mode: 'time', sec: Infinity }, { id: '1368', mode: 'time', sec: NaN },
    { id: '3502', mode: 'reps', reps: -Infinity }, { id: '3502', mode: 'reps', reps: true },
    { id: '1368', mode: 'time', reps: 10 }];
  assert.deepEqual(normalizeWarmup({ enabled: true, steps: malformed }).steps, []);
});

test('bounds and rounds time and repetitions and only accepts literal per-side flags', () => {
  const steps = normalizeWarmup({ enabled: true, steps: [
    { id: '1368', mode: 'time', sec: -4, perSide: 'yes' },
    { id: '1368', mode: 'time', sec: 1e20, perSide: true },
    { id: '3502', mode: 'reps', reps: 0 },
    { id: '3502', mode: 'reps', reps: 100 },
    { id: '3905', mode: 'time', sec: 20.6 },
    { id: '3905', mode: 'reps', reps: 9.4 },
  ] }).steps;
  assert.deepEqual(steps, [
    { id: '1368', mode: 'time', sec: WARMUP_TIME_LIMITS.min },
    { id: '1368', mode: 'time', sec: WARMUP_TIME_LIMITS.max, perSide: true },
    { id: '3502', mode: 'reps', reps: WARMUP_REP_LIMITS.min },
    { id: '3502', mode: 'reps', reps: WARMUP_REP_LIMITS.max },
    { id: '3905', mode: 'time', sec: 21 },
    { id: '3905', mode: 'reps', reps: 9 },
  ]);
});

test('limits valid steps without letting invalid imported entries consume the allowance', () => {
  const steps = [null, ...Array.from({ length: 20 }, (_, i) => ({ id: '3905', mode: 'time', sec: 20 + i }))];
  const result = normalizeWarmup({ enabled: true, steps });
  assert.equal(result.steps.length, MAX_WARMUP_STEPS);
  assert.deepEqual(result.steps.map(step => step.sec), Array.from({ length: MAX_WARMUP_STEPS }, (_, i) => 20 + i));
  assert.deepEqual(normalizeWarmup(result), result);
});

test('retains every distinct curated movement instead of an arbitrary sequence cap', () => {
  const steps = WARMUP_IDS.map(defaultWarmupStep);
  assert.equal(MAX_WARMUP_STEPS, WARMUP_IDS.length);
  assert.deepEqual(normalizeWarmup({ enabled: true, steps }), { enabled: true, steps });
});
