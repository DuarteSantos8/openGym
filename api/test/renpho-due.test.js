/* When the timer syncs a profile's RENPHO readings (api/providers/renpho/service.js due): every
   interval after the last sync, and after a failure not every ten minutes — signing in over and
   over is what gets an account refused — but an hour later, or the whole interval after a refused
   sign-in, which is tried again then instead of being given up on. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRenphoService } from '../providers/renpho/service.js';

const H = 3600000, EVERY = 6 * H, T0 = Date.parse('2026-10-20T12:00:00Z');
let clock = T0;
const svc = createRenphoService({
  seal: x => x, unseal: x => x, save() {}, merge: () => ({ added: 0, updated: 0 }),
  readRaw: () => null, writeRaw() {}, removeRaw() {}, client: {}, now: () => clock, log() {},
});
const user = renpho => ({ id: 'u', renpho });
const due = u => svc.due([u], EVERY).length === 1;

test('a profile synced a while ago is due once the interval has passed', () => {
  const u = user({ lastSync: T0 - 5 * H });
  clock = T0; assert.equal(due(u), false);
  clock = T0 + H; assert.equal(due(u), true);
});

test('a passing failure is tried again an hour later, not at the next ten-minute tick', () => {
  const u = user({ lastSync: T0 - 10 * H, error: { code: 'network', at: T0 } });
  clock = T0 + 10 * 60000; assert.equal(due(u), false);
  clock = T0 + H; assert.equal(due(u), true);
});

test('a refused sign-in waits the whole interval, then is tried again', () => {
  const u = user({ lastSync: T0 - 10 * H, error: { code: 'auth', at: T0 } });
  clock = T0 + 5 * H; assert.equal(due(u), false);
  clock = T0 + EVERY; assert.equal(due(u), true);
});

test('no account, a disabled profile: never', () => {
  clock = T0;
  assert.equal(due({ id: 'a' }), false);
  assert.equal(due({ id: 'b', disabled: true, renpho: { lastSync: 0 } }), false);
});
