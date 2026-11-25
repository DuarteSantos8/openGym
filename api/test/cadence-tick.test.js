/* The cadence tick end to end, against the real queue and the fixture provider: a profile set up
 * the way the app sets it gets its review queued, and one held back says why in the server log
 * (Discord, "Scheduled coach review doesn't trigger": every skip was silent, so nobody could
 * tell which rule held it back). */
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { tempData, writeState, sampleState } from './helpers.mjs';

const DIR = tempData();
const cfg = await import('../coach/config.js');
const jobs = await import('../coach/jobs.js');
const cadence = await import('../coach/cadence.js');
const { forcePrivilegeVerdict } = await import('../coach/adapters/spawn.js');
cfg.save({ enabled: true, provider: 'fixture' });
forcePrivilegeVerdict({ ok: true, dropped: false, why: 'pinned by the test suite' });

function tickOnce(uids) {
  const logs = [];
  const log = mock.method(console, 'log', (...a) => { logs.push(a.join(' ')); });
  mock.timers.enable({ apis: ['setInterval'] });
  try {
    const t = cadence.startCadence({ users: () => uids.map(id => ({ id })), userNow: () => ({ date: '2026-11-25', hhmm: '20:00', weekday: 3 }) });
    mock.timers.tick(61000);
    clearInterval(t);
  } finally { mock.timers.reset(); log.mock.restore(); }
  return logs;
}

test('a profile set up as the app does it gets its scheduled review', () => {
  const S = sampleState();
  S.coach.cadence = { everyWorkouts: 1 };
  S.coach.cadenceFor = cadence.cadenceTarget(cfg.load());
  writeState(DIR, 'u-due', S);
  const logs = tickOnce(['u-due']);
  assert.ok(logs.some(l => l.includes('scheduled review queued for u-due')), logs.join('\n'));
  assert.ok(jobs.status('u-due').job, 'a job is running');
});

test('switched on for another provider: held back, and the log says why, once', () => {
  _reset();
  const S = sampleState();
  S.coach.cadence = { everyWorkouts: 1 };
  S.coach.cadenceFor = 'openai|api.openai.com';
  writeState(DIR, 'u-moved', S);
  const first = tickOnce(['u-moved']);
  assert.ok(first.some(l => l.includes('u-moved held back') && l.includes('opening the Coach')), first.join('\n'));
  assert.equal(jobs.status('u-moved').job, null);
  const again = tickOnce(['u-moved']);
  assert.ok(!again.some(l => l.includes('held back')), 'the same reason is not logged every minute');
});

test('switched on before 1.4.6 (no cadenceFor): held back until the app fills it in', () => {
  _reset();
  const S = sampleState();
  S.coach.cadence = { everyWorkouts: 1 };
  writeState(DIR, 'u-old', S);
  const logs = tickOnce(['u-old']);
  assert.ok(logs.some(l => l.includes('u-old held back') && l.includes('an older version')), logs.join('\n'));
});

test('automatic reviews off: nothing logged', () => {
  _reset();
  writeState(DIR, 'u-off', sampleState());
  assert.deepEqual(tickOnce(['u-off']).filter(l => l.includes('u-off')), []);
});

function _reset() { cadence._resetWhyForTests(); }
