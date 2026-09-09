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
import { LIBRARY, LIB_BY_ID, libraryHas, libraryName, librarySlice, MAX_LIBRARY } from './library.js';

export const CONTRACT = 1;
// Bounds from FR-22. A review reads a training block, not a training career: more history
// makes the payload bigger and the reading vaguer, not better.
export const MAX_WEEKS = 12;
export const MAX_SESSIONS = 60;

/* ---------- the data categories the consent screen names (FR-09/10) ----------
   Kept here, next to the code that acts on it, and rendered by the consent UI from the same
   list — a screen that drifts from the payload is worse than no screen. */
export { DATA_CATEGORIES } from './categories.js';

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
// Mirror of frontend/src/lib/workout-model.js isWarmupRow: an explicit phase wins, else the
// legacy boolean. A warm-up row is prep, not the session: it is filtered out of the stall
// count exactly as progression.js filters it, it never counts as a done set or a top set,
// and where it does travel (the last few sessions in full) it is flagged so the model reads
// "0x12 warm-up" as what it is rather than as a failed set.
export const isWarmupSet = s => {
  const ph = typeof s?.phase === 'string' ? s.phase.trim().toLowerCase() : '';
  if (ph) return ph === 'warmup' || ph === 'warm-up' || ph === 'warm_up';
  return s?.warmup === true;
};
function readSession(entry, fallback) {
  const target = (entry && entry.target) || fallback || {};
  const ex = LIB_BY_ID.get(entry?.id);
  const mode = modeOf(target, ex);
  const bw = isBw(target, ex);
  const sets = ((entry && entry.sets) || []).filter(s => !isWarmupSet(s));
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
  if (mode === 'cardio') { if (e.min != null) o.min = e.min; if (e.speed != null) o.speed = e.speed; }
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
    // A weekday holds a routine-id list. `[].concat` folds a legacy bare string and a
    // one-element list to the same shape (so their fingerprint is identical); `?.length` keeps
    // a stray `[]` out; insertion order is preserved and never sorted (it is the merge order).
    week: Object.fromEntries([1, 2, 3, 4, 5, 6, 0].filter(d => S.week?.[d]?.length).map(d => [d, [].concat(S.week[d])]))
  };
}

export function cleanPlan(S) {
  const routines = (S.routines || []).map(r => ({
    id: r.id, name: r.name, emoji: r.emoji, ...(r.prog ? { prog: r.prog } : {}), ex: (r.ex || []).map(cleanEx)
  }));
  const week = {};
  [1, 2, 3, 4, 5, 6, 0].forEach(d => { if (S.week?.[d]?.length) week[d] = [].concat(S.week[d]); });
  return { routines, week };
}

