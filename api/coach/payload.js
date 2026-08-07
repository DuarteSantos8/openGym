/* What actually leaves this server.
 *
 * The consent screen makes a promise about which categories of data reach the provider, and
 * this file is where that promise is either kept or quietly broken. So it is built as an
 * allowlist: every field is copied in by name. Nothing is spread, nothing is passed through,
 * and a field added to the state blob next year cannot ride along by accident — which is the
 * property the FR-11 test actually asserts.
 *
 * Excluded on purpose and permanently: the profile's display name and user id (an opaque
 * handle stands in), passkey and credential material, push subscriptions, invite data, theme
 * and appearance settings, and every other profile's everything.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const DATA = process.env.DATA_DIR || '/data';
const require_ = createRequire(import.meta.url);
const LIBRARY = require_('./library.json').exercises;
const LIB_BY_ID = new Map(LIBRARY.map(e => [e.id, e]));

export const CONTRACT = 1;
// Bounds from FR-22. A review reads a training block, not a training career: more history
// makes the payload bigger and the reading vaguer, not better.
export const MAX_WEEKS = 12;
export const MAX_SESSIONS = 60;

/* ---------- the data categories the consent screen names (FR-09/10) ----------
   Kept here, next to the code that acts on it, and rendered by the consent UI from the same
   list — a screen that drifts from the payload is worse than no screen. */
export const DATA_CATEGORIES = [
  'plan',        // routines, exercises, sets/reps, schedule, progression settings
  'training',    // logged sets, targets, effort ratings, durations, PRs in the review window
  'bodyweight',  // weigh-ins in the window and your goal weight
  'profile',     // the intake answers you gave the Coach, including any limitations
  'prefs'        // unit, language, effort scale
];

/** Stable per-profile pseudonym. Never the uid, never reversible, same across jobs. */
function handle(uid) {
  const secret = fs.readFileSync(path.join(DATA, 'secret'), 'utf8').trim();
  return crypto.createHmac('sha256', secret).update('coach-handle:' + uid).digest('base64url').slice(0, 16);
}

/* ---------- reading a session the way the engine reads it ----------
   Duplicated from frontend/src/lib/history.js rather than shared: the two runtimes have no
   build step in common, and this is the same trade-off server.js already made for
   effectiveRoutineId. coach-parity.test.js pins these against the frontend's own copies over
   a shared table of configs, so the duplicate cannot drift silently — which it otherwise
   would have, quietly, when v1.2.4 taught the app about bodyweight work. */
export const modeOf = (cfg, ex) => {
  const m = cfg && cfg.mode;
  if (m === 'reps' || m === 'time' || m === 'cardio') return m;
  return ex && ex.bp === 'cardio' ? 'cardio' : 'reps';
};

/* Two flags that ride on top of a mode rather than making new ones (upstream #31/#32), and
   both matter to the Coach for the same reason: on a bodyweight exercise `w` is *added* load,
   so it is 0 on a perfectly good session, and every load-shaped signal — volume, e1RM, "is it
   going up" — reads as a flat zero. A Coach that could not see this would look at a push-up
   progression that is working and propose adding weight to a push-up.

   Absent reads as false on every plan written before these existed, exactly as upstream. */
export const isBw = (cfg, ex) =>
  (cfg && cfg.bodyweight != null ? !!cfg.bodyweight : (ex && ex.eq) === 'body weight');
export const isPerSide = cfg => !!(cfg && cfg.side);
function readSession(entry, fallback) {
  const target = (entry && entry.target) || fallback || {};
  const ex = LIB_BY_ID.get(entry?.id);
  const mode = modeOf(target, ex);
  const bw = isBw(target, ex);
  const sets = (entry && entry.sets) || [];
  const planned = target.sets || sets.length;
  const enough = sets.length >= planned;
  if (mode === 'time') {
    const goal = target.sec || 0;
    const held = sets.map(s => (s.done ? (s.sec || 0) : 0));
    return { mode, bw, goal, ok: goal > 0 && enough && held.length > 0 && held.every(h => h >= goal) };
  }
  const goal = target.reps || 0;
  const reps = sets.map(s => (s.done ? (s.r || 0) : 0));
  // Set count is the dimension bodyweight work grows once reps hit their ceiling (upstream
  // #33), so it travels alongside the reps rather than being inferred from them downstream.
  const done = sets.filter(s => s.done).length;
  return { mode, bw, goal, count: done, ok: goal > 0 && enough && reps.length > 0 && reps.every(r => r >= goal) };
}
/** Consecutive misses counting back from the most recent session. */
export function stallCount(sessions) {
  let n = 0;
  for (let i = sessions.length - 1; i >= 0; i--) { if (sessions[i].ok) break; n++; }
  return n;
}

