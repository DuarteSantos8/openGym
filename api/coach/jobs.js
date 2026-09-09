/* Running Coach jobs, and owning their results.
 *
 * Why the server owns proposals instead of the synced state blob: a client PUTs its whole
 * state and the newest `_ts` wins. A scheduled review that wrote its proposal in there would
 * be erased without trace by the next device to sync an older copy. So the proposal lives
 * here, in a file this server alone writes, until the user decides what to do with it — at
 * which point the *client* applies it to the plan and the outcome joins the synced log, which
 * is exactly where an audit trail belongs.
 *
 * Everything here is deliberately in-process and file-backed. A single-core box running one
 * household's gym app does not need a job queue with a broker; it needs jobs that cannot pile
 * up, cannot run forever, and cannot lie about what happened when the container restarts.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import * as cfgStore from './config.js';
import { adapterFor } from './adapters/index.js';
import * as payloadLib from './core/payload.js';
import { runPipeline } from './core/pipeline.js';
import { extractJSON } from './core/parse.js';
import { hashPlan } from './core/plan-hash.js';
import { buildPrompt } from './core/prompt.js';
import { handleFor } from './handle.js';
import { fetchFor } from './node-fetch.js';
import { canDropPrivileges, unprivilegedIds } from './adapters/spawn.js';
import { cohortForPayload, invalidate as invalidateCohort } from './cohort.js';

// The prompt assembly, the plan fingerprint and the invoke→parse→validate→repair loop all
// live in ./core now, where the phone can import them too. Re-exported so nothing that
// reached them through this module has to move.
export { hashPlan, buildPrompt };

const DATA = process.env.DATA_DIR || '/data';
const COACH_DIR = path.join(DATA, 'coach');

// Five minutes by default. A local model on a small CPU box can legitimately need more; a
// cloud API that needs more has a problem. COACH_JOB_TIMEOUT_MS overrides, never below one minute.
export const TIMEOUT_MS = Math.max(60000, +process.env.COACH_JOB_TIMEOUT_MS || 5 * 60000);
const MAX_CONCURRENT = 2;          // these are minutes-scale jobs on often-single-core boxes
const PENDING_DAYS = 14;           // FR-33
const HISTORY_MAX = 20;

/* ---------- per-user store ---------- */

const safe = uid => String(uid).replace(/[^a-zA-Z0-9_-]/g, '');
const userFile = uid => path.join(COACH_DIR, safe(uid) + '.json');
const EMPTY = { daily: null, current: null, pending: null, history: [] };

export function readUser(uid) {
  try { return { ...EMPTY, ...JSON.parse(fs.readFileSync(userFile(uid), 'utf8')) }; }
  catch { return { ...EMPTY }; }
}
function writeUser(uid, rec) {
  fs.mkdirSync(COACH_DIR, { recursive: true, mode: 0o700 });
  const file = userFile(uid), tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(rec), { mode: 0o600 });
  fs.renameSync(tmp, file);
}
function patchUser(uid, patch) {
  const rec = { ...readUser(uid), ...patch };
  writeUser(uid, rec);
  return rec;
}
/** Consent revoked, profile deleted, "reset everything" — no server-side residue (FR-51). */
export function clearUser(uid) {
  try { fs.unlinkSync(userFile(uid)); } catch { /* nothing to clear */ }
}

/** Every profile with a state file — the population a cohort is drawn from. */
export function listUserIds() {
  try {
    return fs.readdirSync(DATA).filter(f => /^state-[a-zA-Z0-9_-]+\.json$/.test(f)).map(f => f.slice(6, -5));
  } catch { return []; }
}

/* ---------- "compare with others" opt-in ----------
   Held here, in the server's own per-profile record, rather than in the synced state: the
   flag decides whether this person's numbers reach other people, and a stale device syncing
   an older copy of S must not be able to flip it back on. */
export const isSharing = uid => !!readUser(uid).share;
export function setShare(uid, share) {
  patchUser(uid, { share: !!share });
  invalidateCohort();
  return !!share;
}

export function readState(uid) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA, 'state-' + safe(uid) + '.json'), 'utf8')); }
  catch { return null; }
}

/* ---------- caps ---------- */

const todayISO = () => new Date().toISOString().slice(0, 10);
function bumpDaily(uid) {
  const rec = readUser(uid);
  const d = todayISO();
  const daily = rec.daily?.date === d ? { date: d, count: rec.daily.count + 1 } : { date: d, count: 1 };
  patchUser(uid, { daily });
  return daily.count;
}
export function capState(uid) {
  const caps = cfgStore.load().caps || {};
  const rec = readUser(uid);
  const used = rec.daily?.date === todayISO() ? rec.daily.count : 0;
  return { used, limit: caps.perProfileDaily || 0 };
}
function instanceUsedToday() {
  const d = todayISO();
  return (cfgStore.load().log || []).filter(e => (e.at || '').slice(0, 10) === d).length;
}

