/* permissions.js: every role, and the abuse cases from the trainer design (8.4). The store runs
   in memory (no file), and the clock is ours, so every case reads like the story it tells. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOrgStore } from '../trainers/org-store.js';
import { createPermissions } from '../permissions.js';
import { CATEGORY_IDS } from '../trainers/scopes.js';

function world({ trainers = true, adminDataView = false, leadMode = 'row' } = {}) {
  const users = [
    { id: 'owner', name: 'Olga', admin: true, owner: true },
    { id: 'admin', name: 'Adam', admin: true },
    { id: 'lead', name: 'Lena' },
    { id: 'lead2', name: 'Lars' },
    { id: 'marco', name: 'Marco' },
    { id: 'sara', name: 'Sara' },
    { id: 'free', name: 'Fritz' },
    { id: 'lea', name: 'Lea' },
    { id: 'tim', name: 'Tim' },
    { id: 'off', name: 'Otto', disabled: true },
  ];
  const flags = { trainers, adminDataView, sharing: true };
  const org = createOrgStore({ file: null, leadMode });
  const byId = id => users.find(u => u.id === id) || null;
  const { can } = createPermissions({ org, userById: byId, isAdmin: u => !!u?.admin, isOwner: u => !!u?.owner, flags: () => flags });
  const fit = org.createGym({ name: 'FitBox', contact: 'privacy@fitbox.test' });
  const iron = org.createGym({ name: 'Iron Den' });
  org.setStaff(fit.id, 'lead', 'lead', true);
  org.setStaff(fit.id, 'marco', 'trainer', true);
  org.setStaff(iron.id, 'lead2', 'lead', true);
  org.setStaff(iron.id, 'sara', 'trainer', true);
  org.setFreeTrainer('free', true);
  // A member says yes to a trainer's code, the trainer confirms.
  const link = (memberId, trainerId, gymId, scopes, leadPicked) => {
    const { code } = org.createCode({ ownerId: trainerId, gymId });
    const { grant, lead } = org.connect({ memberId, code: org.findCode(code), scopes, leadPicked });
    org.answer(trainerId, grant.id, true);
    return { grant, lead };
  };
  return { users, byId, flags, org, can, fit, iron, link, u: byId };
}
const ALL = { metrics: 'view', workouts: 'apply', plans: 'apply', bodyweight: 'suggest', measurements: 'view', photos: 'view', notes: 'view', nutrition: 'view' };

test('a member always may do everything with their own data', () => {
  const w = world();
  for (const cat of CATEGORY_IDS) for (const a of ['view', 'suggest', 'apply']) {
    assert.equal(w.can(w.u('lea'), a, { memberId: 'lea' }, cat).ok, true, `${a} ${cat}`);
  }
});

test('a studio trainer gets exactly the levels the member picked, per category', () => {
  const w = world();
  w.link('lea', 'marco', w.fit.id, { metrics: 'view', workouts: 'view', plans: 'suggest', bodyweight: 'apply' });
  const m = w.u('marco');
  assert.equal(w.can(m, 'view', { memberId: 'lea' }, 'workouts').ok, true);
  assert.equal(w.can(m, 'suggest', { memberId: 'lea' }, 'workouts').ok, false);
  assert.equal(w.can(m, 'suggest', { memberId: 'lea' }, 'workouts').status, 403);
  assert.equal(w.can(m, 'suggest', { memberId: 'lea' }, 'plans').ok, true);
  assert.equal(w.can(m, 'apply', { memberId: 'lea' }, 'plans').ok, false);
  assert.equal(w.can(m, 'apply', { memberId: 'lea' }, 'bodyweight').ok, true);
  // Off is "no such member", not "forbidden".
  const photos = w.can(m, 'view', { memberId: 'lea' }, 'photos');
  assert.equal(photos.ok, false); assert.equal(photos.status, 404);
  // Comments ride on workouts: view.
  assert.equal(w.can(m, 'comment', { memberId: 'lea' }, 'workouts').ok, true);
  assert.equal(w.can(m, 'comment', { memberId: 'lea' }, 'plans').ok, false);
});

test('a pending connection gives nothing until the trainer confirms it', () => {
  const w = world();
  const { code } = w.org.createCode({ ownerId: 'marco', gymId: w.fit.id });
  const { grant } = w.org.connect({ memberId: 'lea', code: w.org.findCode(code), scopes: ALL });
  assert.equal(w.can(w.u('marco'), 'view', { memberId: 'lea' }, 'workouts').ok, false);
  w.org.answer('marco', grant.id, true);
  assert.equal(w.can(w.u('marco'), 'view', { memberId: 'lea' }, 'workouts').ok, true);
});

test('an ex-trainer after disconnect: refused from the very next check, by either side', () => {
  const w = world();
  const { grant } = w.link('lea', 'marco', w.fit.id, ALL);
  assert.equal(w.can(w.u('marco'), 'view', { memberId: 'lea' }, 'workouts').ok, true);
  w.org.endGrant(grant.id, 'member');
  const r = w.can(w.u('marco'), 'view', { memberId: 'lea' }, 'workouts');
  assert.equal(r.ok, false); assert.equal(r.status, 404);
  // And the trainer side: Tim disconnects from the trainer's end.
  const t = w.link('tim', 'free', null, ALL);
  w.org.endGrant(t.grant.id, 'trainer');
  assert.equal(w.can(w.u('free'), 'view', { memberId: 'tim' }, 'workouts').ok, false);
  // The lead row went with Lea's trainer grant.
  assert.equal(w.can(w.u('lead'), 'view', { memberId: 'lea' }, 'workouts').ok, false);
});

test('a trainer who left the gym is paused at once, and back if re-added', () => {
  const w = world();
  w.link('lea', 'marco', w.fit.id, ALL);
  w.org.setStaff(w.fit.id, 'marco', 'trainer', false);
  assert.equal(w.can(w.u('marco'), 'view', { memberId: 'lea' }, 'workouts').ok, false);
  w.org.setStaff(w.fit.id, 'marco', 'trainer', true);
  assert.equal(w.can(w.u('marco'), 'view', { memberId: 'lea' }, 'workouts').ok, true);
  // A disabled gym pauses its trainers and its lead alike.
  w.org.updateGym(w.fit.id, { disabled: true });
  assert.equal(w.can(w.u('marco'), 'view', { memberId: 'lea' }, 'workouts').ok, false);
  assert.equal(w.can(w.u('lead'), 'view', { memberId: 'lea' }, 'workouts').ok, false);
});

test('a free trainer whose free status an admin takes away is paused', () => {
  const w = world();
  w.link('tim', 'free', null, ALL);
  assert.equal(w.can(w.u('free'), 'view', { memberId: 'tim' }, 'metrics').ok, true);
  w.org.setFreeTrainer('free', false);
  assert.equal(w.can(w.u('free'), 'view', { memberId: 'tim' }, 'metrics').ok, false);
});

test('a member with several trainers: each sees only their own grant, never more', () => {
  const w = world();
  w.link('lea', 'marco', w.fit.id, { metrics: 'view', workouts: 'view' });
  w.link('lea', 'free', null, { metrics: 'view', plans: 'apply', bodyweight: 'view' });
  const m = w.u('marco'), f = w.u('free');
  assert.equal(w.can(m, 'view', { memberId: 'lea' }, 'workouts').ok, true);
  assert.equal(w.can(m, 'view', { memberId: 'lea' }, 'plans').ok, false);
  assert.equal(w.can(m, 'view', { memberId: 'lea' }, 'bodyweight').ok, false);
  assert.equal(w.can(f, 'apply', { memberId: 'lea' }, 'plans').ok, true);
  assert.equal(w.can(f, 'view', { memberId: 'lea' }, 'workouts').ok, false);
  // Ending one leaves the other alone.
  const fg = w.org.get().grants.find(g => g.granteeId === 'free' && g.memberId === 'lea');
  w.org.endGrant(fg.id, 'member');
  assert.equal(w.can(f, 'view', { memberId: 'lea' }, 'metrics').ok, false);
  assert.equal(w.can(m, 'view', { memberId: 'lea' }, 'metrics').ok, true);
});

test('the gym lead sees through their own consent row, never more than view, never another gym', () => {
  const w = world();
  w.link('lea', 'marco', w.fit.id, ALL, { metrics: 'view', workouts: 'view', plans: 'view', bodyweight: 'off' });
  const l = w.u('lead');
  assert.equal(w.can(l, 'view', { memberId: 'lea' }, 'workouts').ok, true);
  assert.equal(w.can(l, 'suggest', { memberId: 'lea' }, 'plans').ok, false, 'the lead row never writes');
  assert.equal(w.can(l, 'view', { memberId: 'lea' }, 'bodyweight').ok, false, 'untick one category');
  // A lead in another studio sees nothing of Lea, and cannot tell she exists.
  const other = w.can(w.u('lead2'), 'view', { memberId: 'lea' }, 'workouts');
  assert.equal(other.ok, false); assert.equal(other.status, 404);
  // Nor can a trainer of the other studio.
  assert.equal(w.can(w.u('sara'), 'view', { memberId: 'lea' }, 'metrics').ok, false);
  // The lead manages trainers in their own gym only, and never other leads.
  assert.equal(w.can(l, 'gym:staff', { gymId: w.fit.id, role: 'trainer' }).ok, true);
  assert.equal(w.can(l, 'gym:staff', { gymId: w.fit.id, role: 'lead' }).ok, false);
  assert.equal(w.can(l, 'gym:staff', { gymId: w.iron.id, role: 'trainer' }).ok, false);
  assert.equal(w.can(l, 'gym:members', { gymId: w.fit.id }).ok, true);
  assert.equal(w.can(l, 'gym:members', { gymId: w.iron.id }).ok, false);
});

test('a member who leaves the gym ends the lead row and the studio trainer, not a private one', () => {
  const w = world();
  w.link('lea', 'marco', w.fit.id, ALL);
  w.link('lea', 'free', null, ALL);
  w.org.leaveGym('lea', w.fit.id);
  assert.equal(w.can(w.u('lead'), 'view', { memberId: 'lea' }, 'metrics').ok, false);
  assert.equal(w.can(w.u('marco'), 'view', { memberId: 'lea' }, 'metrics').ok, false);
  assert.equal(w.can(w.u('free'), 'view', { memberId: 'lea' }, 'metrics').ok, true);
});

test('lead modes: mirror follows the trainer, none shows the lead nothing', () => {
  const m = world({ leadMode: 'mirror' });
  m.link('lea', 'marco', m.fit.id, { metrics: 'view', plans: 'apply' }, { metrics: 'off' });
  assert.equal(m.can(m.u('lead'), 'view', { memberId: 'lea' }, 'metrics').ok, true, 'mirror ignores a pick');
  assert.equal(m.can(m.u('lead'), 'view', { memberId: 'lea' }, 'plans').ok, true);
  assert.equal(m.can(m.u('lead'), 'suggest', { memberId: 'lea' }, 'plans').ok, false);
  const n = world({ leadMode: 'none' });
  n.link('lea', 'marco', n.fit.id, ALL);
  assert.equal(n.can(n.u('lead'), 'view', { memberId: 'lea' }, 'metrics').ok, false);
});

test('an admin without ADMIN_DATA_VIEW reads no member data, with it only through admin:data-view', () => {
  const w = world();
  const a = w.u('admin');
  assert.equal(w.can(a, 'admin:data-view', { memberId: 'lea' }).ok, false);
  assert.equal(w.can(a, 'admin:data-view', { memberId: 'lea' }).reason, 'data-view-off');
  // Being admin is never a way into the trainer routes either.
  assert.equal(w.can(a, 'view', { memberId: 'lea' }, 'workouts').ok, false);
  assert.equal(w.can(w.u('owner'), 'view', { memberId: 'lea' }, 'workouts').ok, false);
  w.flags.adminDataView = true;
  assert.equal(w.can(a, 'admin:data-view', { memberId: 'lea' }).ok, true);
  assert.equal(w.can(a, 'admin:data-view', { memberId: 'nobody' }).status, 404);
  assert.equal(w.can(w.u('marco'), 'admin:data-view', { memberId: 'lea' }).ok, false);
  // Admins create and run gyms; nobody else does.
  assert.equal(w.can(a, 'gym:create').ok, true);
  assert.equal(w.can(w.u('lead'), 'gym:create').ok, false);
  assert.equal(w.can(w.u('marco'), 'gym:manage', { gymId: w.fit.id }).ok, false);
});

test('who may invite: a gym trainer for that gym, a free trainer without one, nobody else', () => {
  const w = world();
  assert.equal(w.can(w.u('marco'), 'trainer:invite', { gymId: w.fit.id }).ok, true);
  assert.equal(w.can(w.u('marco'), 'trainer:invite', { gymId: w.iron.id }).ok, false);
  assert.equal(w.can(w.u('marco'), 'trainer:invite', {}).ok, false, 'not a free trainer');
  assert.equal(w.can(w.u('free'), 'trainer:invite', {}).ok, true);
  assert.equal(w.can(w.u('lead'), 'trainer:invite', { gymId: w.fit.id }).ok, false, 'a lead trains only with a trainer role');
  assert.equal(w.can(w.u('lea'), 'trainer:invite', {}).ok, false);
  assert.equal(w.can(w.u('admin'), 'trainer:invite', {}).ok, false);
});

test('disabled accounts, signed-out callers and the TRAINERS switch', () => {
  const w = world();
  w.link('lea', 'marco', w.fit.id, ALL);
  assert.equal(w.can(null, 'view', { memberId: 'lea' }, 'metrics').status, 401);
  assert.equal(w.can(w.u('off'), 'view', { memberId: 'lea' }, 'metrics').status, 401);
  // A disabled member is not there for a trainer.
  w.u('lea').disabled = true;
  assert.equal(w.can(w.u('marco'), 'view', { memberId: 'lea' }, 'metrics').status, 404);
  w.u('lea').disabled = false;
  w.flags.trainers = false;
  assert.equal(w.can(w.u('marco'), 'view', { memberId: 'lea' }, 'metrics').reason, 'off');
  assert.equal(w.can(w.u('marco'), 'trainer:invite', { gymId: w.fit.id }).ok, false);
  assert.equal(w.can(w.u('marco'), 'view', { memberId: 'lea' }, 'bogus').ok, false);
});

test('a stored lead grant with write levels is still read as view', () => {
  const w = world();
  const { lead } = w.link('lea', 'marco', w.fit.id, ALL);
  w.org.get().grants.find(g => g.id === lead.id).scopes.plans = 'apply';   // a hand-edited org.json
  assert.equal(w.can(w.u('lead'), 'apply', { memberId: 'lea' }, 'plans').ok, false);
  assert.equal(w.can(w.u('lead'), 'view', { memberId: 'lea' }, 'plans').ok, true);
});

test('library: instance items for everyone, studio items for that studio, moderation for admins and leads', () => {
  const w = world();
  w.link('lea', 'marco', w.fit.id, ALL);              // Lea is now a FitBox member
  const open = { id: 's_1', owner: 'lea', status: 'live', gymId: null };
  const studio = { id: 's_2', owner: 'lea', status: 'live', gymId: w.fit.id };
  const hidden = { id: 's_3', owner: 'lea', status: 'hidden', gymId: null };
  assert.equal(w.can(w.u('tim'), 'library:read', { item: open }).ok, true);
  assert.equal(w.can(w.u('tim'), 'library:read', { item: studio }).status, 404);
  assert.equal(w.can(w.u('marco'), 'library:read', { item: studio }).ok, true);
  assert.equal(w.can(w.u('lead2'), 'library:import', { item: studio }).ok, false);
  assert.equal(w.can(w.u('tim'), 'library:read', { item: hidden }).ok, false);
  assert.equal(w.can(w.u('lea'), 'library:read', { item: hidden }).ok, true, 'the owner sees their own');
  assert.equal(w.can(w.u('tim'), 'library:import', { item: hidden }).ok, false);
  assert.equal(w.can(w.u('tim'), 'library:edit', { item: open }).status, 403);
  assert.equal(w.can(w.u('lea'), 'library:edit', { item: open }).ok, true);
  assert.equal(w.can(w.u('tim'), 'library:publish', { gymId: w.fit.id }).ok, false);
  assert.equal(w.can(w.u('lea'), 'library:publish', { gymId: w.fit.id }).ok, true);
  assert.equal(w.can(w.u('admin'), 'library:moderate', { item: open }).ok, true);
  assert.equal(w.can(w.u('lead'), 'library:moderate', { item: studio }).ok, true);
  assert.equal(w.can(w.u('lead'), 'library:moderate', { item: open }).ok, false);
  w.u('tim').share = { banned: true };
  assert.equal(w.can(w.u('tim'), 'library:publish', {}).reason, 'banned');
  w.flags.sharing = false;
  assert.equal(w.can(w.u('lea'), 'library:read', { item: open }).ok, false);
});
