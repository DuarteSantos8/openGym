/* A plan file may add prescriptions, never recorded results. Authentication for this
 * surface is deliberately separate from a session: a plan key cannot become an account. */
import crypto from 'node:crypto';
import { libraryHas } from './coach/core/library.js';
import { parsePlan, mergePlan, buildPlanBundle } from './coach/core/plan-file.js';

export const PLAN_SCOPE = 'plans:write';
export const planKeyHash = token => crypto.createHash('sha256').update(token).digest('hex');
export function makePlanKey(user, name, days, now = Date.now()) {
  const id = crypto.randomBytes(12).toString('hex');
  const token = `opg_plan_${id}_${crypto.randomBytes(32).toString('base64url')}`;
  return { token, key: { id, name, hash: planKeyHash(token), expires: now + days * 86400000, sv: user.sv || 0 } };
}
export const planKeyPublic = key => ({ id: key.id, name: key.name, expires: key.expires, scope: PLAN_SCOPE });
export function planKeyUser(req, users, now = Date.now()) {
  const token = /^Bearer (opg_plan_[a-f0-9]{24}_[A-Za-z0-9_-]{43})$/.exec(req.headers.authorization || '')?.[1];
  if (!token) return null;
  const hash = Buffer.from(planKeyHash(token), 'hex');
  for (const user of users) {
    if (user.disabled) continue;
    for (const key of (Array.isArray(user.planKeys) ? user.planKeys : [])) {
      if (!key || !Number.isSafeInteger(key.expires) || key.expires <= now || key.sv !== (user.sv || 0) || !/^[a-f0-9]{64}$/.test(key.hash || '')) continue;
      if (crypto.timingSafeEqual(hash, Buffer.from(key.hash, 'hex'))) return user;
    }
  }
  return null;
}

const object = x => x && typeof x === 'object' && !Array.isArray(x);
const fail = () => { throw new Error('invalid plan file'); };
const keys = (x, allowed) => {
  if (!object(x) || Object.keys(x).some(k => !allowed.includes(k))) fail();
};
const id = x => typeof x === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(x) && !Object.hasOwn(Object.prototype, x);
const text = x => typeof x === 'string' && x.length <= 2048;
const list = (x, max) => Array.isArray(x) && x.length <= max;
const EX_FIELDS = ['id', 'sets', 'mode', 'reps', 'weight', 'min', 'speed', 'sec', 'bodyweight', 'side', 'prog', 'inc', 'deloadFactor', 'repsMin', 'repsMax', 'restSec', 'warmupRestSec', 'sg', 'note', 'warmupSets', 'intensifier', 'pyramid', 'pyramidRest'];
const NUMBER_FIELDS = ['sets', 'reps', 'weight', 'min', 'speed', 'sec', 'inc', 'deloadFactor', 'repsMin', 'repsMax', 'restSec', 'warmupRestSec', 'warmupSets'];

export function validatePlanFile(plan) {
  keys(plan, ['opengym_plan', 'exported', 'name', 'unit', 'weightUnit', 'week', 'routines', 'customEx']);
  if (plan.opengym_plan !== 1 || !list(plan.routines, 100) || !plan.routines.length) fail();
  for (const field of ['exported', 'name']) if (plan[field] != null && !text(plan[field])) fail();
  const ids = new Set();
  for (const r of plan.routines) {
    keys(r, ['id', 'name', 'emoji', 'prog', 'excludeFromProgression', 'ex']);
    if (!id(r.id) || ids.has(r.id) || !text(r.name) || !list(r.ex, 100) || !r.ex.length) fail();
    ids.add(r.id);
    for (const field of ['emoji', 'prog']) if (r[field] != null && !text(r[field])) fail();
    if (r.excludeFromProgression != null && typeof r.excludeFromProgression !== 'boolean') fail();
    for (const e of r.ex) {
      keys(e, EX_FIELDS);
      if (!id(e.id)) fail();
      for (const field of NUMBER_FIELDS) {
        if (e[field] != null && (typeof e[field] !== 'number' || !Number.isFinite(e[field]) || e[field] < 0 || e[field] > 100000)) fail();
      }
      if (e.sets == null || !Number.isInteger(e.sets) || e.sets < 1 || e.sets > 100) fail();
      if (e.mode != null && !['reps', 'time', 'cardio'].includes(e.mode)) fail();
      for (const field of ['bodyweight', 'side']) if (e[field] != null && typeof e[field] !== 'boolean') fail();
      for (const field of ['prog', 'sg', 'note']) if (e[field] != null && !text(e[field])) fail();
      for (const field of ['pyramid', 'pyramidRest']) {
        if (e[field] != null && (!list(e[field], 10) || e[field].some(n => !(field === 'pyramid' && n === 'max') && (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 100000)))) fail();
      }
      if (e.intensifier != null) {
        keys(e.intensifier, ['type', 'count', 'pct', 'totalReps', 'restSec']);
        if (!['dropset', 'restpause'].includes(e.intensifier.type)) fail();
        for (const [key, value] of Object.entries(e.intensifier)) if (key !== 'type' && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100000)) fail();
      }
    }
  }
  if (plan.week != null) {
    if (!object(plan.week)) fail();
    for (const [day, value] of Object.entries(plan.week)) {
      if (!/^[0-6]$/.test(day) || !(typeof value === 'string' || list(value, 100)) || [].concat(value).some(v => !ids.has(v))) fail();
    }
  }
  if (plan.customEx != null) {
    if (!list(plan.customEx, 100)) fail();
    const customs = new Set();
    for (const c of plan.customEx) {
      keys(c, ['id', 'n', 'bp', 'desc', 'url', 'eq', 'primaries', 'secondaries', 'tg', 'muscleGroups']);
      if (!id(c.id) || libraryHas(c.id) || customs.has(c.id) || !text(c.n) || !text(c.bp)) fail();
      customs.add(c.id);
      for (const field of ['desc', 'url', 'eq', 'tg']) if (c[field] != null && !text(c[field])) fail();
      for (const field of ['primaries', 'secondaries', 'muscleGroups']) if (c[field] != null && (!list(c[field], 30) || c[field].some(x => !text(x)))) fail();
    }
  }
  const known = new Set((plan.customEx || []).map(c => c.id));
  for (const r of plan.routines) for (const e of r.ex) if (!libraryHas(e.id) && !known.has(e.id)) fail();

}

export function importPlan(current, body) {
  keys(body, ['plan', 'baseRev', 'baseWid', 'schedule']);
  if (!Number.isSafeInteger(body.baseRev) || body.baseRev < 0 || (body.baseWid != null && !text(body.baseWid)) || (body.schedule != null && typeof body.schedule !== 'boolean')) fail();
  validatePlanFile(body.plan);
  const bundle = parsePlan(body.plan, current?.unit || 'kg');
  if (bundle.dropped) fail();                 // an unknown exercise is never silently omitted
  const next = structuredClone(current || { routines: [], customEx: [], week: {} });
  if (!Array.isArray(next.routines) || (next.customEx != null && !Array.isArray(next.customEx)) || (next.week != null && !object(next.week))) throw new Error('stored plan unreadable');
  next.week ||= {};
  const result = mergePlan(next, bundle, { schedule: body.schedule === true });
  return { next, ...result };
}

export function planView(state) {
  const { opengym_plan, unit, routines, customEx, week } = buildPlanBundle(state || {});
  return { opengym_plan, unit, routines, customEx, week };
}
