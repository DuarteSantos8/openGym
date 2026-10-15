/* What the hub's first-run onboarding writes into a profile (POST /api/sync/onboarding), and what it
 * reads back to skip questions already answered (GET /api/sync/onboarding). Free of I/O, like
 * sync-data.js, so every rule can be tested on its own.
 *
 * The rule for every field is the same: the onboarding answer goes in only where the profile has
 * not decided that field already. A field someone set (in the app, or by an earlier onboarding
 * write) is left as it is and reported as skipped, with why. That makes the write safe to send
 * again (the hub's outbox retries it until it gets an answer: a retry finds everything in place
 * and changes nothing), and safe for a profile that already holds years of training (the owner's,
 * a returning user's), where it fills in only what is missing.
 *
 * Every change is stamped the way the app stamps its own (sync-stamps.js): the settings and plan
 * days in `edited`, the routines with `_ts`, a unit choice in `unitSet`, at one time later than
 * anything the profile holds, so every device's merge takes them as the newest change, and a
 * change made on a phone after them still wins over them. */
import crypto from 'node:crypto';
import { highestStamp } from './sync-stamps.js';
import { bodyweightView, fromKg, isSyncDate, unitOf, weighInOf } from './sync-data.js';

const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v);
const list = v => (Array.isArray(v) ? v : []);
const own = (o, k) => isMap(o) && Object.hasOwn(o, k);

// What the Coach intake can hold (frontend views/CoachIntake.jsx GOALS and EXPERIENCE).
export const COACH_GOALS = ['strength', 'muscle', 'general', 'fatloss', 'endurance'];
export const COACH_EXPERIENCE = ['new', 'returning', 'regular'];
const KG_MIN = 20;
const KG_MAX = 400;
// A starter plan (frontend lib/starter.js): a handful of routines on the days of one week.
export const PLAN_ROUTINES_MAX = 7;
const ROUTINE_EX_MAX = 20;
const ROUTINE_NAME_MAX = 60;
const ICON_MAX = 32;
// An exercise id of the app's catalogue ('0025') or a custom exercise.
const EXERCISE_ID = /^[A-Za-z0-9_-]{1,32}$/;
// The Coach state a profile starts with (frontend lib/coach.js emptyCoach), hand-copied like
// sync-stamps.js is: a profile with no Coach state yet gets this, with the intake answers in it.
const emptyCoach = () => ({ consent: null, profile: null, cadence: 'off', lastReview: null, log: [], snapshots: [], chat: [], timings: [] });

const intIn = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
const text = (v, max) => typeof v === 'string' && v.trim() !== '' && v.length <= max;

/**
 * The seed body, checked: { ok: true, seed } or { ok: false, code, error }. Every field is
 * optional; an unknown one is refused, so a typo is never silently dropped.
 */
export function parseSeed(body, now = Date.now()) {
  const bad = (code, error) => ({ ok: false, code, error });
  if (!isMap(body)) return bad('bad-body', 'the body must be a JSON object');
  const known = new Set(['unit', 'bodyweight', 'coachProfile', 'plan', 'checkIn']);
  for (const k of Object.keys(body)) if (!known.has(k)) return bad('bad-field', `unknown field ${k.slice(0, 40)}`);
  const seed = {};
  if (body.unit !== undefined) {
    if (body.unit !== 'kg' && body.unit !== 'lb') return bad('bad-unit', 'unit must be kg or lb');
    seed.unit = body.unit;
  }
  if (body.bodyweight !== undefined) {
    const b = body.bodyweight;
    if (!isMap(b) || !isSyncDate(b.date, now)) return bad('bad-date', 'bodyweight.date must be a real YYYY-MM-DD date, from 1900-01-01 to tomorrow');
    if (typeof b.kg !== 'number' || !Number.isFinite(b.kg) || b.kg < KG_MIN || b.kg > KG_MAX) return bad('bad-weight', `bodyweight.kg must be a number from ${KG_MIN} to ${KG_MAX}`);
    seed.bodyweight = { date: b.date, kg: b.kg };
  }
  if (body.coachProfile !== undefined) {
    const p = body.coachProfile;
    if (!isMap(p)) return bad('bad-coach-profile', 'coachProfile must be an object');
    for (const k of Object.keys(p)) if (!['goal', 'experience', 'daysPerWeek', 'preferredDays'].includes(k)) return bad('bad-coach-profile', `unknown coachProfile field ${k.slice(0, 40)}`);
    if (p.goal !== undefined && !COACH_GOALS.includes(p.goal)) return bad('bad-coach-profile', `coachProfile.goal must be one of ${COACH_GOALS.join(', ')}`);
    if (p.experience !== undefined && !COACH_EXPERIENCE.includes(p.experience)) return bad('bad-coach-profile', `coachProfile.experience must be one of ${COACH_EXPERIENCE.join(', ')}`);
    // The intake asks 1 to 7 days (CoachIntake clamps there); "just tracking food" sends none.
    if (p.daysPerWeek !== undefined && !intIn(p.daysPerWeek, 1, 7)) return bad('bad-coach-profile', 'coachProfile.daysPerWeek must be 1 to 7');
    if (p.preferredDays !== undefined && !(Array.isArray(p.preferredDays) && p.preferredDays.length <= 7 &&
        p.preferredDays.every(d => intIn(d, 0, 6)) && new Set(p.preferredDays).size === p.preferredDays.length)) {
      return bad('bad-coach-profile', 'coachProfile.preferredDays must be distinct weekdays 0 to 6');
    }
    if (!Object.keys(p).length) return bad('bad-coach-profile', 'coachProfile is empty');
    seed.coachProfile = {
      ...(p.goal !== undefined ? { goal: p.goal } : {}),
      ...(p.experience !== undefined ? { experience: p.experience } : {}),
      ...(p.daysPerWeek !== undefined ? { daysPerWeek: p.daysPerWeek } : {}),
      ...(p.preferredDays !== undefined ? { preferredDays: [...p.preferredDays].sort((a, b) => a - b) } : {})
    };
  }
  if (body.plan !== undefined) {
    const plan = parsePlan(body.plan);
    if (!plan.ok) return plan;
    seed.plan = plan.plan;
  }
  if (body.checkIn !== undefined) {
    if (typeof body.checkIn !== 'boolean') return bad('bad-check-in', 'checkIn must be a boolean');
    seed.checkIn = body.checkIn;
  }
  return { ok: true, seed };
}