/* ---------- status ---------- */

/** What the client polls. Expiry is enforced lazily here rather than on a timer. */
export function status(uid) {
  const rec = readUser(uid);
  if (rec.pending && rec.pending.expiresAt && rec.pending.expiresAt < Date.now()) {
    archive(uid, rec, 'expired');
    // Same shape as every other answer: the poll that happens to be the one which expires a
    // proposal must not be the one where the client's cap readout goes undefined.
    return { job: null, pending: null, cap: capState(uid) };
  }
  return {
    job: rec.current ? { id: rec.current.id, kind: rec.current.kind, state: rec.current.state, startedAt: rec.current.startedAt } : null,
    pending: rec.pending || null,
    cap: capState(uid),
    // How the most recent job ended, so the chat can say "nothing to change" or "that failed"
    // in the Coach's own bubble rather than leaving a job that silently stopped appearing.
    last: lastOutcome(rec)
  };
}
function lastOutcome(rec) {
  const h = (rec.history || []).at(-1);
  return h ? { id: h.id, kind: h.kind, outcome: h.outcome, errorClass: h.errorClass || null, at: h.at, ...(h.reading ? { reading: h.reading } : {}) } : null;
}
function archive(uid, rec, outcome) {
  const history = [...(rec.history || []), {
    id: rec.pending?.id, kind: rec.pending?.kind, outcome, at: Date.now()
  }].slice(-HISTORY_MAX);
  patchUser(uid, { pending: null, history });
}

/* ---------- the queue ---------- */

const queue = [];
let running = 0;
const inflight = new Set();     // uids with a job queued or running (FR-07 single-flight)

class CoachError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
export { CoachError };

/**
 * Enqueue a job. Throws CoachError with a code the routes layer maps to an HTTP status:
 * `off`, `busy`, `cap`, `consent`.
 */
export function enqueue(uid, opts) {
  if (!cfgStore.isEnabled() || !cfgStore.isConnected()) throw new CoachError('off', 'the Coach is not set up on this instance');
  if (inflight.has(uid)) throw new CoachError('busy', 'the Coach is already thinking about your training');

  const S = readState(uid);
  // Consent is enforced here, server-side, not by the screen that collects it: a UI-only gate
  // is not a gate (FR-08/13).
  if (!S?.coach?.consent?.agreedAt) throw new CoachError('consent', 'the Coach needs your go-ahead first');

  // Whose account pays. In instance mode the credential binds to the first profile that spends
  // it and every other profile is refused outright — not warned. A warning would move the
  // decision onto whoever clicks past it, and the decision is about spending somebody else's
  // personal subscription.
  const cred = cfgStore.credentialFor(uid);
  if (!cred.ok) {
    if (cred.reason === 'shared-account') throw new CoachError('shared', cred.message);
    throw new CoachError('off', 'this profile has no provider account connected');
  }
  // Spending is what binds: a personal credential (setup token, OAuth) belongs to the first
  // profile that runs a job on it from here on; an API key binds to nobody and is shared.
  cfgStore.bindInstanceCredential(uid);

  // The privilege drop is what keeps a provider runtime out of ./data. If it cannot be
  // performed, there is no job — see canDropPrivileges for why this is not a warning either.
  // A provider that spawns nothing has no process to drop, and is not refused for it.
  if (adapterFor(cfgStore.load().provider)?.spawns !== false) {
    const priv = canDropPrivileges();
    if (!priv.ok) throw new CoachError('unprivileged', `Coach jobs are disabled: ${priv.why}`);
  }

  const caps = cfgStore.load().caps || {};
  const { used, limit } = capState(uid);
  if (limit > 0 && used >= limit) throw new CoachError('cap', 'daily limit reached');
  if (caps.instanceDaily > 0 && instanceUsedToday() >= caps.instanceDaily) throw new CoachError('cap', 'this instance has reached its daily limit');

  // Counted at enqueue, not at completion: the cap exists to bound what one profile can spend
  // of the owner's provider account, and queueing twenty jobs spends it whether or not the
  // twentieth ever finishes.
  bumpDaily(uid);

  const job = {
    id: crypto.randomBytes(8).toString('hex'),
    uid,
    kind: opts.kind,                                  // 'create' | 'review' | 'debrief'
    trigger: opts.trigger || 'manual',                // 'manual' | 'scheduled'
    workoutId: opts.workoutId ? String(opts.workoutId).slice(0, 40) : null,
    intake: opts.intake || null,
    note: opts.note || null,
    refine: opts.refine || null,
    state: 'queued',
    startedAt: Date.now()
  };
  inflight.add(uid);
  patchUser(uid, { current: { id: job.id, kind: job.kind, state: 'queued', startedAt: job.startedAt } });
  queue.push(job);
  pump();
  return { id: job.id };
}

