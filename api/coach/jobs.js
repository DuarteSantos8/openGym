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
import { fileURLToPath } from 'node:url';
import * as cfgStore from './config.js';
import { adapterFor } from './adapters/index.js';
import * as payloadLib from './payload.js';
import { extractJSON, contractOK } from './parse.js';
import { validatePlan, validateReview } from './validate.js';
import { canDropPrivileges, unprivilegedIds } from './adapters/spawn.js';

const DATA = process.env.DATA_DIR || '/data';
const COACH_DIR = path.join(DATA, 'coach');
const PROMPTS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'prompts');

export const TIMEOUT_MS = 5 * 60000;
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
    cap: capState(uid)
  };
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

  // The privilege drop is what keeps a provider runtime out of ./data. If it cannot be
  // performed, there is no job — see canDropPrivileges for why this is not a warning either.
  const priv = canDropPrivileges();
  if (!priv.ok) throw new CoachError('unprivileged', `Coach jobs are disabled: ${priv.why}`);

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
    kind: opts.kind,                                  // 'create' | 'review'
    trigger: opts.trigger || 'manual',                // 'manual' | 'scheduled'
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

/* ---------- prompt assembly ---------- */

const promptCache = new Map();
function promptPart(name) {
  if (!promptCache.has(name)) promptCache.set(name, fs.readFileSync(path.join(PROMPTS, name), 'utf8'));
  return promptCache.get(name);
}
export function buildPrompt(kind, payload, repair) {
  const task = kind === 'review' ? 'review.md' : payload.refine ? 'refine.md' : 'create.md';
  let out = promptPart('common.md') + '\n\n---\n\n' + promptPart(task) +
    '\n\n---\n\n## Payload\n\n```json\n' + JSON.stringify(payload, null, 1) + '\n```\n';
  if (repair) {
    out += '\n\n---\n\n' + promptPart('repair.md')
      .replace('{{PREVIOUS}}', String(repair.previous || '').slice(0, 4000))
      .replace('{{ERRORS}}', repair.errors.map(e => '- ' + e).join('\n'));
  }
  return out;
}

/* ---------- execution ---------- */

async function execute(job) {
  patchUser(job.uid, { current: { id: job.id, kind: job.kind, state: 'running', startedAt: job.startedAt } });

  const S = readState(job.uid);
  if (!S) return finish(job, { outcome: 'failed', errorClass: 'nostate' });

  const cfg = cfgStore.load();
  const adapter = adapterFor(cfg.provider);
  if (!adapter) return finish(job, { outcome: 'failed', errorClass: 'off' });

  const pendingCreate = job.refine ? readUser(job.uid).pending : null;
  const payload = payloadLib.build(S, job.uid, {
    kind: job.kind,
    intake: job.intake,
    note: job.note,
    refine: job.refine,
    previous: pendingCreate?.bundle || null
  });

  const jobDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coach-'));
  const env = cfgStore.jobEnv(jobDir, cfgStore.credentialFor(job.uid));
  try {
    const ids = unprivilegedIds();
    if (ids) fs.chownSync(jobDir, ids.uid, ids.gid);

    let attempt = await invoke(adapter, cfg, payload, jobDir, env, job, null);
    if (!attempt.ok && attempt.repairable) {
      // One repair round, then done (FR-48). Two failures is a provider problem, not a
      // prompting problem, and a retry loop against a paid API is a bad way to find out.
      attempt = await invoke(adapter, cfg, payload, jobDir, env, job, {
        previous: attempt.raw, errors: attempt.errors
      });
    }
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
      ...attempt.result
    };
    return finish(job, { outcome: 'ready', pending });
  } finally {
    fs.rmSync(jobDir, { recursive: true, force: true });
  }
}