// { routines: [{ name, emoji?, ex: [{ id, sets, reps }] }], schedule: [{ day, routine }] }: the
// shape lib/starter.js builds, with each weekday naming a routine by its place in the list.
function parsePlan(p) {
  const bad = error => ({ ok: false, code: 'bad-plan', error });
  if (!isMap(p) || !Array.isArray(p.routines) || !Array.isArray(p.schedule)) return bad('plan must be { routines, schedule }');
  if (!p.routines.length || p.routines.length > PLAN_ROUTINES_MAX) return bad(`plan.routines must hold 1 to ${PLAN_ROUTINES_MAX} routines`);
  const routines = [];
  for (const r of p.routines) {
    if (!isMap(r) || !text(r.name, ROUTINE_NAME_MAX)) return bad(`every routine needs a name of at most ${ROUTINE_NAME_MAX} characters`);
    if (r.emoji !== undefined && !(typeof r.emoji === 'string' && r.emoji.length <= ICON_MAX)) return bad('a routine icon is a short string');
    if (!Array.isArray(r.ex) || !r.ex.length || r.ex.length > ROUTINE_EX_MAX) return bad(`every routine holds 1 to ${ROUTINE_EX_MAX} exercises`);
    const ex = [];
    for (const e of r.ex) {
      if (!isMap(e) || typeof e.id !== 'string' || !EXERCISE_ID.test(e.id) || !intIn(e.sets, 1, 20) || !intIn(e.reps, 1, 100)) {
        return bad('every exercise is { id, sets 1-20, reps 1-100 }');
      }
      ex.push({ id: e.id, sets: e.sets, reps: e.reps });
    }
    routines.push({ name: r.name.trim(), ...(r.emoji !== undefined ? { emoji: r.emoji } : {}), ex });
  }
  if (p.schedule.length > 7) return bad('plan.schedule has at most one entry per weekday');
  const days = new Set();
  const schedule = [];
  for (const s of p.schedule) {
    if (!isMap(s) || !intIn(s.day, 0, 6) || !intIn(s.routine, 0, routines.length - 1) || days.has(s.day)) {
      return bad('every schedule entry is { day 0-6, routine: an index into routines }, one per weekday');
    }
    days.add(s.day);
    schedule.push({ day: s.day, routine: s.routine });
  }
  return { ok: true, plan: { routines, schedule } };
}

// Whether the profile holds a weight anywhere a unit switch would have to convert.
const holdsWeights = S => list(S?.workouts).length > 0 || list(S?.bodyweight).length > 0 ||
  (isMap(S?.exWeights) && Object.keys(S.exWeights).length > 0) ||
  list(S?.routines).some(r => list(r?.ex).some(e => Number(e?.weight) > 0));
// A weekday that names a routine: a list of ids, or one id as older profiles hold it.
const plannedDays = S => (isMap(S?.week) ? Object.values(S.week).filter(v => list(v).length > 0 || (typeof v === 'string' && v)).length : 0);

// The app's routine ids are base 36 (frontend lib/format.js uid); these are longer, from a CSPRNG.
const routineId = () => 'r' + crypto.randomBytes(9).toString('base64url').replace(/[-_]/g, '').toLowerCase().slice(0, 11);

/**
 * `cur` with the seed applied, as a new document, or `next: null` when nothing changes. `cur` is
 * the stored document, or null for a profile with no document yet (a first one is then made).
 * `newProfile`: the account was made for this onboarding (the route decides, by its age); only
 * such a profile gets check-in turned off.
 * → { next, applied: [field], skipped: [{ field, reason }] }
 */
