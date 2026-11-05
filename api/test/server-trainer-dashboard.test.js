/* The trainer dashboard end to end against the real server.js in a child process: a trainer
   connects, the member shares, the trainer reads the list and the detail (only what was shared),
   assigns a routine that lands in the member's own document through the sync stamps, suggests a
   weigh-in the member takes, comments, the member undoes, the gym lead looks, the member
   disconnects and the trainer gets 403. Then the gym join code and the "stay privately" offer. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boundPort } from './helpers.mjs';
import * as M from './media-samples.mjs';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = crypto.randomBytes(32).toString('hex');
const mint = uid => {
  const payload = `${uid}:${Date.now() + 86400000}:0`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
};
const USERS = [
  { id: 'u_admin', name: 'Adam', admin: true, owner: true },
  { id: 'u_marco', name: 'Marco' },
  { id: 'u_lena', name: 'Lena' },
  { id: 'u_lea', name: 'Lea' },
  { id: 'u_tim', name: 'Tim' },
];
const today = new Date().toISOString().slice(0, 10);
const daysAgo = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

async function start(t, env = {}, lea = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-dash-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users: USERS.map(u => ({ ...u, created: new Date().toISOString() })), creds: [], subs: [], invites: [] }));
  fs.writeFileSync(path.join(dataDir, 'state-u_lea.json'), JSON.stringify({
    unit: 'kg', _rev: 3, lang: 'de',
    workouts: [
      { id: 'w1', name: 'Push A', d: daysAgo(1), start: Date.now() - 86400000, end: Date.now() - 86400000 + 3000000, prs: ['bench'], note: 'felt strong',
        entries: [{ id: 'bench', sets: [{ w: 60, r: 5, done: true }, { w: 40, r: 8, done: true, warmup: true }], photo: 'deadbeef' }] },
      { id: 'w0', name: 'Legs', d: daysAgo(9), start: 1, end: 2, entries: [] },
    ],
    bodyweight: [{ d: daysAgo(14), w: 70 }, { d: daysAgo(1), w: 68.4 }], routines: [{ id: 'r1', name: 'Push A', ex: [{ id: 'bench' }] }],
    measurements: [{ d: daysAgo(3), waist: 80 }], dayNotes: { [daysAgo(2)]: { text: 'knee sore' } }, week: {}, ...lea
  }));
  fs.writeFileSync(path.join(dataDir, 'state-u_marco.json'), JSON.stringify({
    unit: 'kg', _rev: 1,
    routines: [{ id: 'm1', name: 'Full body', ex: [{ id: 'squat' }, { id: 'c_landmine', photo: 'abc' }], photo: 'x' }],
    customEx: [{ id: 'c_landmine', name: 'Landmine press', photo: 'f00d', video: 'beef', muscles: ['shoulders'] }]
  }));
  fs.writeFileSync(path.join(dataDir, 'state-u_tim.json'), JSON.stringify({ unit: 'kg', _rev: 1, workouts: [] }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost', TRAINERS: 'on', ...env }
  });
  const h = { log: '', dataDir };
  child.stdout.on('data', d => h.log += d);
  child.stderr.on('data', d => h.log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const port = await boundPort(child, () => h.log);
  h.call = async (who, method, p, body) => {
    const r = await fetch(`http://127.0.0.1:${port}${p}`, {
      method, headers: { 'Content-Type': 'application/json', ...(who ? { Cookie: `gymsid=${mint(who)}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  h.raw = (who, method, p, body, headers = {}) => fetch(`http://127.0.0.1:${port}${p}`, {
    method, headers: { ...(who ? { Cookie: `gymsid=${mint(who)}` } : {}), ...headers }, ...(body ? { body } : {})
  });
  h.state = uid => JSON.parse(fs.readFileSync(path.join(dataDir, `state-${uid}.json`), 'utf8'));
  return h;
}

// Admin, gym, trainer Marco and lead Lena; Lea connects with `scopes` and Marco says yes.
async function connected(h, scopes) {
  const { call } = h;
  const gym = (await call('u_admin', 'POST', '/api/admin/gyms/new', { name: 'FitBox' })).body.gym;
  await call('u_admin', 'POST', '/api/admin/gyms/staff', { gymId: gym.id, userId: 'u_marco', role: 'trainer' });
  await call('u_admin', 'POST', '/api/admin/gyms/staff', { gymId: gym.id, userId: 'u_lena', role: 'lead' });
  const { code } = (await call('u_marco', 'POST', '/api/trainer/codes', { gymId: gym.id })).body;
  const preview = (await call('u_lea', 'POST', '/api/sharing/code', { code })).body;
  const conn = (await call('u_lea', 'POST', '/api/sharing/connect', { code, scopes, consent: preview.consent, lang: 'de' })).body;
  assert.equal((await call('u_marco', 'POST', '/api/trainer/requests/answer', { id: conn.id, accept: true })).status, 200);
  return { gym, conn, consent: preview.consent };
}

test('connect, share, read, assign, suggest, comment, undo, lead, disconnect: 403', async t => {
  const h = await start(t);
  const { call } = h;
  // Off for strangers: Tim is nobody's trainer and Lea is nobody's member yet.
  assert.equal((await call('u_tim', 'GET', '/api/trainer/member?id=u_lea')).status, 404);

  const { gym, conn, consent } = await connected(h, { metrics: 'view', workouts: 'view', plans: 'apply', bodyweight: 'suggest' });
  // Lea hears about it: a notice in her inbox ("Marco is now your trainer").
  let inbox = (await call('u_lea', 'GET', '/api/sharing/inbox')).body;
  assert.equal(inbox.items.find(i => i.kind === 'notice').notice, 'connected');
  assert.equal(inbox.unseen, 1);

  // The list: last workout, streak, the PR flag, the weight trend.
  const list = (await call('u_marco', 'GET', `/api/trainer/members?today=${today}`)).body;
  assert.equal(list.members.length, 1);
  const row = list.members[0];
  assert.equal(row.member.name, 'Lea');
  assert.equal(row.summary.lastWorkout, daysAgo(1));
  assert.ok(row.summary.streak >= 1);
  assert.ok(row.summary.flags.some(f => f.kind === 'pr' && f.ex.includes('bench')));
  assert.ok(row.summary.flags.some(f => f.kind === 'weight' && f.delta === -1.6));

  // The detail: workouts without notes and media, plans, weight. Nothing of measurements or notes.
  let d = (await call('u_marco', 'GET', `/api/trainer/member?id=u_lea&today=${today}`)).body;
  assert.deepEqual(d.shared.sort(), ['bodyweight', 'metrics', 'plans', 'workouts']);
  assert.equal(d.workouts.list[0].id, 'w1');
  assert.equal(d.workouts.list[0].note, undefined);
  assert.equal(JSON.stringify(d.workouts).includes('deadbeef'), false);
  assert.equal(d.workouts.list[0].volume, 300);              // the warm-up does not count
  assert.equal(d.measurements, undefined);
  assert.equal(d.notes, undefined);
  assert.equal(d.plans.routines[0].name, 'Push A');
  // ...and it is in her log, once per category and day.
  const lg = (await call('u_lea', 'GET', '/api/sharing/log')).body.log;
  assert.ok(lg.some(e => e.ev === 'access' && e.cat === 'workouts' && e.actor.name === 'Marco'));

  // Assign Marco's own routine, onto Mondays: applied directly (plans at "Change directly").
  const revBefore = h.state('u_lea')._rev;
  const as = (await call('u_marco', 'POST', '/api/trainer/assign', { memberIds: ['u_lea', 'u_tim'], routineId: 'm1', day: 1, message: 'Take it easy the first week' })).body;
  assert.deepEqual(as.results.map(r => r.outcome), ['applied', 'skipped']);
  // Tim is not Marco's: skipped, and his name is not handed out either; an unknown id looks the same.
  assert.deepEqual(as.results[1], { memberId: 'u_tim', name: '', outcome: 'skipped', reason: 'not-shared' });
  const ghost = (await call('u_marco', 'POST', '/api/trainer/assign', { memberIds: ['u_ghost'], routineId: 'm1' })).body.results[0];
  assert.deepEqual(ghost, { memberId: 'u_ghost', name: '', outcome: 'skipped', reason: 'not-shared' });
  let S = h.state('u_lea');
  assert.equal(S._rev, revBefore + 1);
  const copy = S.routines.find(r => r.name === 'Full body');
  assert.equal(copy._by.name, 'Marco');
  assert.equal(copy.origin.kind, 'trainer');
  assert.equal(copy.origin.sourceId, 'm1');
  assert.equal(copy.photo, undefined);
  assert.ok(copy._ts > 0);
  assert.deepEqual(S.week['1'], [copy.id]);
  assert.ok(S.edited['week.1'] > 0);
  const land = S.customEx.find(c => c.id === 'c_landmine');
  assert.equal(land.name, 'Landmine press');
  assert.equal(land.photo, undefined); assert.equal(land.video, undefined);
  // Her phone, still on the old revision, gets a conflict and merges like with a second device.
  const stale = await call('u_lea', 'PUT', '/api/data', { state: { ...S, routines: [] }, baseRev: revBefore, stamped: true });
  assert.equal(stale.status, 409);
  assert.ok(stale.body.state.routines.some(r => r.id === copy.id));

  // A weigh-in: bodyweight only at "Suggest", so it waits in her inbox.
  const op = (await call('u_marco', 'POST', '/api/trainer/ops', { memberId: 'u_lea', ops: [{ op: 'bodyweight.put', d: today, w: 68.1 }] })).body;
  assert.deepEqual([op.applied, op.suggested], [0, 1]);
  assert.equal(h.state('u_lea').bodyweight.some(e => e.d === today), false);
  // Measurements are not shared at all: refused.
  assert.equal((await call('u_marco', 'POST', '/api/trainer/ops', { memberId: 'u_lea', ops: [{ op: 'measurement.put', d: today, values: { waist: 79 } }] })).status, 403);
  // Junk never gets through.
  assert.equal((await call('u_marco', 'POST', '/api/trainer/ops', { memberId: 'u_lea', ops: [{ op: 'custom.put', exercise: { id: 'x' } }] })).status, 400);
  inbox = (await call('u_lea', 'GET', '/api/sharing/inbox')).body;
  const sug = inbox.items.find(i => i.kind === 'suggest');
  assert.equal(sug.ops, undefined);                          // the client sees what it does, not the ops
  assert.equal(sug.summary[0].kind, 'bodyweight.put');
  assert.equal((await call('u_lea', 'POST', '/api/sharing/inbox/answer', { id: sug.id, accept: true })).body.status, 'accepted');
  assert.equal(h.state('u_lea').bodyweight.find(e => e.d === today)._by.name, 'Marco');

  // A comment on the workout lands in her inbox; Marco sees his own comments in the detail.
  assert.equal((await call('u_marco', 'POST', '/api/trainer/comment', { memberId: 'u_lea', workoutId: 'w1', text: 'Clean reps! 62.5 next week.' })).status, 200);
  assert.equal((await call('u_marco', 'POST', '/api/trainer/comment', { memberId: 'u_lea', workoutId: 'nope', text: 'x' })).status, 404);
  d = (await call('u_marco', 'GET', `/api/trainer/member?id=u_lea&today=${today}`)).body;
  assert.equal(d.comments.find(c => c.workoutId === 'w1').text, 'Clean reps! 62.5 next week.');
  assert.equal(d.changes.length, 1);

  // Lea undoes the assignment: the routine and the Monday go, as her own newest change.
  inbox = (await call('u_lea', 'GET', '/api/sharing/inbox')).body;
  const ch = inbox.undo.find(u => !u.accepted);
  assert.equal(ch.canUndo, true);
  assert.equal((await call('u_lea', 'POST', '/api/sharing/undo', { id: ch.id })).status, 200);
  S = h.state('u_lea');
  assert.equal(S.routines.some(r => r.id === copy.id), false);
  assert.ok(S.deleted.routines[copy.id] > 0);
  assert.equal(S.week['1'], undefined);
  assert.equal((await call('u_lea', 'POST', '/api/sharing/undo', { id: ch.id })).status, 409);

  // The gym lead sees Lea, never more than view, and cannot change anything.
  const g = (await call('u_lena', 'GET', `/api/gym?id=${gym.id}`)).body;
  assert.equal(g.members[0].member.name, 'Lea');
  assert.equal(g.members[0].sharesWithLead, true);
  assert.equal(g.members[0].trainers[0].name, 'Marco');
  assert.equal(g.trainers[0].members, 1);
  const ld = (await call('u_lena', 'GET', `/api/trainer/member?id=u_lea&today=${today}`)).body;
  assert.equal(ld.levels.plans, 'view');
  assert.equal((await call('u_lena', 'POST', '/api/trainer/ops', { memberId: 'u_lea', ops: [{ op: 'week.set', day: 2, ids: ['r1'] }] })).status, 403);
  assert.equal((await call('u_tim', 'GET', `/api/gym?id=${gym.id}`)).status, 404);

  // Workouts off: the detail drops them at once.
  await call('u_lea', 'POST', '/api/sharing/update', { id: conn.id, scopes: { metrics: 'view', workouts: 'off', plans: 'apply' }, consent });
  d = (await call('u_marco', 'GET', `/api/trainer/member?id=u_lea&today=${today}`)).body;
  assert.equal(d.workouts, undefined);

  // She disconnects: Marco knew her, so he hears 403, not "who?". Reads, writes and comments all.
  assert.equal((await call('u_lea', 'POST', '/api/sharing/disconnect', { id: conn.id })).status, 200);
  const gone = await call('u_marco', 'GET', `/api/trainer/member?id=u_lea&today=${today}`);
  assert.equal(gone.status, 403);
  assert.equal(gone.body.code, 'not-shared');
  assert.equal((await call('u_marco', 'POST', '/api/trainer/ops', { memberId: 'u_lea', ops: [{ op: 'week.set', day: 2, ids: ['r1'] }] })).status, 403);
  assert.equal((await call('u_marco', 'POST', '/api/trainer/comment', { memberId: 'u_lea', workoutId: 'w1', text: 'hi' })).status, 403);
  assert.equal((await call('u_marco', 'GET', '/api/trainer/members')).body.members.length, 0);
  // Tim, who never knew her, still hears 404.
  assert.equal((await call('u_tim', 'GET', '/api/trainer/member?id=u_lea')).status, 404);
});

test('a suggestion of a connection that ended lapses; "changed since" asks before undoing', async t => {
  const h = await start(t);
  const { call } = h;
  const { conn } = await connected(h, { metrics: 'view', plans: 'suggest', bodyweight: 'apply' });
  await call('u_marco', 'POST', '/api/trainer/ops', { memberId: 'u_lea', ops: [{ op: 'week.set', day: 3, ids: ['r1'] }] });
  const done = (await call('u_marco', 'POST', '/api/trainer/ops', { memberId: 'u_lea', ops: [{ op: 'bodyweight.put', d: today, w: 67 }] })).body;
  assert.equal(done.applied, 1);
  // Lea changes the same weigh-in herself on her phone...
  const S = h.state('u_lea');
  const mine = S.bodyweight.map(e => (e.d === today ? { d: today, w: 66.5, t: Date.now() + 5000 } : e));
  assert.equal((await call('u_lea', 'PUT', '/api/data', { state: { ...S, bodyweight: mine }, baseRev: S._rev, stamped: true })).status, 200);
  // ...so Undo asks first, and goes through when she says so.
  const u = (await call('u_lea', 'GET', '/api/sharing/inbox')).body.undo[0];
  assert.equal((await call('u_lea', 'POST', '/api/sharing/undo', { id: u.id })).body.code, 'changed-since');
  assert.equal((await call('u_lea', 'POST', '/api/sharing/undo', { id: u.id, force: true })).status, 200);
  assert.equal(h.state('u_lea').bodyweight.some(e => e.d === today), false);
  // Marco disconnects her; his open suggestion lapses and cannot be taken any more.
  await call('u_marco', 'POST', '/api/trainer/disconnect', { id: conn.id });
  const sug = (await call('u_lea', 'GET', '/api/sharing/inbox')).body.items.find(i => i.kind === 'suggest');
  assert.equal(sug.status, 'expired');
  assert.equal((await call('u_lea', 'POST', '/api/sharing/inbox/answer', { id: sug.id, accept: true })).status, 410);
});

test('gym join code, and a trainer leaving: stay connected privately', async t => {
  const h = await start(t);
  const { call } = h;
  const { gym } = await connected(h, { metrics: 'view', workouts: 'view' });
  // Lena hands out the gym's code; Marco, not a lead, cannot.
  assert.equal((await call('u_marco', 'POST', '/api/gym/code', { gymId: gym.id })).status, 403);
  const gc = (await call('u_lena', 'POST', '/api/gym/code', { gymId: gym.id })).body;
  assert.match(gc.code, /^GY-/);
  const pv = (await call('u_tim', 'POST', '/api/sharing/code', { code: gc.code })).body;
  assert.equal(pv.kind, 'gym');
  assert.equal(pv.consent.kind, 'lead');
  assert.equal((await call('u_tim', 'POST', '/api/sharing/connect', { code: gc.code, leadScopes: { metrics: 'view' }, consent: pv.consent })).status, 200);
  assert.equal((await call('u_tim', 'POST', '/api/sharing/connect', { code: gc.code, consent: pv.consent })).status, 409);
  let g = (await call('u_lena', 'GET', `/api/gym?id=${gym.id}`)).body;
  const tim = g.members.find(m => m.member.id === 'u_tim');
  assert.equal(tim.sharesWithLead, true);
  assert.equal(tim.levels.metrics, 'view');
  assert.equal(tim.levels.workouts, 'off');

  // Lena takes Marco off the gym. Lea's connection pauses; Marco may not train outside a gym, so
  // there is nothing to offer her, and it simply waits for him to come back.
  assert.equal((await call('u_lena', 'POST', '/api/gym/staff', { gymId: gym.id, user: 'u_marco', on: false })).status, 200);
  assert.equal((await call('u_marco', 'GET', `/api/trainer/member?id=u_lea`)).status, 403);
  assert.equal((await call('u_lea', 'GET', '/api/sharing/inbox')).body.items.some(i => i.kind === 'offer'), false);
  assert.equal((await call('u_lena', 'POST', '/api/gym/staff', { gymId: gym.id, user: 'u_marco', on: true })).status, 200);
  assert.equal((await call('u_marco', 'GET', `/api/trainer/member?id=u_lea`)).status, 200);
  // Now an admin lets him train freely, and Lena takes him off again: this time Lea gets the offer.
  await call('u_admin', 'POST', '/api/admin/user/trainer', { id: 'u_marco', free: true });
  assert.equal((await call('u_lena', 'POST', '/api/gym/staff', { gymId: gym.id, user: 'u_marco', on: false })).status, 200);
  const offer = (await call('u_lea', 'GET', '/api/sharing/inbox')).body.items.find(i => i.kind === 'offer');
  assert.deepEqual(offer.names, ['Marco', 'FitBox']);
  assert.ok(offer.expires > Date.now() + 29 * 86400000);
  // She keeps him: a private connection, without the lead row, working at once.
  const sharing = (await call('u_lea', 'GET', '/api/sharing')).body;
  const yes = (await call('u_lea', 'POST', '/api/sharing/inbox/answer', { id: offer.id, accept: true, consent: sharing.consent })).body;
  assert.equal(yes.status, 'accepted');
  assert.equal(yes.paused, null);
  const list = (await call('u_marco', 'GET', '/api/trainer/members')).body.members;
  assert.equal(list.length, 1);
  assert.equal(list[0].gym, null);
  assert.equal(list[0].levels.workouts, 'view');
  // The gym lead still sees Lea through her own lead row; the old studio grant is over.
  g = (await call('u_lena', 'GET', `/api/gym?id=${gym.id}`)).body;
  assert.equal(g.members.find(m => m.member.id === 'u_lea').sharesWithLead, true);
  assert.equal(g.members.find(m => m.member.id === 'u_lea').trainers.length, 0);
});

test('nothing of it with TRAINERS off', async t => {
  const h = await start(t, { TRAINERS: '' });
  for (const [m, p] of [['GET', '/api/trainer/members'], ['GET', '/api/trainer/member?id=u_lea'], ['POST', '/api/trainer/ops'], ['GET', '/api/sharing/inbox'], ['GET', '/api/gym?id=x']]) {
    const r = await h.call('u_marco', m, p, m === 'POST' ? {} : undefined);
    assert.equal(r.status, 404, p);
    assert.equal(r.body.code, 'trainers-off');
  }
});

test('progress photos: a trainer with the photos grant sees them, without it 403, other media never', async t => {
  const day = M.jpeg(1200), onWorkout = M.jpeg(1300), custom = M.jpeg(1400), video = M.jpeg(1500);
  const ref = (b, mime = 'image/jpeg') => ({ kind: 'image', hash: M.sha(b), mime, size: b.length, width: 3, height: 4, at: 1 });
  const h = await start(t, {}, {
    dayPhotos: { [M.sha(day)]: { d: daysAgo(4), m: ref(day), _ts: 1 } },
    customEx: [{ id: 'c_me', name: 'Mine', media: ref(custom) }],
    avatar: { m: ref(video) },
  });
  const { call } = h;
  // The workout photo rides on w1 (the fixture's first workout).
  const S = h.state('u_lea');
  S.workouts[0].media = [ref(onWorkout)];
  fs.writeFileSync(path.join(h.dataDir, 'state-u_lea.json'), JSON.stringify(S));
  for (const b of [day, onWorkout, custom, video]) {
    assert.equal((await h.raw('u_lea', 'PUT', `/api/media/${M.sha(b)}`, b, { 'Content-Type': 'image/jpeg', Origin: 'http://localhost:8080' })).status, 201);
  }
  const photo = (who, b) => h.raw(who, 'GET', `/api/trainer/member/photo?id=u_lea&hash=${M.sha(b)}`);

  // Nobody's trainer yet: 404, nothing to learn.
  assert.equal((await photo('u_tim', day)).status, 404);
  const { conn, consent } = await connected(h, { metrics: 'view', workouts: 'view' });
  // Connected, but photos are not shared: 403, and the detail has no photos at all.
  const no = await photo('u_marco', day);
  assert.equal(no.status, 403);
  assert.equal((await no.json()).code, 'level');
  assert.equal((await call('u_marco', 'GET', `/api/trainer/member?id=u_lea&today=${today}`)).body.photos, undefined);
  assert.equal((await photo('u_tim', day)).status, 404);

  // She shares them: both progress photos, newest first, with the locked-down headers.
  await call('u_lea', 'POST', '/api/sharing/update', { id: conn.id, scopes: { metrics: 'view', workouts: 'view', photos: 'view' }, consent });
  const d = (await call('u_marco', 'GET', `/api/trainer/member?id=u_lea&today=${today}`)).body;
  assert.equal(d.photos.count, 2);
  assert.deepEqual(d.photos.items.map(p => p.hash), [M.sha(onWorkout), M.sha(day)]);
  assert.equal(d.photos.items[0].workoutId, 'w1');
  const ok = await photo('u_marco', day);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('content-type'), 'image/jpeg');
  assert.equal(ok.headers.get('cache-control'), 'private, no-store');
  assert.match(ok.headers.get('content-security-policy'), /sandbox/);
  assert.ok(Buffer.from(await ok.arrayBuffer()).equals(day));
  assert.equal((await photo('u_marco', onWorkout)).status, 200);
  // Her custom exercise's picture and her profile picture are not progress photos.
  assert.equal((await photo('u_marco', custom)).status, 404);
  assert.equal((await photo('u_marco', video)).status, 404);
  assert.equal((await h.raw('u_marco', 'GET', '/api/trainer/member/photo?id=u_lea&hash=nope')).status, 400);
  // Her own media route still only ever answers her.
  assert.equal((await h.raw('u_marco', 'GET', `/api/media/${M.sha(day)}`)).status, 404);
  // The look is in her log.
  const lg = (await call('u_lea', 'GET', '/api/sharing/log')).body.log;
  assert.ok(lg.some(e => e.ev === 'access' && e.cat === 'photos' && e.actor.name === 'Marco'));

  // Photos off again: 403 on the very next file.
  await call('u_lea', 'POST', '/api/sharing/update', { id: conn.id, scopes: { metrics: 'view', workouts: 'view', photos: 'off' }, consent });
  assert.equal((await photo('u_marco', day)).status, 403);
});

test('workout.edit: a correction applied with "Change directly", suggested otherwise, undone by the member', async t => {
  const h = await start(t);
  const { call } = h;
  const { conn, consent } = await connected(h, { metrics: 'view', workouts: 'apply' });
  const fix = { op: 'workout.edit', id: 'w1', sets: [{ e: 0, s: 0, ex: 'bench', w: 62.5 }] };
  const r = (await call('u_marco', 'POST', '/api/trainer/ops', { memberId: 'u_lea', ops: [fix] })).body;
  assert.deepEqual([r.applied, r.suggested], [1, 0]);
  let w = h.state('u_lea').workouts.find(x => x.id === 'w1');
  assert.equal(w.entries[0].sets[0].w, 62.5);
  assert.equal(w._edit.name, 'Marco');
  assert.equal(w.note, 'felt strong');                      // the rest of her workout untouched
  const d = (await call('u_marco', 'GET', `/api/trainer/member?id=u_lea&today=${today}`)).body;
  assert.equal(d.workouts.list[0]._edit.name, 'Marco');
  assert.equal(d.changes[0].summary[0].kind, 'workout.edit');
  // Her Undo puts the 60 back.
  const inbox = (await call('u_lea', 'GET', '/api/sharing/inbox')).body;
  assert.equal((await call('u_lea', 'POST', '/api/sharing/undo', { id: inbox.undo[0].id })).status, 200);
  w = h.state('u_lea').workouts.find(x => x.id === 'w1');
  assert.equal(w.entries[0].sets[0].w, 60);

  // At "Suggest" it waits for her; at "See" it is refused.
  await call('u_lea', 'POST', '/api/sharing/update', { id: conn.id, scopes: { metrics: 'view', workouts: 'suggest' }, consent });
  const s = (await call('u_marco', 'POST', '/api/trainer/ops', { memberId: 'u_lea', ops: [{ ...fix, name: 'Push A (fixed)' }] })).body;
  assert.deepEqual([s.applied, s.suggested], [0, 1]);
  assert.equal(h.state('u_lea').workouts.find(x => x.id === 'w1').name, 'Push A');
  await call('u_lea', 'POST', '/api/sharing/update', { id: conn.id, scopes: { metrics: 'view', workouts: 'view' }, consent });
  assert.equal((await call('u_marco', 'POST', '/api/trainer/ops', { memberId: 'u_lea', ops: [fix] })).status, 403);
});

test('an offer to stay privately lapses once the trainer may no longer train freely', async t => {
  const h = await start(t);
  const { call } = h;
  const { gym } = await connected(h, { metrics: 'view' });
  await call('u_admin', 'POST', '/api/admin/user/trainer', { id: 'u_marco', free: true });
  await call('u_lena', 'POST', '/api/gym/staff', { gymId: gym.id, user: 'u_marco', on: false });
  const offer = (await call('u_lea', 'GET', '/api/sharing/inbox')).body.items.find(i => i.kind === 'offer');
  assert.ok(offer);
  await call('u_admin', 'POST', '/api/admin/user/trainer', { id: 'u_marco', free: false });
  const sharing = (await call('u_lea', 'GET', '/api/sharing')).body;
  const r = await call('u_lea', 'POST', '/api/sharing/inbox/answer', { id: offer.id, accept: true, consent: sharing.consent });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'not-free');
  assert.equal((await call('u_lea', 'GET', '/api/sharing/inbox')).body.items.find(i => i.id === offer.id).status, 'lapsed');
  assert.equal((await call('u_lea', 'GET', '/api/sharing')).body.grants?.some?.(g => !g.gym && g.status === 'active') ?? false, false);
});