// The catalogue lives in library.js; re-exported so older imports keep resolving.
export { LIBRARY, MAX_LIBRARY, libraryHas, libraryName, librarySlice };

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
  // A combined day already counts as 1 — this counts days scheduled, not routines.
  const plannedDays = Object.keys(S.week || {}).filter(k => S.week[k]?.length).length;
  const reschedules = Object.entries(S.dayPlan || {}).filter(([d]) => workouts.some(w => w.d === d) || d >= (workouts[0]?.d || '')).length;

  // Muscle coverage in the window, by body part — the "not trained" gap the Stats screen shows.
  const hit = {};
  workouts.forEach(w => (w.entries || []).forEach(en => {
    const work = (en.sets || []).filter(s => s.done && !isWarmupSet(s));
    if (!work.length) return;
    const bp = LIB_BY_ID.get(en.id)?.bp;
    if (bp) hit[bp] = (hit[bp] || 0) + work.length;
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

/** Every exercise id the plan names or the given workouts logged — the ones a proposal has to
 *  be able to refer to, so they ride in the library slice whatever the cap or the filter. */
function trainedIds(S, workouts) {
  const ids = new Set();
  (S.routines || []).forEach(r => (r.ex || []).forEach(e => ids.add(e.id)));
  (workouts || []).forEach(w => (w.entries || []).forEach(en => ids.add(en.id)));
  return [...ids];
}

// Only the most recent sessions carry full set-by-set detail; everything older in the window
// arrives as one line per exercise. The old payload sent every set of up to 60 sessions —
// 10k+ tokens a small local model cannot hold and a metered API should not be billed for —
// while stalls and trends already live in `aggregates`, computed over the full window.
export const FULL_DETAIL_SESSIONS = 3;

const fmtSet = s => {
  const eff = s.rir != null ? '@RIR' + s.rir : s.rpe != null ? '@RPE' + s.rpe : '';
  if (s.sec != null) return s.sec + 's' + eff;
  if (s.min != null) return s.min + 'min' + (s.speed != null ? '/' + s.speed : '') + eff;
  return (s.w != null ? s.w + 'x' : '') + (s.r != null ? s.r : '?') + eff;
};

/** One older workout as a summary: what was done, the top set, whether targets were hit. */
function compactWorkout(w) {
  return {
    d: w.d,
    name: w.name || null,
    minutes: w.end && w.start ? Math.round((w.end - w.start) / 60000) : null,
    prs: (w.prs || []).length,
    compact: true,
    entries: (w.entries || []).map(en => {
      const sets = (en.sets || []).filter(s => !isWarmupSet(s));
      const done = sets.filter(s => s.done);
      let top = null;
      done.forEach(s => {
        if (!top || (s.w || 0) * (s.r || 0) + (s.sec || 0) > (top.w || 0) * (top.r || 0) + (top.sec || 0)) top = s;
      });
      return {
        id: en.id,
        name: libraryName(en.id),
        done: done.length + '/' + sets.length,
        ...(en.target ? { target: fmtSet({ w: en.target.weight, r: en.target.reps, sec: en.target.sec }) } : {}),
        ...(top ? { top: fmtSet(top) } : {})
      };
    })
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
        if (isWarmupSet(s)) o.warmup = true;
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

/* ---------- one workout, for a debrief ---------- */
export function findWorkout(S, workoutId) {
  const all = (S.workouts || []).filter(w => w && w.d);
  return (workoutId && all.find(w => w.id === workoutId)) || all[all.length - 1] || null;
}
/** The little a debrief's card needs to name the session: id, date, name and four numbers. */
export function workoutMeta(S, workoutId) {
  const w = findWorkout(S, workoutId);
  if (!w) return null;
  let vol = 0;
  let sets = 0;
  (w.entries || []).forEach(en => (en.sets || []).forEach(s => {
    if (!s.done || isWarmupSet(s)) return;
    sets++;
    vol += (s.w || 0) * (s.r || 0);
  }));
  return {
    id: w.id || null, d: w.d, name: w.name || null,
    minutes: w.end && w.start ? Math.round((w.end - w.start) / 60000) : null,
    vol: Number.isFinite(w.vol) ? Math.round(w.vol) : Math.round(vol),
    sets, prs: (w.prs || []).length
  };
}

/**
 * Build a job payload.
 *
 * @param {object} S      the profile's synced state
 * @param {object} opts   { handle, kind, intake?, note?, refine?, previous?, workoutId?, cohort? }
 *
 * `handle` is the opaque per-profile pseudonym the payload carries instead of a uid. It is
 * supplied rather than derived because the two runtimes mint it differently: the server keys
 * an HMAC on its instance secret (api/coach/handle.js), the phone draws a random one once and
 * keeps it. Either way it is 16 characters and never the uid.
 */
export function build(S, opts = {}) {
  if (typeof opts.handle !== 'string' || !opts.handle) throw new Error('payload.build: opts.handle is required');
  const coach = S.coach || {};
  const profile = opts.intake || coach.profile || null;
  const p = {
    coach_contract: CONTRACT,
    task: opts.kind === 'review' ? 'review' : opts.kind === 'debrief' ? 'debrief' : 'create',
    meta: {
      profile: opts.handle,
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

  if (opts.kind === 'debrief') {
    // One session, read closely: the workout itself, the last few times the same routine was
    // trained, and the stall picture for the exercises in it. No library — a debrief changes
    // nothing and names nothing new.
    const w = findWorkout(S, opts.workoutId);
    if (w) {
      const all = (S.workouts || []).filter(x => x && x.d);
      const idx = all.indexOf(w);
      const previous = all.slice(0, idx).filter(x => x.name && x.name === w.name).slice(-3);
      p.session = { id: w.id || null, ...cleanWorkout(w) };
      p.previous = previous.map(cleanWorkout);
      const inSession = new Set((w.entries || []).map(en => en.id));
      const agg = aggregates(S, [w]);
      p.aggregates = { ...agg, exercises: agg.exercises.filter(e => inSession.has(e.id)) };
      const since = new Date(w.d + 'T12:00:00'); since.setDate(since.getDate() - 28);
      const from = iso(since);
      p.bodyweight = { goal: S.targetW ?? null, series: (S.bodyweight || []).filter(b => b.d >= from && b.d <= w.d).map(b => ({ d: b.d, w: b.w })) };
    } else {
      p.session = null;
      p.previous = [];
    }
    if (opts.cohort) p.cohort = opts.cohort;
  } else if (opts.kind === 'review') {
    const workouts = reviewWindow(S, coach.lastReview?.at ? String(coach.lastReview.at).slice(0, 10) : null);
    const detailFrom = Math.max(0, workouts.length - FULL_DETAIL_SESSIONS);
    p.window = {
      from: workouts[0]?.d || null,
      to: workouts[workouts.length - 1]?.d || null,
      workouts: workouts.map((w, i) => (i >= detailFrom ? cleanWorkout(w) : compactWorkout(w)))
    };
    p.aggregates = aggregates(S, workouts);
    p.bodyweight = {
      goal: S.targetW ?? null,
      series: (S.bodyweight || []).filter(b => !p.window.from || b.d >= p.window.from).map(b => ({ d: b.d, w: b.w }))
    };
    if (opts.note) p.userNote = String(opts.note).slice(0, 1000);
    if (opts.cohort) p.cohort = opts.cohort;
    // A review names mostly what is already trained; 60 candidates is plenty for a swap.
    p.library = librarySlice(S, profile?.equipment, { keep: trainedIds(S, workouts), max: 60 });
  } else {
    p.library = librarySlice(S, profile?.equipment, { keep: trainedIds(S, S.workouts || []) });
    // Creation for a returning user: what they have actually handled, so proposed baselines
    // start from evidence rather than optimism (B2/FR-20).
    const best = {};
    (S.workouts || []).forEach(w => (w.entries || []).forEach(en => en.sets?.forEach(s => {
      if (s.done && s.w > 0 && !isWarmupSet(s)) best[en.id] = Math.max(best[en.id] || 0, s.w);
    })));
    if (Object.keys(best).length) {
      p.history = {
        sessions: (S.workouts || []).length,
        since: (S.workouts || [])[0]?.d || null,
        workingWeights: Object.entries(best).map(([id, w]) => ({ id, name: libraryName(id), best: w }))
      };
    }
    if (opts.refine && opts.previous) {
      p.refine = { text: String(opts.refine).slice(0, 1000), previous: opts.previous };
    } else if (opts.refine) {
      // "Refine" with nothing to refine: the first plan failed, or was dismissed, and the
      // person typed what they want instead. That is a fresh plan with a note, not a
      // revision of a plan that does not exist — refine.md would be reading `previous: null`.
      p.userNote = String(opts.refine).slice(0, 1000);
    }
  }
  if (opts.kind !== 'debrief') {
    const said = conversation(coach, [opts.note, opts.refine]);
    if (said.length) p.conversation = said;
  }
  return p;
}

// The last few lines of the chat, so "shorter, like last time" has something to point at.
// The user's own lines (data, never instruction — common.md rule 3) and the Coach's earlier
// verdicts; never proposals, errors or the intake card, which travel in their own fields or
// are noise. Six lines, cut short: enough to resolve a reference, not a transcript to argue
// with. The message being sent right now rides in userNote/refine, so it is left out here.
export const CONVERSATION_LINES = 6;
export const CONVERSATION_CHARS = 240;
function conversation(coach, current) {
  const now = new Set((current || []).filter(Boolean).map(x => String(x).trim()));
  return (coach.chat || [])
    .filter(m => m && typeof m.text === 'string' && m.text.trim()
      && ((m.role === 'user' && m.kind === 'text') || (m.role === 'coach' && (m.kind === 'nochange' || m.kind === 'text'))))
    .filter(m => !(m.role === 'user' && now.has(m.text.trim())))
    .slice(-CONVERSATION_LINES)
    .map(m => ({ who: m.role === 'user' ? 'user' : 'coach', text: m.text.trim().slice(0, CONVERSATION_CHARS) }));
}