export function seedState(cur, seed, { now = Date.now(), newId = routineId, newProfile = false } = {}) {
  const base = isMap(cur) ? cur : {};
  const next = structuredClone(base);
  const at = Math.max(Number(now) || 0, highestStamp(base) + 1);
  const edited = isMap(next.edited) ? next.edited : {};
  const applied = [];
  const skipped = [];
  const skip = (field, reason) => skipped.push({ field, reason });

  if (seed.unit !== undefined) {
    if (unitOf(base) === seed.unit) skip('unit', 'same');
    else if (base.unitSet) skip('unit', 'chosen');
    else if (holdsWeights(base)) skip('unit', 'has-data');
    else {
      next.unit = seed.unit;
      // The numbers were in the new unit all along: nothing to convert (frontend useStore setUnit).
      next.unitSet = { at, convert: false };
      applied.push('unit');
    }
  }

  if (seed.bodyweight !== undefined) {
    const { date, kg } = seed.bodyweight;
    if (weighInOf(base, date)) skip('bodyweight', 'has-entry');
    else {
      const w = fromKg(kg, unitOf(next));
      const removed = Math.abs(Number(base.deleted?.bodyweight?.[date]) || 0);
      next.bodyweight = [...list(next.bodyweight).filter(e => !(isMap(e) && e.d === date)), { d: date, w, t: Math.max(at, removed + 1) }]
        .sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
      applied.push('bodyweight');
    }
  }

  if (seed.coachProfile !== undefined) {
    if (isMap(base.coach?.profile)) skip('coachProfile', 'answered');
    else {
      next.coach = { ...(isMap(base.coach) ? structuredClone(base.coach) : emptyCoach()), profile: { ...seed.coachProfile } };
      edited.coach = at;
      applied.push('coachProfile');
    }
  }

  if (seed.plan !== undefined) {
    if (list(base.routines).length > 0 || plannedDays(base) > 0) skip('plan', 'has-plan');
    else {
      const ids = seed.plan.routines.map(() => newId());
      next.routines = seed.plan.routines.map((r, i) => ({
        id: ids[i], name: r.name, ...(r.emoji !== undefined ? { emoji: r.emoji } : {}),
        ex: r.ex.map(e => ({ id: e.id, sets: e.sets, reps: e.reps, weight: 0 })), _ts: at
      }));
      next.week = isMap(next.week) ? next.week : {};
      for (const { day, routine } of seed.plan.schedule) {
        next.week[day] = [ids[routine]];
        edited[`week.${day}`] = at;
      }
      applied.push('plan');
    }
  }

  if (seed.checkIn !== undefined) {
    if (base.checkIn === seed.checkIn || (base.checkIn === undefined && seed.checkIn === true)) skip('checkIn', 'same');
    // Off by default is for a profile onboarding starts: one that already existed (the owner's, a
    // returning user's, one with training on it) keeps check-in as it has always read it.
    else if (!newProfile || list(base.workouts).length > 0) skip('checkIn', 'existing-profile');
    else if (own(base.edited, 'checkIn')) skip('checkIn', 'chosen');
    else if (list(base.gymCards).length > 0) skip('checkIn', 'in-use');
    else {
      next.checkIn = seed.checkIn;
      edited.checkIn = at;
      applied.push('checkIn');
    }
  }

  if (!applied.length) return { next: null, applied, skipped };
  if (Object.keys(edited).length) next.edited = edited;
  next._ts = Math.max(Number(next._ts) || 0, at);
  return { next, applied, skipped };
}

/**
 * What the profile has already answered, for the onboarding to skip: the unit (and whether it was
 * chosen), the latest weigh-in, whether there is a plan, and the Coach intake answers. Nothing
 * else of the profile, and no names.
 */
export function seedView(S) {
  const latest = bodyweightView(S).items.at(-1) || null;
  const p = isMap(S?.coach?.profile) ? S.coach.profile : null;
  return {
    unit: unitOf(S),
    unitChosen: !!S?.unitSet || holdsWeights(S),
    latestWeight: latest ? { date: latest.date, kg: latest.kg } : null,
    routines: list(S?.routines).length,
    plannedDays: plannedDays(S),
    coachProfile: p ? {
      goal: COACH_GOALS.includes(p.goal) ? p.goal : null,
      experience: COACH_EXPERIENCE.includes(p.experience) ? p.experience : null,
      daysPerWeek: intIn(p.daysPerWeek, 0, 7) ? p.daysPerWeek : null,
      preferredDays: Array.isArray(p.preferredDays) ? p.preferredDays.filter(d => intIn(d, 0, 6)).slice(0, 7) : []
    } : null,
    // Absent reads as on (useStore DEF), like every client reads it.
    checkIn: S?.checkIn !== false
  };
}
