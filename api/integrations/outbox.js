/* The outbox: every delivery an integration owes (a webhook POST now, a Strava upload later) is a
 * job here first, written to DATA_DIR/integrations/outbox.json before anything is sent, so a
 * restart or a host reset in the middle neither loses it nor sends it twice.
 *
 *   idempotency  Each job has a key ("webhook:<connection>:workout.finished:<workout id>"). A key
 *                that is queued, or was delivered in the last DONE_KEEP_MS, is not queued again:
 *                the same workout pushed by two devices, a sync retried after a 409, a backup
 *                restored over the profile, all end in one delivery.
 *   retries      A failure the far side may get over (a timeout, a 5xx, a 429) is tried again after
 *                backoffDelay(attempt): 30 s doubling to at most 6 h, give or take a quarter
 *                (jitter, so a receiver that was down is not hit by every job at the same second),
 *                eight tries over about an hour.
 *                A Retry-After the receiver sent wins when it is longer. After MAX_ATTEMPTS, or at
 *                once for a refusal that will never change (a 4xx), the job moves to `failed`,
 *                where the app's Retry button can bring it back.
 *   rate limit   Token buckets per provider and per connection (rateOf), so one profile's burst
 *                cannot hammer a receiver or use up a provider's quota for everyone. A job that
 *                finds no token waits for one without spending an attempt.
 *
 * Bounded: MAX_JOBS in all, MAX_PER_USER per profile, FAILED_MAX failures kept. `now` and `random`
 * are injectable so the tests can walk the clock. */
import fs from 'node:fs';
import { atomicWrite } from '../durable.js';

export const MAX_ATTEMPTS = 8;
export const BASE_MS = 30_000;
export const CAP_MS = 6 * 3600_000;
export const RETRY_AFTER_CAP_MS = 6 * 3600_000;
export const DONE_KEEP_MS = 45 * 86400_000;
export const DONE_MAX = 20_000;
export const MAX_JOBS = 5_000;
export const MAX_PER_USER = 200;
export const FAILED_MAX = 200;
export const PAYLOAD_MAX = 64 * 1024;

/** How long to wait before attempt `attempt + 1`, after `attempt` failures (1-based). */
export function backoffDelay(attempt, random = Math.random) {
  const raw = Math.min(CAP_MS, BASE_MS * 2 ** Math.max(0, attempt - 1));
  return Math.round(raw * (0.75 + 0.5 * random()));
}

/** Token buckets: `take(key, { capacity, refillMs })` answers 0 (go) or the ms until a token. */
export function createBuckets({ now = Date.now, maxKeys = 5000 } = {}) {
  const m = new Map();
  return {
    take(key, { capacity, refillMs }) {
      const t = now();
      let b = m.get(key);
      if (!b) {
        if (m.size >= maxKeys) m.delete(m.keys().next().value);
        b = { tokens: capacity, at: t };
      }
      // refillMs is the time one token takes to come back.
      b.tokens = Math.min(capacity, b.tokens + (t - b.at) / refillMs);
      b.at = t;
      m.delete(key); m.set(key, b);
      if (b.tokens >= 1) { b.tokens -= 1; return 0; }
      return Math.ceil((1 - b.tokens) * refillMs);
    },
    reset: () => m.clear(),
  };
}

const okKey = k => typeof k === 'string' && k.length > 0 && k.length <= 200;