/* ---------- plan cleaning (mirrors plan-share.js cleanEx) ---------- */
function cleanEx(e) {
  const o = { id: e.id, name: LIB_BY_ID.get(e.id)?.n || null, sets: e.sets };
  const mode = modeOf(e, LIB_BY_ID.get(e.id));
  o.mode = mode;
  if (mode === 'cardio') {
    if (e.min != null) o.min = e.min;
    if (e.speed != null) o.speed = e.speed;
    // Without this the Coach cannot see that a 5 km run is a 5 km run.
    if (e.dist != null) o.dist = e.dist;
  }
  else if (mode === 'time') { if (e.sec != null) o.sec = e.sec; if (e.weight) o.weight = e.weight; }
  else { if (e.reps != null) o.reps = e.reps; if (e.weight) o.weight = e.weight; }
  if (e.prog) o.prog = e.prog;
  if (e.inc > 0) o.inc = e.inc;
  if (e.repsMin != null) o.repsMin = e.repsMin;
  // repsMax is the ceiling that turns "+1 rep forever" into "add a set and start over"; without
  // it the Coach cannot see, or propose, how a bodyweight exercise is meant to progress.
  if (e.repsMax != null) o.repsMax = e.repsMax;
  // Written out only when they disagree with the catalogue, matching plan-share.js — an
  // absent flag has always meant "whatever the exercise says", and still does.
  if (e.bodyweight != null) o.bodyweight = !!e.bodyweight;
  if (e.side) o.side = true;
  if (e.sg) o.sg = e.sg;
  return o;
}
/**
 * The plan reduced to exactly the fields that decide whether it has *changed* — mode-aware,
 * with every absent value written out as a zero so "no weight" and "0 kg" cannot hash apart.
 *
 * frontend/src/lib/coach.js mirrors this function field for field. That duplication is the
 * price of the two runtimes sharing no build step, and it is load-bearing: if the two ever
 * disagree, every proposal reads as stale and the feature quietly stops working. coach.test.js
 * pins them together against shared fixtures.
 */
export function canonicalPlan(S) {
  const custom = new Map((S.customEx || []).map(c => [c.id, c]));
  const exOf = id => LIB_BY_ID.get(id) || custom.get(id);
  return {
    routines: (S.routines || []).map(r => ({
      id: r.id, name: r.name || '', prog: r.prog || '',
      ex: (r.ex || []).map(e => {
        const mode = modeOf(e, exOf(e.id));
        return {
          id: e.id, mode, sets: e.sets || 0,
          reps: mode === 'reps' ? (e.reps || 0) : 0,
          sec: mode === 'time' ? (e.sec || 0) : 0,
          min: mode === 'cardio' ? (e.min || 0) : 0,
          speed: mode === 'cardio' ? (e.speed || 0) : 0,
          dist: mode === 'cardio' ? (e.dist || 0) : 0,
          weight: mode === 'cardio' ? 0 : (e.weight || 0),
          prog: e.prog || '', inc: e.inc || 0, repsMin: e.repsMin || 0, repsMax: e.repsMax || 0,
          // Resolved rather than copied: the fingerprint has to change when a plan starts
          // disagreeing with the catalogue, and `bodyweight: undefined` and an exercise the
          // dataset already calls bodyweight are the same plan and must hash the same.
          bodyweight: isBw(e, exOf(e.id)), side: isPerSide(e),
          sg: e.sg || ''
        };
      })
    })),
    week: Object.fromEntries([1, 2, 3, 4, 5, 6, 0].filter(d => S.week?.[d]).map(d => [d, S.week[d]]))
  };
}

