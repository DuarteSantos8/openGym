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
import { buildStarter, STARTER_EQUIPMENT, STARTER_TEMPLATES } from './starter-plans.js';

const isMap = v => !!v && typeof v === 'object' && !Array.isArray(v);
const list = v => (Array.isArray(v) ? v : []);
const own = (o, k) => isMap(o) && Object.hasOwn(o, k);

// What the Coach intake can hold (frontend views/CoachIntake.jsx GOALS and EXPERIENCE).
export const COACH_GOALS = ['strength', 'muscle', 'general', 'fatloss', 'endurance'];
export const COACH_EXPERIENCE = ['new', 'returning', 'regular'];
const KG_MIN = 20;
const KG_MAX = 400;
// The Coach state a profile starts with (frontend lib/coach.js emptyCoach), hand-copied like
// sync-stamps.js is: a profile with no Coach state yet gets this, with the intake answers in it.
const emptyCoach = () => ({ consent: null, profile: null, cadence: 'off', lastReview: null, log: [], snapshots: [], chat: [], timings: [] });

const intIn = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

// When the person agreed to the AI build: the hub's clock when it took the consent, as
// Date.toISOString writes it. Later than the onboarding's existence and no more than the two
// servers' skew ahead of this one.
const CONSENT_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const CONSENT_EARLIEST = Date.UTC(2020, 0, 1);
const CONSENT_SKEW_MS = 10 * 60 * 1000;
// The id of the consent text the person was shown (the hub's src/onboarding/consent.ts knows
// which there are; this checks only its form).
const CONSENT_VERSION = /^[a-z0-9-]{1,40}$/;

/**
 * What the seed route takes beyond its first fields, said in GET /api/sync/onboarding (seedView),
 * so a hub sends a ready-made plan or an AI coach build only to an openGym that takes it. An
 * openGym from before them says nothing, and refuses both as unknown fields.
 *
 * `starterTemplates`: each ready-made plan this server builds, and the numbers of weekdays it runs
 * at (starter-plans.js). The hub checks a starter choice against these when the person makes it,
 * so a template and weekdays that do not go together are refused then, not at delivery; it keeps
 * no copy of its own.
 */
export const SEED_CAPABILITY = Object.freeze({
  starter: true,
  coachBuild: true,
  starterTemplates: Object.freeze(Object.fromEntries(
    Object.entries(STARTER_TEMPLATES).map(([id, template]) => [id, Object.freeze([...template.days])])
  ))
});

/**
 * The seed body, checked: { ok: true, seed } or { ok: false, code, field, error }. Every field is
 * optional; an unknown one is refused, so a typo is never silently dropped. `field` names the
 * top-level field refused (null: the body as a whole), so a hub can tell a refused plan from a
 * refused weigh-in and send the rest without it.
 *
 * A plan comes one of two ways, and only one: `starter` (a choice of ready-made plan, built here:
 * starter-plans.js) or `coachBuild` (the person asked the AI coach for one, which is recorded and
 * never run here, and only where this server has an AI coach: `coachAvailable`). `starter` is
 * expanded into `plan`, so past this function there is `plan` or `coachBuild`.
 */