function pump() {
  while (running < MAX_CONCURRENT && queue.length) {
    const job = queue.shift();
    running++;
    execute(job)
      .catch(e => { console.error('coach job crashed', job.id, e); finish(job, { outcome: 'failed', errorClass: 'internal' }); })
      .finally(() => { running--; inflight.delete(job.uid); pump(); });
  }
}

function finish(job, result) {
  const rec = readUser(job.uid);
  const history = [...(rec.history || []), {
    id: job.id, kind: job.kind, trigger: job.trigger, outcome: result.outcome,
    errorClass: result.errorClass || null, at: Date.now(),
    // "Nothing to change" is an answer with a reason attached, and throwing the reason away
    // leaves the user with a job that finished and nothing to show for it. It lives here, in
    // the profile's own file — deliberately not in `detail`, which goes to the instance log
    // the admin card renders, and which carries counts and outcomes only (FR-12/42).
    ...(result.reading ? { reading: String(result.reading).slice(0, 1200) } : {})
  }].slice(-HISTORY_MAX);
  writeUser(job.uid, {
    ...rec,
    current: null,
    pending: result.pending !== undefined ? result.pending : rec.pending,
    history
  });
  cfgStore.logJob({
    at: new Date().toISOString(), uid: job.uid, kind: job.kind, trigger: job.trigger,
    outcome: result.outcome, errorClass: result.errorClass || null,
    ms: Date.now() - job.startedAt, detail: result.detail || null
  });
  if (result.outcome === 'ready' && onProposal) {
    try { onProposal(job.uid, result.pending, job); } catch (e) { console.error('coach notify failed', e); }
  }
}

// Set by server.js so a finished job can raise a push notification without this module
// importing the web-push plumbing (and dragging it into every test that touches the queue).
let onProposal = null;
export function setProposalHook(fn) { onProposal = fn; }

/* ---------- execution ---------- */

async function execute(job) {
  patchUser(job.uid, { current: { id: job.id, kind: job.kind, state: 'running', startedAt: job.startedAt } });

  const S = readState(job.uid);
  if (!S) return finish(job, { outcome: 'failed', errorClass: 'nostate' });

  const cfg = cfgStore.load();
  const adapter = adapterFor(cfg.provider);
  if (!adapter) return finish(job, { outcome: 'failed', errorClass: 'off' });

  if (job.kind === 'debrief' && !payloadLib.findWorkout(S, job.workoutId)) {
    return finish(job, { outcome: 'failed', errorClass: 'noworkout' });
  }

  const pendingCreate = job.refine ? readUser(job.uid).pending : null;
  const payload = payloadLib.build(S, {
    handle: handleFor(job.uid),
    kind: job.kind,
    intake: job.intake,
    note: job.note,
    refine: job.refine,
    previous: pendingCreate?.bundle || null,
    workoutId: job.workoutId,
    // The room's medians ride along on a review or a debrief when the admin allows it and
    // this person opted in; null otherwise, and the payload then carries no `cohort` at all.
    cohort: (job.kind === 'review' || job.kind === 'debrief') ? cohortForPayload(job.uid) : null
  });

  // An HTTPS provider has no child process, so no directory for one to live in either.
  const jobDir = adapter.spawns === false ? null : fs.mkdtempSync(path.join(os.tmpdir(), 'coach-'));
  const env = cfgStore.jobEnv(jobDir || os.tmpdir(), cfgStore.credentialFor(job.uid));
  try {
    const ids = jobDir && unprivilegedIds();
    if (ids) fs.chownSync(jobDir, ids.uid, ids.gid);

    const attempt = await runPipeline({
      adapter, cfg, kind: job.kind, payload, model: cfgStore.modelFor(cfg), timeoutMs: TIMEOUT_MS,
      // The HTTP adapters take the fetch they are given; the runtime adapters ignore it.
      invokeOpts: { jobDir, env, fetch: fetchFor(TIMEOUT_MS) }
    });
    if (!attempt.ok) {
      return finish(job, { outcome: 'failed', errorClass: attempt.errorClass, detail: attempt.detail });
    }
    if (attempt.nochange) {
      return finish(job, { outcome: 'nochange', pending: null, detail: null, reading: attempt.reading });
    }
    const pending = {
      id: job.id,
      kind: job.kind,
      createdAt: Date.now(),
      expiresAt: Date.now() + PENDING_DAYS * 86400000,
      planHash: hashPlan(payloadLib.canonicalPlan(S)),
      iteration: job.refine ? (pendingCreate?.iteration || 1) + 1 : 1,
      // A debrief names the session it read, so the card can show it after the fact.
      ...(job.kind === 'debrief' ? { workout: payloadLib.workoutMeta(S, job.workoutId) } : {}),
      ...attempt.result
    };
    return finish(job, { outcome: 'ready', pending });
  } finally {
    if (jobDir) fs.rmSync(jobDir, { recursive: true, force: true });
  }
}