export function cleanPlan(S) {
  const routines = (S.routines || []).map(r => ({
    id: r.id, name: r.name, emoji: r.emoji, ...(r.prog ? { prog: r.prog } : {}), ex: (r.ex || []).map(cleanEx)
  }));
  const week = {};
  [1, 2, 3, 4, 5, 6, 0].forEach(d => { if (S.week?.[d]) week[d] = S.week[d]; });
  return { routines, week };
}

/* ---------- the library slice the model gets to choose from ---------- */
export function librarySlice(S, equipment) {
  const wanted = (equipment || []).map(x => String(x).toLowerCase());
  const customs = (S.customEx || []).map(c => ({ id: c.id, n: c.n, bp: c.bp, tg: null, eq: 'custom', custom: true }));
  // No equipment stated (or "everything") ⇒ the whole catalogue. Filtering to nothing would
  // leave the Coach unable to propose anything at all, which is a worse failure than a
  // slightly larger payload.
  const base = wanted.length ? LIBRARY.filter(e => wanted.includes((e.eq || '').toLowerCase())) : LIBRARY;
  return [...customs, ...(base.length ? base : LIBRARY)];
}
export const libraryHas = id => LIB_BY_ID.has(id);
export const libraryName = id => LIB_BY_ID.get(id)?.n || null;
export { LIBRARY };

/* ---------- effort scale (mirrors history.js effortOf) ---------- */
const effortOf = S => {
  const e = S && S.effort;
  return e === 'none' || e === 'rir' || e === 'rpe' ? e : (S && S.showRir ? 'rir' : 'none');
};

/* ---------- window + aggregates ---------- */
const iso = d => d.toISOString().slice(0, 10);

export function reviewWindow(S, since) {
  const all = (S.workouts || []).filter(w => w && w.d);
  const cutoffDate = new Date(); cutoffDate.setDate(cutoffDate.getDate() - MAX_WEEKS * 7);
  const cutoff = iso(cutoffDate);
  const from = since && since > cutoff ? since : cutoff;
  return all.filter(w => w.d >= from).slice(-MAX_SESSIONS);
}

function aggregates(S, workouts) {
  // Per-exercise stall/deload picture, computed over the same sessions the engine would see.
  const byEx = new Map();
  const planCfg = new Map();
  (S.routines || []).forEach(r => (r.ex || []).forEach(e => planCfg.set(e.id, e)));
  (S.workouts || []).forEach(w => (w.entries || []).forEach(en => {
    if (!en.sets?.some(s => s.done)) return;
    if (!byEx.has(en.id)) byEx.set(en.id, []);
    byEx.get(en.id).push(readSession(en, planCfg.get(en.id)));
  }));
  const exercises = [];
  for (const [id, sessions] of byEx) {
    const stalls = stallCount(sessions);
    if (stalls > 0 || sessions.length >= 3) {
      exercises.push({ id, name: libraryName(id), sessions: sessions.length, stalls, lastOk: !!sessions[sessions.length - 1]?.ok });
    }
  }

  // Adherence: what the week asked for against what actually happened.
  const trained = new Set(workouts.map(w => w.d));
  const plannedDays = Object.keys(S.week || {}).filter(k => S.week[k]).length;
  const reschedules = Object.entries(S.dayPlan || {}).filter(([d]) => workouts.some(w => w.d === d) || d >= (workouts[0]?.d || '')).length;

  // Muscle coverage in the window, by body part — the "not trained" gap the Stats screen shows.
  const hit = {};
  workouts.forEach(w => (w.entries || []).forEach(en => {
    if (!en.sets?.some(s => s.done)) return;
    const bp = LIB_BY_ID.get(en.id)?.bp;
    if (bp) hit[bp] = (hit[bp] || 0) + en.sets.filter(s => s.done).length;
  }));

  const durations = workouts.map(w => (w.end && w.start ? Math.round((w.end - w.start) / 60000) : null)).filter(Boolean);
  return {
    exercises,
    adherence: { plannedPerWeek: plannedDays, sessionsInWindow: workouts.length, distinctDays: trained.size, dayOverrides: reschedules },
    setsByBodyPart: hit,
    sessionMinutes: durations.length
      ? { median: durations.slice().sort((a, b) => a - b)[Math.floor(durations.length / 2)], min: Math.min(...durations), max: Math.max(...durations) }
      : null
  };
}