export function createOutbox({ file, deliver, rateOf = () => [], onSettled = () => {}, now = Date.now, random = Math.random, concurrency = 2 }) {
  let st = { jobs: [], done: {}, failed: [] };
  try {
    const d = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (d && typeof d === 'object') {
      st.jobs = Array.isArray(d.jobs) ? d.jobs.filter(j => j && okKey(j.key)).slice(0, MAX_JOBS) : [];
      st.done = d.done && typeof d.done === 'object' && !Array.isArray(d.done) ? d.done : {};
      st.failed = Array.isArray(d.failed) ? d.failed.filter(j => j && okKey(j.key)).slice(-FAILED_MAX) : [];
    }
  } catch (e) { if (e.code !== 'ENOENT') console.error('integrations: outbox unreadable, starting empty', e.message); }
  // A job that was being sent when the process stopped is due again: at-least-once, and the
  // receiver gets the same delivery id to tell (docs/INTEGRATIONS.md).
  for (const j of st.jobs) delete j.running;

  const buckets = createBuckets({ now });
  let timer = null, kick = null, running = false;

  function prune() {
    const cut = now() - DONE_KEEP_MS;
    let keys = Object.keys(st.done).filter(k => st.done[k] >= cut);
    if (keys.length > DONE_MAX) keys = keys.sort((a, b) => st.done[a] - st.done[b]).slice(-DONE_MAX);
    if (keys.length !== Object.keys(st.done).length) st.done = Object.fromEntries(keys.map(k => [k, st.done[k]]));
  }
  function persist() {
    prune();
    try { atomicWrite(file, JSON.stringify(st), 0o600); }
    catch (e) { console.error('integrations: could not save the outbox', e.message); }
  }
  const soon = () => {
    if (kick || !timer) return;
    kick = setTimeout(() => { kick = null; run(); }, 20);
    kick.unref?.();
  };

  /** 'queued', 'duplicate' or 'full'. */
  function enqueue(job) {
    if (!okKey(job?.key)) throw new Error('job key required');
    if (st.done[job.key] || st.jobs.some(j => j.key === job.key) || st.failed.some(j => j.key === job.key)) return 'duplicate';
    if (st.jobs.length >= MAX_JOBS || st.jobs.filter(j => j.uid === job.uid).length >= MAX_PER_USER) return 'full';
    const body = JSON.stringify(job.payload ?? null);
    if (body.length > PAYLOAD_MAX) return 'full';
    st.jobs.push({
      id: job.id, key: job.key, uid: job.uid, conn: job.conn, provider: job.provider, ev: job.ev,
      payload: job.payload ?? null, attempts: 0, createdAt: now(), nextAt: now(),
    });
    persist();
    soon();
    return 'queued';
  }

  async function runOne(j) {
    // Rate limits first: no token is a wait, not a failure.
    for (const r of rateOf(j)) {
      const wait = buckets.take(r.key, r);
      if (wait > 0) { j.nextAt = now() + wait; return; }
    }
    j.running = true;
    let res;
    try { res = await deliver(j); }
    catch (e) { res = { ok: false, retry: true, msg: e?.message || 'delivery failed' }; }
    delete j.running;
    if (!st.jobs.includes(j)) return;                  // dropped meanwhile (disconnected)
    // Not now, and not a failure either (a paused connection): later, without spending an attempt.
    if (res?.defer) { j.nextAt = now() + res.defer; return; }
    j.attempts += 1;
    if (res?.ok) {
      st.jobs = st.jobs.filter(x => x !== j);
      st.done[j.key] = now();
      onSettled(j, res, { final: true });
      return;
    }
    const final = !res?.retry || j.attempts >= MAX_ATTEMPTS;
    if (final) {
      st.jobs = st.jobs.filter(x => x !== j);
      st.failed = [...st.failed, { ...j, failedAt: now(), msg: String(res?.msg || '').slice(0, 160) }].slice(-FAILED_MAX);
    } else {
      const after = Math.min(RETRY_AFTER_CAP_MS, Math.max(0, res.retryAfterMs || 0));
      j.nextAt = now() + Math.max(backoffDelay(j.attempts, random), after);
    }
    onSettled(j, res, { final });
  }

  /** Send what is due. One pass at a time; resolves when the pass is over. */
  async function run() {
    if (running) return;
    running = true;
    try {
      const due = st.jobs.filter(j => !j.running && j.nextAt <= now()).sort((a, b) => a.nextAt - b.nextAt);
      for (let i = 0; i < due.length; i += concurrency) {
        await Promise.all(due.slice(i, i + concurrency).map(runOne));
      }
      if (due.length) persist();
    } finally { running = false; }
  }

  return {
    enqueue,
    run,
    start(everyMs = 5000) { if (!timer) { timer = setInterval(run, everyMs); timer.unref?.(); } soon(); },
    stop() { clearInterval(timer); clearTimeout(kick); timer = null; kick = null; },
    /** The connection's failed jobs, queued again from attempt 0. Answers how many. */
    retry(uid, conn) {
      const back = st.failed.filter(j => j.uid === uid && j.conn === conn);
      if (!back.length) return 0;
      st.failed = st.failed.filter(j => !back.includes(j));
      for (const j of back) { delete j.failedAt; delete j.msg; st.jobs.push({ ...j, attempts: 0, nextAt: now() }); }
      persist(); soon();
      return back.length;
    },
    dropConnection(uid, conn) {
      const n = st.jobs.length + st.failed.length;
      st.jobs = st.jobs.filter(j => !(j.uid === uid && j.conn === conn));
      st.failed = st.failed.filter(j => !(j.uid === uid && j.conn === conn));
      if (st.jobs.length + st.failed.length !== n) persist();
    },
    dropUser(uid) {
      st.jobs = st.jobs.filter(j => j.uid !== uid);
      st.failed = st.failed.filter(j => j.uid !== uid);
      for (const k of Object.keys(st.done)) if (k.includes(':' + uid + ':')) delete st.done[k];
      persist();
    },
    counts(uid, conn) {
      const mine = j => j.uid === uid && j.conn === conn;
      return { queued: st.jobs.filter(mine).length, failed: st.failed.filter(mine).length };
    },
    snapshot: () => structuredClone(st),
  };
}