export function parseSeed(body, now = Date.now(), { coachAvailable = false } = {}) {
  const refuse = field => (code, error) => ({ ok: false, code, field, error });
  if (!isMap(body)) return refuse(null)('bad-body', 'the body must be a JSON object');
  const known = new Set(['unit', 'bodyweight', 'coachProfile', 'starter', 'coachBuild', 'checkIn']);
  for (const k of Object.keys(body)) if (!known.has(k)) return refuse(k.slice(0, 40))('bad-field', `unknown field ${k.slice(0, 40)}`);
  const seed = {};
  if (body.unit !== undefined) {
    if (body.unit !== 'kg' && body.unit !== 'lb') return refuse('unit')('bad-unit', 'unit must be kg or lb');
    seed.unit = body.unit;
  }
  if (body.bodyweight !== undefined) {
    const b = body.bodyweight;
    const bad = refuse('bodyweight');
    if (!isMap(b) || !isSyncDate(b.date, now)) return bad('bad-date', 'bodyweight.date must be a real YYYY-MM-DD date, from 1900-01-01 to tomorrow');
    if (typeof b.kg !== 'number' || !Number.isFinite(b.kg) || b.kg < KG_MIN || b.kg > KG_MAX) return bad('bad-weight', `bodyweight.kg must be a number from ${KG_MIN} to ${KG_MAX}`);
    seed.bodyweight = { date: b.date, kg: b.kg };
  }
  if (body.coachProfile !== undefined) {
    const p = body.coachProfile;
    const bad = refuse('coachProfile');
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
  if (body.starter !== undefined) {
    const starter = parseStarter(body.starter, refuse('starter'));
    if (!starter.ok) return starter;
    seed.plan = starter.plan;
  }
  if (body.coachBuild !== undefined) {
    const bad = refuse('coachBuild');
    if (body.starter !== undefined) return bad('bad-coach-build', 'a coachBuild and a starter are two ways to get a plan: send one');
    const build = parseCoachBuild(body.coachBuild, now, bad);
    if (!build.ok) return build;
    // A consent to a build that nothing on this server could run is never recorded.
    if (coachAvailable !== true) return bad('coach-unavailable', 'this server has no AI coach to build a plan');
    seed.coachBuild = build.coachBuild;
  }
  if (body.checkIn !== undefined) {
    if (typeof body.checkIn !== 'boolean') return refuse('checkIn')('bad-check-in', 'checkIn must be a boolean');
    seed.checkIn = body.checkIn;
  }
  return { ok: true, seed };
}

// { templateId, weekdays, equipment }: a ready-made plan (starter-plans.js) and the weekday of each
// of its sessions in order, built into the same { routines, schedule } a `plan` is.
function parseStarter(s, refuse) {
  const bad = error => refuse('bad-plan', error);
  if (!isMap(s)) return bad('starter must be { templateId, weekdays, equipment }');
  for (const k of Object.keys(s)) if (!['templateId', 'weekdays', 'equipment'].includes(k)) return bad(`unknown starter field ${k.slice(0, 40)}`);
  if (typeof s.templateId !== 'string' || !Object.hasOwn(STARTER_TEMPLATES, s.templateId)) {
    return bad(`starter.templateId must be one of ${Object.keys(STARTER_TEMPLATES).join(', ')}`);
  }
  if (!STARTER_EQUIPMENT.includes(s.equipment)) return bad(`starter.equipment must be one of ${STARTER_EQUIPMENT.join(', ')}`);
  if (!Array.isArray(s.weekdays) || !s.weekdays.every(d => intIn(d, 0, 6)) || new Set(s.weekdays).size !== s.weekdays.length) {
    return bad('starter.weekdays must be distinct weekdays 0 to 6');
  }
  const days = STARTER_TEMPLATES[s.templateId].days;
  if (!days.includes(s.weekdays.length)) return bad(`starter.weekdays must hold ${days.join(' or ')} weekdays for ${s.templateId}`);
  return { ok: true, plan: buildStarter(s) };
}

// { consentAt, consentVersion, equipment }: the person agreed to the AI coach building a plan from
// their answers, at `consentAt` by the hub's clock, to the text `consentVersion` names. Recorded in
// the profile as a pending build for the Coach to pick up; nothing is run from here.
function parseCoachBuild(b, now, refuse) {
  const bad = error => refuse('bad-coach-build', error);
  if (!isMap(b)) return bad('coachBuild must be { consentAt, consentVersion, equipment }');
  for (const k of Object.keys(b)) if (!['consentAt', 'consentVersion', 'equipment'].includes(k)) return bad(`unknown coachBuild field ${k.slice(0, 40)}`);
  const at = typeof b.consentAt === 'string' && CONSENT_AT.test(b.consentAt) ? Date.parse(b.consentAt) : NaN;
  if (!Number.isFinite(at) || at < CONSENT_EARLIEST || at > now + CONSENT_SKEW_MS) return bad('coachBuild.consentAt must be a UTC timestamp, not in the future');
  if (typeof b.consentVersion !== 'string' || !CONSENT_VERSION.test(b.consentVersion)) return bad('coachBuild.consentVersion must be the id of the consent text shown');
  if (!STARTER_EQUIPMENT.includes(b.equipment)) return bad(`coachBuild.equipment must be one of ${STARTER_EQUIPMENT.join(', ')}`);
  return { ok: true, coachBuild: { consentAt: new Date(at).toISOString(), consentVersion: b.consentVersion, equipment: b.equipment } };
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

  // The AI coach build is recorded, never run: consent and a pending marker in the Coach's own
  // state, for the Coach flow to pick up. Only for a profile with no plan to build on top of, and
  // only once (a request already on record stands, whatever it came to).
  if (seed.coachBuild !== undefined) {
    if (isMap(base.coach?.build)) skip('coachBuild', 'requested');
    else if (list(base.routines).length > 0 || plannedDays(base) > 0) skip('coachBuild', 'has-plan');
    else {
      const coach = isMap(next.coach) ? next.coach : emptyCoach();
      const { consentAt, consentVersion, equipment } = seed.coachBuild;
      coach.build = { status: 'pending', source: 'onboarding', consentAt, consentVersion, equipment, requestedAt: at };
      next.coach = coach;
      edited.coach = at;
      applied.push('coachBuild');
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
 * else of the profile, and no names. `coachAvailable`: this server has an AI coach a person may
 * ask for a plan (coach/config.js publicConfig), which is the server's, not the profile's, to say.
 * `seed`: what the seed route takes (SEED_CAPABILITY).
 */
export function seedView(S, { coachAvailable = false } = {}) {
  const latest = bodyweightView(S).items.at(-1) || null;
  const p = isMap(S?.coach?.profile) ? S.coach.profile : null;
  return {
    coachAvailable: coachAvailable === true,
    seed: structuredClone(SEED_CAPABILITY),
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
