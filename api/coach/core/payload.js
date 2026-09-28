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
import { glyphStr } from './glyphs.js';
import { LIBRARY, LIB_BY_ID, libraryHas, libraryName, librarySlice, isStretch, MAX_LIBRARY } from './library.js';

export const CONTRACT = 1;
// Bounds from FR-22. A review reads a training block, not a training career: more history
// makes the payload bigger and the reading vaguer, not better.
export const MAX_WEEKS = 12;
export const MAX_SESSIONS = 60;
// Last-resort ceiling for a free-text note/refine (issue #267). The real limit is the admin's
// `maxMessageLen`, enforced in jobs.js before a message ever reaches this module — this module
// stays a pure allowlist with no config import of its own, so it keeps its own constant instead.
// It has to stay >= config.js's MAX_MESSAGE_LEN_CEILING, or a raised admin limit would still get
// clipped back down here.
export const MAX_NOTE_CHARS = 4000;
// The ceiling on a whole payload, as JSON characters, which the server checks before a job
// leaves (jobs.js). Every field below is bounded on its own; this is the backstop for how many
// of them there are, and for a field added later that nobody bounded. A deliberately extreme
// history (30 routines of 12 exercises, 200 custom exercises, 60 twelve-exercise sessions in
// the review window) builds a review of about 240k; ordinary ones stay under 50k.
export const MAX_PAYLOAD_CHARS = 300_000;

/* ---------- what a person typed, bounded ----------
   Every free-text field below rides into the prompt, and the prompt is paid for by whoever runs
   the instance: the Coach spends one instance-wide key. The intake screen caps what it lets you
   type, but this module never sees that screen. It reads the profile from a POST body or from
   the synced state, and a client can fill either with megabytes (the only server limit is the
   5 MB body cap). So the text is cut here, the one place both the server and the phone build a
   payload, to the limits the intake screen shows (CoachIntake.jsx). The system prompt already
   reads this text as data rather than instruction (common rule 3); the bound is about size.
   A field of the wrong type reads as absent rather than as "[object Object]". */
export const PROFILE_TEXT_MAX = { limitations: 600, likes: 300, dislikes: 300, notes: 600 };
// Goal and experience are enum words today (strength, returning, ...); 40 leaves room for new
// ones without letting either carry a paragraph.
export const PROFILE_WORD_MAX = 40;
// The equipment taxonomy has 28 values, the longest 20 characters.
export const PROFILE_EQUIPMENT_MAX = 40;
// Routine, workout and custom-exercise names have no length limit in the app. The Coach writes
// its own names at 40 (validate.js); twice that keeps any name a person would really type.
export const NAME_MAX = 80;
const text = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
const word = (v, n) => (typeof v === 'string' && v ? v.slice(0, n) : null);

/** A language tag's shape ('de', 'pt-BR', 'zh_Hant'), or null — for a language that arrives with
 *  a request or from the environment rather than from the state (#303). */
export const langTag = v => (typeof v === 'string' && /^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,8})?$/.test(v.trim()) ? v.trim() : null);
// Zero reads as absent, as `|| null` always made it; anything else is clamped into range.
const count = (v, lo, hi) => {
  const n = typeof v === 'number' || typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) && n ? Math.min(hi, Math.max(lo, Math.round(n))) : null;
};
// A weekday is 0-6, as a number or a one-digit string; null must not turn into Sunday.
const weekday = d => (typeof d === 'number' ? d : typeof d === 'string' && /^\d$/.test(d) ? Number(d) : NaN);

/* ---------- what the plan and the log hold, bounded by type ----------
   The plan, the logged sets, the body-weight series and the exercise ids come from the same
   client-written state as the profile, and PUT /api/data checks no more than that workouts and
   routines are arrays. A field copied as it came is a field that can carry a megabyte of text
   into the prompt, so each one is read by what it is meant to be. Anything else reads as
   absent, as a wrong-typed profile field does. */
