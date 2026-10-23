import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { atomicWrite } from './durable.js';

const object = v => v && typeof v === 'object' && !Array.isArray(v);
const text = v => typeof v === 'string' && v.length <= 10000;
const number = v => Number.isFinite(v) && v >= 0 && v <= 100000;
const bool = v => typeof v === 'boolean';
const list = (check, max = 1000) => v => Array.isArray(v) && v.length <= max && v.every(check);
const shape = fields => v => object(v) && Object.entries(v).every(([k, value]) => Object.hasOwn(fields, k) && fields[k](value));
const exercise = shape(Object.fromEntries([
  ...['id', 'mode', 'prog', 'dbLoad', 'sg', 'note'].map(k => [k, text]),
  ...['sets', 'reps', 'weight', 'min', 'speed', 'sec', 'inc', 'deloadFactor', 'repsMin', 'repsMax', 'setsMax', 'restSec', 'warmupRestSec', 'warmupSets'].map(k => [k, number]),
  ...['bodyweight', 'side', 'backoff', 'lastToFailure'].map(k => [k, bool]),
  ['intensifier', shape({ type: v => ['dropset', 'restpause'].includes(v), count: number, pct: number, totalReps: number, restSec: number })],
]));
const custom = shape({ id: text, n: text, bp: text, desc: text, eq: text, tg: text,
  url: v => text(v) && /^https?:\/\//i.test(v), primaries: list(text), secondaries: list(text), muscleGroups: list(text) });
const routine = shape({ id: text, name: text, emoji: text, prog: text, excludeFromProgression: bool, ex: list(exercise) });
const session = shape({ routineRef: text, prescription: list(shape({ notes: text, workRestSec: number, rir: v => number(v) && v <= 10 })) });
const day = shape({ weekday: v => Number.isInteger(v) && v >= 0 && v <= 6, sessions: list(session, 100) });
const week = shape({ mode: v => ['normal', 'rest', 'deload'].includes(v), days: list(day, 7) });
const programme = shape({ name: text, emoji: text, progression: text, colour: v => v === null || text(v), weeks: list(week, 52) });
const plan = shape({ opengym_plan: v => v === 1, exported: text, name: text, unit: v => ['kg', 'lb'].includes(v), week: v => object(v) && !Object.keys(v).length, routines: list(routine), customEx: list(custom) });
const bundleShape = shape({ opengym_programme: v => v === 1, exported: text, unit: v => ['kg', 'lb'].includes(v), programme, plan });

// Publication accepts only the file-sharing fields, never an account document or private media.
// The recipient also runs the existing full Programme parser before offering an import.
export function validateSharedProgramme(bundle) {
  if (!bundleShape(bundle) || bundle.opengym_programme !== 1 || !['kg', 'lb'].includes(bundle.unit) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(bundle.exported) || !bundle.programme?.name?.trim() || bundle.programme.name.length > 200 ||
      !['off', 'linear', 'greyskull', 'double', 'triple', 'time'].includes(bundle.programme.progression) ||
      !bundle.programme.weeks?.length || !bundle.plan?.routines?.length || !Array.isArray(bundle.plan.customEx) ||
      bundle.plan.unit !== bundle.unit || !object(bundle.plan.week) || bundle.plan.opengym_plan !== 1 ||
      Buffer.byteLength(JSON.stringify(bundle)) > 2 * 1024 * 1024) throw new Error('Invalid Programme file');
  const refs = new Map(bundle.plan.routines.map(r => [r.id, r]));
  if (refs.size !== bundle.plan.routines.length || [...refs].some(([id, r]) => !/^programme-routine-[1-9]\d*$/.test(id) || !r.name?.trim() || !Array.isArray(r.ex) || r.ex.some(e => !e.id || !Number.isInteger(e.sets) || e.sets < 1))) throw new Error('Invalid routines');
  const used = new Set(); let scheduled = 0;
  for (const w of bundle.programme.weeks) {
    if (!Array.isArray(w.days) || new Set(w.days.map(d => d.weekday)).size !== w.days.length) throw new Error('Invalid days');
    for (const d of w.days) {
      if (!Array.isArray(d.sessions) || !Number.isInteger(d.weekday)) throw new Error('Invalid sessions');
      for (const s of d.sessions) {
        const r = refs.get(s.routineRef);
        if (!r || (s.prescription && s.prescription.length !== r.ex.length)) throw new Error('Invalid routine reference');
        used.add(s.routineRef); if (w.mode !== 'rest') scheduled++;
      }
    }
  }
  const exercises = new Set(bundle.plan.routines.flatMap(r => r.ex.map(e => e.id)));
  if (!scheduled || used.size !== refs.size || bundle.plan.customEx.some(e => !e.id || !e.n?.trim() || !exercises.has(e.id))) throw new Error('Invalid Programme references');
  return bundle;
}

export function sharedProgrammeRoutes({ data, json, readBody, readSession, requireAdmin, audit }) {
  const file = path.join(data, 'shared-programmes.json');
  const read = () => {
    let raw;
    try { raw = fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return { revision: 0, programmes: [] }; throw e; }
    const value = JSON.parse(raw);
    if (!Number.isInteger(value.revision) || !Array.isArray(value.programmes)) throw new Error('Shared library unreadable');
    return value;
  };
  const summary = ({ id, bundle, updatedAt }) => ({ id, name: bundle.programme.name, weeks: bundle.programme.weeks.length, updatedAt });
  return {
    'GET /api/shared-programmes': async (req, res) => {
      if (!readSession(req)) return json(res, 401, { error: 'not signed in' });
      const catalogue = read(), id = new URL(req.url, 'http://localhost').searchParams.get('id');
      if (!id) return json(res, 200, { programmes: catalogue.programmes.map(summary) });
      const entry = catalogue.programmes.find(p => p.id === id);
      return entry ? json(res, 200, { bundle: entry.bundle }) : json(res, 404, { error: 'Programme is no longer shared' });
    },
    'GET /api/admin/shared-programmes': async (req, res) => {
      const admin = requireAdmin(req, res); if (!admin) return;
      const catalogue = read();
      json(res, 200, { revision: catalogue.revision, programmes: catalogue.programmes.map(p => ({ ...summary(p), ...(p.ownerUid === admin.id ? { sourceId: p.sourceId } : {}) })) });
    },
    'POST /api/admin/shared-programmes': async (req, res) => {
      const admin = requireAdmin(req, res); if (!admin) return;
      const body = await readBody(req), catalogue = read();
      if (body.revision !== catalogue.revision) return json(res, 409, { error: 'The shared library changed. Reload and try again.' });
      if (typeof body.sourceId !== 'string' || !body.sourceId.trim() || body.sourceId.length > 200) return json(res, 400, { error: 'Programme required' });
      try { validateSharedProgramme(body.bundle); } catch { return json(res, 400, { error: 'Invalid Programme file' }); }
      const old = catalogue.programmes.find(p => p.ownerUid === admin.id && p.sourceId === body.sourceId);
      if (!old && catalogue.programmes.length >= 100) return json(res, 400, { error: 'Shared library is full' });
      const entry = { id: old?.id || crypto.randomUUID(), ownerUid: admin.id, sourceId: body.sourceId, bundle: body.bundle, updatedAt: new Date().toISOString() };
      const next = { revision: catalogue.revision + 1, programmes: [...catalogue.programmes.filter(p => p.id !== entry.id), entry] };
      if (Buffer.byteLength(JSON.stringify(next)) > 10 * 1024 * 1024) return json(res, 400, { error: 'Shared library is full' });
      atomicWrite(file, JSON.stringify(next), 0o600);
      audit(req, 'admin.programme.share', { user: admin, msg: entry.id });
      json(res, 200, { ok: true });
    },
    'DELETE /api/admin/shared-programmes': async (req, res) => {
      const admin = requireAdmin(req, res); if (!admin) return;
      const body = await readBody(req), catalogue = read();
      if (body.revision !== catalogue.revision) return json(res, 409, { error: 'The shared library changed. Reload and try again.' });
      if (!catalogue.programmes.some(p => p.id === body.id)) return json(res, 404, { error: 'Programme is no longer shared' });
      atomicWrite(file, JSON.stringify({ revision: catalogue.revision + 1, programmes: catalogue.programmes.filter(p => p.id !== body.id) }), 0o600);
      audit(req, 'admin.programme.unshare', { user: admin, msg: body.id });
      json(res, 200, { ok: true });
    },
  };
}