/** One workout, reduced to what a coach reads. */
function cleanWorkout(w) {
  return {
    d: w.d,
    name: w.name || null,
    minutes: w.end && w.start ? Math.round((w.end - w.start) / 60000) : null,
    ...(w.rating ? { rating: w.rating } : {}),
    ...(w.note ? { note: String(w.note).slice(0, 300) } : {}),
    prs: (w.prs || []).length,
    entries: (w.entries || []).map(en => ({
      id: en.id,
      name: libraryName(en.id),
      target: en.target ? { sets: en.target.sets, reps: en.target.reps, sec: en.target.sec, weight: en.target.weight } : null,
      sets: (en.sets || []).map(s => {
        const o = { done: !!s.done };
        if (s.w != null) o.w = s.w;
        if (s.r != null) o.r = s.r;
        if (s.sec != null) o.sec = s.sec;
        if (s.min != null) o.min = s.min;
        if (s.speed != null) o.speed = s.speed;
        if (s.rir != null) o.rir = s.rir;
        if (s.rpe != null) o.rpe = s.rpe;
        return o;
      })
    }))
  };
}

/**
 * Build a job payload.
 *
 * @param {object} S      the profile's synced state, as read from disk
 * @param {string} uid    used only to derive the opaque handle
 * @param {object} opts   { kind, intake?, note?, refine?, previous? }
 */
export function build(S, uid, opts = {}) {
  const coach = S.coach || {};
  const profile = opts.intake || coach.profile || null;
  const p = {
    coach_contract: CONTRACT,
    task: opts.kind === 'review' ? 'review' : 'create',
    meta: {
      profile: handle(uid),
      lang: S.lang || 'en',
      unit: S.unit || 'kg',
      effortScale: effortOf(S),
      today: iso(new Date())
    },
    coachProfile: profile ? {
      goal: profile.goal || null,
      experience: profile.experience || null,
      daysPerWeek: profile.daysPerWeek || null,
      preferredDays: profile.preferredDays || [],
      sessionMin: profile.sessionMin || null,
      equipment: profile.equipment || [],
      limitations: profile.limitations || '',
      likes: profile.likes || '',
      dislikes: profile.dislikes || '',
      notes: profile.notes || ''
    } : null,
    plan: cleanPlan(S)
  };

  // What the user already turned down, so the Coach does not re-propose it without new
  // evidence (FR-26). Summaries only — the log's full before/after stays on the device.
  const declined = (coach.log || [])
    .flatMap(e => (e.decisions || []).filter(d => d.status === 'rejected').map(d => ({ type: d.type, why: d.why })))
    .slice(-15);
  if (declined.length) p.previouslyDeclined = declined;

  if (opts.kind === 'review') {
    const workouts = reviewWindow(S, coach.lastReview?.at ? String(coach.lastReview.at).slice(0, 10) : null);
    p.window = {
      from: workouts[0]?.d || null,
      to: workouts[workouts.length - 1]?.d || null,
      workouts: workouts.map(cleanWorkout)
    };
    p.aggregates = aggregates(S, workouts);
    p.bodyweight = {
      goal: S.targetW ?? null,
      series: (S.bodyweight || []).filter(b => !p.window.from || b.d >= p.window.from).map(b => ({ d: b.d, w: b.w }))
    };
    if (opts.note) p.userNote = String(opts.note).slice(0, 1000);
    p.library = librarySlice(S, profile?.equipment);
  } else {
    p.library = librarySlice(S, profile?.equipment);
    // Creation for a returning user: what they have actually handled, so proposed baselines
    // start from evidence rather than optimism (B2/FR-20).
    const best = {};
    (S.workouts || []).forEach(w => (w.entries || []).forEach(en => en.sets?.forEach(s => {
      if (s.done && s.w > 0) best[en.id] = Math.max(best[en.id] || 0, s.w);
    })));
    if (Object.keys(best).length) {
      p.history = {
        sessions: (S.workouts || []).length,
        since: (S.workouts || [])[0]?.d || null,
        workingWeights: Object.entries(best).map(([id, w]) => ({ id, name: libraryName(id), best: w }))
      };
    }
    if (opts.refine) {
      p.refine = { text: String(opts.refine).slice(0, 1000), previous: opts.previous || null };
    }
  }
  return p;
}