async function invoke(adapter, cfg, payload, jobDir, env, job, repair) {
  const prompt = buildPrompt(job.kind, payload, repair);
  const r = await adapter.invoke({ cfg, prompt, jobDir, env, model: cfg.model || null, timeoutMs: TIMEOUT_MS });

  if (r.timedOut) return { ok: false, errorClass: 'timeout' };
  if (r.spawnError) return { ok: false, errorClass: 'missing', detail: r.stderr?.slice(0, 300) };
  if (r.code !== 0) {
    const err = (r.stderr || r.text || '').toLowerCase();
    const authish = /auth|unauthor|api key|credential|token|401|403|login/.test(err);
    return { ok: false, errorClass: authish ? 'auth' : 'provider', detail: (r.stderr || r.text || '').slice(0, 300) };
  }

  const parsed = extractJSON(r.text);
  if (parsed.error) return { ok: false, repairable: !repair, errors: [parsed.error], raw: r.text, errorClass: 'unusable' };
  if (!contractOK(parsed.value)) {
    return { ok: false, repairable: !repair, errors: [`coach_contract must be ${payloadLib.CONTRACT}`], raw: r.text, errorClass: 'unusable' };
  }

  // The seam PR 1 left open. Everything above is transport: did a process run, did it exit
  // cleanly, is there a JSON object in what it said, does it claim the contract this build
  // speaks. None of it has judged whether the contents are safe to act on. That judgement is
  // validate.js's, and the validator — not the prompt — is the security boundary.
  //
  // Its errors join the parse failures above on the same one repair round: a model that named
  // an exercise that does not exist is told which one, and usually gets it right the second
  // time. A model that cannot be told is a failed job, not a retry loop.
  const checked = job.kind === 'review'
    ? validateReview(parsed.value, payload.plan)
    : validatePlan(parsed.value, {
      workingWeights: payload.history?.workingWeights,
      daysPerWeek: payload.coachProfile?.daysPerWeek
    });

  if (!checked.ok) return { ok: false, repairable: !repair, errors: checked.errors, raw: r.text, errorClass: 'unusable' };
  if (checked.nochange) return { ok: true, nochange: true, reading: checked.reading };
  return { ok: true, result: checked.proposal || { bundle: checked.bundle, summary: checked.bundle.summary } };
}

/**
 * Fingerprint of the plan a proposal was computed against (FR-32). Takes the output of
 * `canonicalPlan`, so both runtimes hash the same normalised shape; the client mirrors this
 * function exactly. A mismatch therefore means the plan genuinely moved — not that two
 * implementations disagree about key order or about what "no weight" looks like.
 *
 * The field list must stay in step with `canonicalPlan`. It did not: that function learned
 * `repsMax`, `bodyweight` and `side` when the payload did, and this one kept hashing the
 * pre-1.2.4 list, so a plan whose rep ceiling had been raised by hand fingerprinted as
 * untouched — which is exactly the edit a proposal about bodyweight progression is stalest
 * against.
 */
export function hashPlan(plan) {
  const canon = JSON.stringify({
    routines: (plan?.routines || []).map(r => [r.id, r.name, r.prog, (r.ex || []).map(e =>
      [e.id, e.mode, e.sets, e.reps, e.sec, e.min, e.speed, e.dist, e.weight, e.prog, e.inc,
        e.repsMin, e.repsMax, e.bodyweight, e.side, e.sg].join(':')
    )]),
    week: Object.keys(plan?.week || {}).sort().map(k => k + '=' + plan.week[k])
  });
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < canon.length; i++) {
    const c = canon.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ ((c << 3) | i & 7), 0x85ebca6b) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
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
  const jobDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coach-test-'));
  try {
    // No user asked for this, so there is no profile whose account is being spent. In instance
    // mode that is the bound profile's credential — the one the round-trip is meant to prove —
    // and in per-profile mode it is nobody's, which is the honest answer: an admin cannot test
    // a credential that belongs to a profile.
    const env = cfgStore.jobEnv(jobDir, cfgStore.credentialFor(cfg.boundUid));
    const ids = unprivilegedIds();
    if (ids) fs.chownSync(jobDir, ids.uid, ids.gid);
    const check = await adapter.check(cfg, env);
    if (!check.ok) return { ok: false, error: check.error || 'the provider runtime could not be run' };
    const r = await adapter.invoke({
      cfg, jobDir, env, model: cfg.model || null, timeoutMs: 90000,
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
    fs.rmSync(jobDir, { recursive: true, force: true });
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