// The app's own ids are uid() (13 characters) or a four-digit catalogue number; 64 is room for
// any id an import or an older build ever wrote, and no room for a paragraph.
export const ID_MAX = 64;
// The progression engine's policies (frontend/src/lib/progression.js POLICIES, validate.js).
const POLICIES = ['off', 'linear', 'greyskull', 'double', 'time'];
const ident = v => (typeof v === 'string' ? v.slice(0, ID_MAX) : typeof v === 'number' && Number.isFinite(v) ? v : null);
const policy = v => (POLICIES.includes(v) ? v : null);
// A finite number, or a number written as a short string (the app writes numbers, but a
// hand-made import may not, and the model reads "20" as well as 20). Kept as given rather than
// converted, so a Coach change's `before` still equals what the plan holds.
const NUMERIC = /^-?\d{1,9}(\.\d{1,6})?$/;
const num = v => ((typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && NUMERIC.test(v)) ? v : undefined);
// A date is the ISO day every screen writes; anything else is not a date.
const day = v => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const list = v => (Array.isArray(v) ? v : []);
function cleanProfile(profile) {
  const days = Array.isArray(profile.preferredDays) ? profile.preferredDays : [];
  const equipment = Array.isArray(profile.equipment) ? profile.equipment : [];
  return {
    goal: word(profile.goal, PROFILE_WORD_MAX),
    experience: word(profile.experience, PROFILE_WORD_MAX),
    daysPerWeek: count(profile.daysPerWeek, 1, 7),
    // Weekdays 0-6, each once: seven entries is the whole week, so anything past that is noise.
    preferredDays: [...new Set(days.map(weekday).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))],
    sessionMin: count(profile.sessionMin, 1, 24 * 60),
    equipment: equipment.filter(e => typeof e === 'string' && e).slice(0, PROFILE_EQUIPMENT_MAX).map(e => e.slice(0, PROFILE_WORD_MAX)),
    limitations: text(profile.limitations, PROFILE_TEXT_MAX.limitations),
    likes: text(profile.likes, PROFILE_TEXT_MAX.likes),
    dislikes: text(profile.dislikes, PROFILE_TEXT_MAX.dislikes),
    notes: text(profile.notes, PROFILE_TEXT_MAX.notes)
  };
}

/* ---------- the data categories the consent screen names (FR-09/10) ----------
   Kept here, next to the code that acts on it, and rendered by the consent UI from the same
   list — a screen that drifts from the payload is worse than no screen. */
export { DATA_CATEGORIES } from './categories.js';

/* ---------- reading a session the way the engine reads it ----------
   Duplicated from frontend/src/lib/history.js rather than shared: the two runtimes have no
   build step in common, and this is the same trade-off server.js already made for
   effectiveRoutineId. frontend/src/lib/coach-parity.test.js pins modeOf, isBw and isPerSide
   against the frontend's own copies over a shared table of configs, so the duplicate cannot
   drift silently — which it otherwise would have, quietly, when v1.2.4 taught the app about
   bodyweight work. isWarmupSet and readSession are duplicated the same way but were pinned by
   nothing; api/test/payload-parity.test.js pins them now. It has to be a separate file: that
   test imports the frontend's own readSession, and a vitest test cannot import into a
   node:test file or back. */
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
  const logged = ((entry && entry.sets) || []).filter(s => !isWarmupSet(s));
  const planned = target.sets || logged.length;
  const enough = logged.length >= planned;
  // Only the sets the plan asked for decide whether the session was hit, exactly as
  // frontend/src/lib/progression.js readSession has done since issue #233. This copy graded
  // every logged set, so a fourth set taken short of the goal on a clean 3x10 was a hit in the
  // app and a miss here — and stallCount, reading only this copy, reported a stall the athlete
  // never had. `count` below stays the real total: extra sets are exactly how bodyweight work
  // is meant to grow (#33), they just do not decide whether the prescription was met.
  const sets = logged.slice(0, Math.max(1, planned));
  if (mode === 'time') {
    const goal = target.sec || 0;
    const held = sets.map(s => (s.done ? (s.sec || 0) : 0));
    return { mode, bw, goal, ok: goal > 0 && enough && held.length > 0 && held.every(h => h >= goal) };
  }
  const goal = target.reps || 0;
  const reps = sets.map(s => (s.done ? (s.r || 0) : 0));
  // Set count is the dimension bodyweight work grows once reps hit their ceiling (upstream
  // #33), so it travels alongside the reps rather than being inferred from them downstream.
  const done = logged.filter(s => s.done).length;
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
  const o = { id: ident(e.id), name: LIB_BY_ID.get(e.id)?.n || null, sets: num(e.sets) };
  const mode = modeOf(e, LIB_BY_ID.get(e.id));
  o.mode = mode;
  const put = (k, v) => { if (num(v) !== undefined) o[k] = v; };
  if (mode === 'cardio') { put('min', e.min); put('speed', e.speed); }
  else if (mode === 'time') { put('sec', e.sec); if (e.weight) put('weight', e.weight); }
  else { put('reps', e.reps); if (e.weight) put('weight', e.weight); }
  if (policy(e.prog)) o.prog = e.prog;
  if (e.inc > 0) put('inc', e.inc);
  put('repsMin', e.repsMin);
  // repsMax is the ceiling that turns "+1 rep forever" into "add a set and start over"; without
  // it the Coach cannot see, or propose, how a bodyweight exercise is meant to progress.
  put('repsMax', e.repsMax);
  // Written out only when they disagree with the catalogue, matching plan-share.js — an
  // absent flag has always meant "whatever the exercise says", and still does.
  if (e.bodyweight != null) o.bodyweight = !!e.bodyweight;
  if (e.side) o.side = true;
  // A superset tag is an id the app mints (sg-0-1, hs + uid()), so it is bounded like one.
  if (e.sg) o.sg = ident(e.sg);
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
  // Names are typed by the person, so they are cut like the profile's text. The icon is held to
  // what the validator lets a plan carry (an icon key or a legacy emoji, core/glyphs.js): it is
  // the client's state, and free text in it would ride into every prompt.
  const routines = list(S.routines).filter(r => r && typeof r === 'object').map(r => ({
    id: ident(r.id), name: r.name == null ? r.name : text(String(r.name), NAME_MAX),
    emoji: r.emoji == null ? r.emoji : glyphStr(String(r.emoji)),
    ...(policy(r.prog) ? { prog: r.prog } : {}),
    ex: list(r.ex).filter(e => e && typeof e === 'object').map(cleanEx)
  }));
  // A weekday holds routine ids, so each entry is bounded like one.
  const week = {};
  [1, 2, 3, 4, 5, 6, 0].forEach(d => { if (S.week?.[d]?.length) week[d] = [].concat(S.week[d]).map(ident); });
  return { routines, week };
}