/* ---------- decisions ---------- */

/** The client has applied (or discarded) the pending proposal. Record it and clear. */
export function resolvePending(uid, { accepted = [], rejected = [], dismissed = false } = {}) {
  const rec = readUser(uid);
  if (!rec.pending) return { ok: true };
  const history = [...(rec.history || []), {
    id: rec.pending.id, kind: rec.pending.kind,
    outcome: dismissed ? 'dismissed' : 'applied',
    accepted: accepted.length, rejected: rejected.length, at: Date.now()
  }].slice(-HISTORY_MAX);
  writeUser(uid, { ...rec, pending: null, history });
  return { ok: true };
}

/* ---------- admin test + boot recovery ---------- */

/** A2's "Test the Coach": the real adapter, a trivial round-trip, no user data anywhere near it. */
export async function testRun() {
  const cfg = cfgStore.load();
  const adapter = adapterFor(cfg.provider);
  if (!adapter) return { ok: false, error: 'no provider configured' };
  const jobDir = adapter.spawns === false ? null : fs.mkdtempSync(path.join(os.tmpdir(), 'coach-test-'));
  try {
    // No user asked for this, so there is no profile whose account is being spent. In instance
    // mode that is the bound profile's credential — the one the round-trip is meant to prove —
    // and in per-profile mode it is nobody's, which is the honest answer: an admin cannot test
    // a credential that belongs to a profile.
    const env = cfgStore.jobEnv(jobDir || os.tmpdir(), cfgStore.credentialFor(cfgStore.boundUidFor(cfg)));
    const ids = jobDir && unprivilegedIds();
    if (ids) fs.chownSync(jobDir, ids.uid, ids.gid);
    const check = await adapter.check(cfg, env);
    if (!check.ok) return { ok: false, error: check.error || 'the provider runtime could not be run' };
    const r = await adapter.invoke({
      cfg, jobDir, env, model: cfgStore.modelFor(cfg), timeoutMs: 90000, fetch: fetchFor(90000),
      prompt: 'Reply with exactly this JSON object and nothing else: {"coach_contract":1,"ok":true}'
    });
    if (r.timedOut) return { ok: false, version: check.version, error: 'the provider did not answer in time' };
    if (r.code !== 0) {
      const err = (r.stderr || r.text || '').trim();
      return { ok: false, version: check.version, error: err.slice(0, 300) || 'the provider runtime exited with an error' };
    }
    const parsed = extractJSON(r.text);
    if (parsed.error || !parsed.value?.ok) {
      return { ok: false, version: check.version, error: 'the provider answered, but not in the expected shape' };
    }
    return { ok: true, version: check.version };
  } finally {
    if (jobDir) fs.rmSync(jobDir, { recursive: true, force: true });
  }
}

/**
 * A job that was running when the process died is not coming back. Say so plainly and let the
 * user retry, rather than leaving a spinner that never resolves or silently re-running work
 * that may already have cost them a provider call.
 */
export function recoverOnBoot() {
  let n = 0;
  try {
    for (const f of fs.readdirSync(COACH_DIR)) {
      if (!f.endsWith('.json')) continue;
      const uid = f.replace(/\.json$/, '');
      const rec = readUser(uid);
      if (!rec.current) continue;
      writeUser(uid, {
        ...rec, current: null,
        history: [...(rec.history || []), { id: rec.current.id, kind: rec.current.kind, outcome: 'failed', errorClass: 'restart', at: Date.now() }].slice(-HISTORY_MAX)
      });
      n++;
    }
  } catch { /* no coach dir yet */ }
  if (n) console.log(`coach: cleared ${n} job(s) interrupted by restart`);
  return n;
}