// The catalogue lives in library.js; re-exported so older imports keep resolving.
export { LIBRARY, MAX_LIBRARY, libraryHas, libraryName, librarySlice, isStretch };

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
      exercises.push({ id: ident(id), name: libraryName(id), sessions: sessions.length, stalls, lastOk: !!sessions[sessions.length - 1]?.ok });
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

/** One logged set, its numbers only. */
function cleanSet(s) {
  const o = { done: !!s.done };
  if (isWarmupSet(s)) o.warmup = true;
  for (const k of ['w', 'r', 'sec', 'min', 'speed', 'rir', 'rpe']) if (num(s[k]) !== undefined) o[k] = s[k];
  return o;
}
const entriesOf = w => list(w.entries).filter(en => en && typeof en === 'object');
const setsOf = en => list(en.sets).filter(s => s && typeof s === 'object');
const targetOf = en => (en.target && typeof en.target === 'object'
  ? { sets: num(en.target.sets), reps: num(en.target.reps), sec: num(en.target.sec), weight: num(en.target.weight) }
  : null);

/** One older workout as a summary: what was done, the top set, whether targets were hit. */
function compactWorkout(w) {
  return {
    d: day(w.d),
    name: word(w.name, NAME_MAX),
    minutes: w.end && w.start ? Math.round((w.end - w.start) / 60000) : null,
    prs: list(w.prs).length,
    compact: true,
    entries: entriesOf(w).map(en => {
      const sets = setsOf(en).filter(s => !isWarmupSet(s)).map(cleanSet);
      const done = sets.filter(s => s.done);
      let top = null;
      done.forEach(s => {
        if (!top || (s.w || 0) * (s.r || 0) + (s.sec || 0) > (top.w || 0) * (top.r || 0) + (top.sec || 0)) top = s;
      });
      const target = targetOf(en);
      return {
        id: ident(en.id),
        name: libraryName(en.id),
        done: done.length + '/' + sets.length,
        ...(target ? { target: fmtSet({ w: target.weight, r: target.reps, sec: target.sec }) } : {}),
        ...(top ? { top: fmtSet(top) } : {})
      };
    })
  };
}

/** One workout, reduced to what a coach reads. */
function cleanWorkout(w) {
  return {
    d: day(w.d),
    name: word(w.name, NAME_MAX),
    minutes: w.end && w.start ? Math.round((w.end - w.start) / 60000) : null,
    ...(w.rating ? { rating: typeof w.rating === 'number' ? w.rating : text(String(w.rating), 20) } : {}),
    ...(w.note ? { note: String(w.note).slice(0, 300) } : {}),
    prs: list(w.prs).length,
    entries: entriesOf(w).map(en => ({
      id: ident(en.id),
      name: libraryName(en.id),
      target: targetOf(en),
      sets: setsOf(en).map(cleanSet)
    }))
  };
}

/** The body-weight series between two days, each weigh-in a date and a number. */
function weighIns(S, from, to) {
  return list(S.bodyweight)
    .map(b => ({ d: day(b?.d), w: num(b?.w) }))
    .filter(b => b.d && b.w !== undefined && (!from || b.d >= from) && (!to || b.d <= to));
}

/* The room's medians are computed on this server, but from other people's synced workouts —
   state their own clients wrote. cohort.js keeps only catalogue exercises; this copy bounds
   every field again, so what reaches one person's prompt never depends on that filter alone. */
function cleanCohort(c) {
  if (!c || typeof c !== 'object') return null;
  const spw = c.sessionsPerWeek && typeof c.sessionsPerWeek === 'object' ? c.sessionsPerWeek : {};
  return {
    unit: word(c.unit, 8),
    people: num(c.people) ?? null,
    sessionsPerWeek: { median: num(spw.median) ?? null, you: num(spw.you) ?? null },
    exercises: list(c.exercises).filter(x => x && typeof x === 'object').map(x => ({
      id: ident(x.id), name: word(x.name, NAME_MAX), median: num(x.median) ?? null, you: num(x.you) ?? null
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
 * @param {object} opts   { handle, kind, intake?, note?, refine?, previous?, workoutId?, cohort?, lang? }
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
      // Both are short codes in any real state; cut anyway, since the state is the client's.
      // `opts.lang` is the language the app is showing when it asked: a profile that never
      // picked one has it worked out per device and never stored (#303).
      lang: langTag(opts.lang) || word(S.lang, 16) || 'en',
      unit: word(S.unit, 8) || 'kg',
      effortScale: effortOf(S),
      today: iso(new Date())
    },
    coachProfile: profile && typeof profile === 'object' ? cleanProfile(profile) : null,
    plan: cleanPlan(S)
  };

  // What the user already turned down, so the Coach does not re-propose it without new
  // evidence (FR-26). Summaries only — the log's full before/after stays on the device.
  const declined = (coach.log || [])
    // `why` was the Coach's own sentence, but it comes back from the synced state, which the
    // client writes; it is cut at the length the intake allows a note.
    .flatMap(e => (e.decisions || []).filter(d => d.status === 'rejected').map(d => ({ type: word(d.type, PROFILE_WORD_MAX), why: text(d.why, PROFILE_TEXT_MAX.notes) })))
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
      p.session = { id: ident(w.id) || null, ...cleanWorkout(w) };
      p.previous = previous.map(cleanWorkout);
      const inSession = new Set(entriesOf(w).map(en => ident(en.id)));
      const agg = aggregates(S, [w]);
      p.aggregates = { ...agg, exercises: agg.exercises.filter(e => inSession.has(e.id)) };
      // The four weeks before the session. A session whose date does not parse has no "before",
      // and used to throw here instead.
      const on = day(w.d);
      const since = new Date(on + 'T12:00:00');
      since.setDate(since.getDate() - 28);
      const dated = !!on && Number.isFinite(since.getTime());
      p.bodyweight = { goal: num(S.targetW) ?? null, series: dated ? weighIns(S, iso(since), on) : [] };
    } else {
      p.session = null;
      p.previous = [];
    }
    if (opts.cohort) p.cohort = cleanCohort(opts.cohort);
  } else if (opts.kind === 'review') {
    const workouts = reviewWindow(S, coach.lastReview?.at ? String(coach.lastReview.at).slice(0, 10) : null);
    const detailFrom = Math.max(0, workouts.length - FULL_DETAIL_SESSIONS);
    p.window = {
      from: day(workouts[0]?.d),
      to: day(workouts[workouts.length - 1]?.d),
      workouts: workouts.map((w, i) => (i >= detailFrom ? cleanWorkout(w) : compactWorkout(w)))
    };
    p.aggregates = aggregates(S, workouts);
    p.bodyweight = { goal: num(S.targetW) ?? null, series: weighIns(S, p.window.from, null) };
    if (opts.note) p.userNote = String(opts.note).slice(0, MAX_NOTE_CHARS);
    if (opts.cohort) p.cohort = cleanCohort(opts.cohort);
    // A review names mostly what is already trained; 60 candidates is plenty for a swap.
    p.library = librarySlice(S, p.coachProfile?.equipment, { keep: trainedIds(S, workouts), max: 60 });
  } else {
    p.library = librarySlice(S, p.coachProfile?.equipment, { keep: trainedIds(S, S.workouts || []) });
    // Creation for a returning user: what they have actually handled, so proposed baselines
    // start from evidence rather than optimism (B2/FR-20).
    const best = {};
    (S.workouts || []).forEach(w => (w.entries || []).forEach(en => en.sets?.forEach(s => {
      if (s.done && s.w > 0 && !isWarmupSet(s)) best[en.id] = Math.max(best[en.id] || 0, s.w);
    })));
    if (Object.keys(best).length) {
      p.history = {
        sessions: (S.workouts || []).length,
        since: day((S.workouts || [])[0]?.d),
        workingWeights: Object.entries(best).map(([id, w]) => ({ id: ident(id), name: libraryName(id), best: w }))
      };
    }
    if (opts.refine && opts.previous) {
      p.refine = { text: String(opts.refine).slice(0, MAX_NOTE_CHARS), previous: opts.previous };
    } else if (opts.refine) {
      // "Refine" with nothing to refine: the first plan failed, or was dismissed, and the
      // person typed what they want instead. That is a fresh plan with a note, not a
      // revision of a plan that does not exist — refine.md would be reading `previous: null`.
      p.userNote = String(opts.refine).slice(0, MAX_NOTE_CHARS);
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
