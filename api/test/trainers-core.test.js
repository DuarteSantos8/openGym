/* The small modules under the trainer feature: scopes, consent records, the org store on disk,
   the sharing log, the OIDC role map, provenance and the budgets. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanScopes, leadScopes, sharesNothing, TRAINER_DEFAULTS, CATEGORY_IDS } from '../trainers/scopes.js';
import { currentConsent, consentCurrent, consentRecord, CONSENT_KINDS } from '../consent.js';
import { createOrgStore, makeCode, normalizeCode, OrgError } from '../trainers/org-store.js';
import { createShareLog } from '../share-log.js';
import { parseRoleMap, rolesFromGroups } from '../role-claims.js';
import { cleanOrigin, originFor } from '../origin.js';
import { createBudgets, BUDGETS } from '../budgets.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gym-org-'));

test('scopes: unknown keys dropped, levels capped per category and per cap', () => {
  const s = cleanScopes({ workouts: 'apply', photos: 'apply', notes: 'suggest', evil: 'apply', plans: 'nonsense' });
  assert.deepEqual(Object.keys(s), CATEGORY_IDS);
  assert.equal(s.workouts, 'apply');
  assert.equal(s.photos, 'view', 'photos are read only');
  assert.equal(s.notes, 'view');
  assert.equal(s.plans, 'off');
  assert.equal(cleanScopes({ workouts: 'apply' }, 'view').workouts, 'view');
  assert.equal(sharesNothing(cleanScopes({})), true);
  assert.equal(sharesNothing(TRAINER_DEFAULTS), false);
});

test('scopes: the lead row is pre-filled from the trainer, read only, and can only be narrowed', () => {
  const trainer = { metrics: 'view', workouts: 'apply', plans: 'suggest', photos: 'off' };
  const pre = leadScopes('row', trainer);
  assert.equal(pre.workouts, 'view'); assert.equal(pre.plans, 'view'); assert.equal(pre.photos, 'off');
  const picked = leadScopes('row', trainer, { workouts: 'off', photos: 'view', plans: 'apply' });
  assert.equal(picked.workouts, 'off', 'deselected');
  assert.equal(picked.photos, 'off', 'never more than the trainer gets');
  assert.equal(picked.plans, 'view', 'never more than view');
  assert.equal(leadScopes('mirror', trainer, { workouts: 'off' }).workouts, 'view');
  assert.equal(sharesNothing(leadScopes('none', trainer)), true);
  assert.equal(leadScopes('row', null, { bodyweight: 'apply' }).bodyweight, 'view', 'a gym joined without a trainer');
});

test('consent: current text has a version and a stable hash, records carry both', () => {
  for (const k of CONSENT_KINDS) {
    const c = currentConsent(k);
    assert.ok(c.v >= 1 && /^[0-9a-f]{64}$/.test(c.hash) && c.text.length > 40, k);
    assert.equal(currentConsent(k).hash, c.hash);
    assert.doesNotMatch(c.text, /—/, 'no em dashes');
  }
  const cur = currentConsent('trainer');
  assert.equal(consentCurrent('trainer', { v: cur.v, hash: cur.hash }), true);
  assert.equal(consentCurrent('trainer', { v: cur.v, hash: 'x' }), false);
  assert.equal(consentCurrent('trainer', null), false);
  assert.equal(consentCurrent('library', { v: cur.v, hash: cur.hash }), false, 'a hash belongs to one kind');
  const r = consentRecord({ kind: 'trainer', memberId: 'm', subjectId: 'g', scopes: { workouts: 'view' }, lang: 'de', now: 5 });
  assert.equal(r.v, cur.v); assert.equal(r.hash, cur.hash); assert.equal(r.lang, 'de'); assert.equal(r.at, 5);
  assert.equal(consentRecord({ kind: 'trainer', memberId: 'm', subjectId: 'g', lang: '<script>' }).lang, 'en');
});

test('codes: 50 random bits, typed any way, only the hash stored, used up and expired', () => {
  const c = makeCode();
  assert.match(c, /^TR-[A-Z2-9]{5}-[A-Z2-9]{5}$/);
  assert.equal(normalizeCode(c.toLowerCase().replace(/-/g, ' ')), c.replace(/^TR-|-/g, ''));
  assert.equal(normalizeCode('short'), null);
  let t = 1000;
  const org = createOrgStore({ file: null, now: () => t });
  org.setFreeTrainer('tr', true);
  const { code, row } = org.createCode({ ownerId: 'tr', maxUses: 2, days: 1 });
  assert.ok(!JSON.stringify(org.get()).includes(code.slice(3, 8)), 'the code itself is never stored');
  assert.equal(org.findCode(code).id, row.id);
  org.connect({ memberId: 'a', code: org.findCode(code), scopes: TRAINER_DEFAULTS });
  org.connect({ memberId: 'b', code: org.findCode(code), scopes: TRAINER_DEFAULTS });
  assert.equal(org.findCode(code), null, 'used up');
  const second = org.createCode({ ownerId: 'tr', days: 1 });
  t += 86400001;
  assert.equal(org.findCode(second.code), null, 'expired');
  const third = org.createCode({ ownerId: 'tr' });
  org.revokeCode('tr', third.row.id);
  assert.equal(org.findCode(third.code), null, 'revoked');
  assert.throws(() => org.revokeCode('someone-else', third.row.id), OrgError);
});

test('connect: never to yourself, never twice, never sharing nothing; a failed change writes nothing', () => {
  const dir = tmp();
  const file = path.join(dir, 'org.json');
  const org = createOrgStore({ file });
  const g = org.createGym({ name: 'FitBox' });
  org.setStaff(g.id, 'tr', 'trainer', true);
  const code = () => org.findCode(org.createCode({ ownerId: 'tr', gymId: g.id }).code);
  assert.throws(() => org.connect({ memberId: 'tr', code: code(), scopes: TRAINER_DEFAULTS }), e => e.code === 'self');
  assert.throws(() => org.connect({ memberId: 'm', code: code(), scopes: {} }), e => e.code === 'nothing-shared');
  const before = fs.readFileSync(file, 'utf8');
  assert.equal(JSON.parse(before).grants.length, 0, 'the refused ones left nothing behind');
  const { grant, lead } = org.connect({ memberId: 'm', code: code(), scopes: TRAINER_DEFAULTS, lang: 'de' });
  assert.equal(grant.status, 'pending'); assert.equal(lead.status, 'pending');
  assert.ok(org.membership(g.id, 'm'), 'a studio trainer brings the studio membership');
  assert.throws(() => org.connect({ memberId: 'm', code: code(), scopes: TRAINER_DEFAULTS }), e => e.code === 'already-connected');
  // Two consent records, one per row, with the scopes as agreed.
  const rec = org.memberRecord('m');
  assert.equal(rec.consents.length, 2);
  assert.equal(rec.consents.find(c => c.subjectId === lead.id).scopes.plans, 'view');
  // On disk, and the .bak beside it; a fresh store reads it back.
  const again = createOrgStore({ file });
  assert.equal(again.grant(grant.id).memberId, 'm');
  assert.ok(fs.existsSync(file + '.bak'));
  // A damaged org.json falls back to the .bak.
  fs.writeFileSync(file, '{ not json');
  const fallback = createOrgStore({ file });
  assert.equal(fallback.grant(grant.id).memberId, 'm');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('answer, update, end: the lead row follows the trainer down, consents are re-recorded', () => {
  const org = createOrgStore({ file: null });
  const g = org.createGym({ name: 'FitBox' });
  org.setStaff(g.id, 'tr', 'trainer', true);
  const { grant, lead } = org.connect({ memberId: 'm', code: org.findCode(org.createCode({ ownerId: 'tr', gymId: g.id }).code), scopes: { metrics: 'view', workouts: 'view', plans: 'apply' } });
  assert.throws(() => org.answer('other', grant.id, true), e => e.status === 404);
  org.answer('tr', grant.id, true);
  assert.equal(org.grant(lead.id).status, 'active');
  assert.throws(() => org.answer('tr', grant.id, true), e => e.code === 'no-request', 'answered once');
  org.updateScopes('m', grant.id, { metrics: 'view', workouts: 'off', plans: 'suggest' });
  assert.equal(org.grant(lead.id).scopes.workouts, 'off', 'down with the trainer');
  assert.equal(org.grant(lead.id).scopes.plans, 'view');
  org.updateScopes('m', lead.id, { metrics: 'off', plans: 'view' });
  assert.equal(org.grant(lead.id).scopes.metrics, 'off');
  org.updateScopes('m', grant.id, { metrics: 'view', workouts: 'view', plans: 'suggest' });
  assert.equal(org.grant(lead.id).scopes.metrics, 'off', 'what the member took from the lead stays taken');
  assert.equal(org.grant(lead.id).scopes.workouts, 'off', 'and the lead never climbs back up on its own');
  const live = org.memberRecord('m').consents.filter(c => !c.revokedAt);
  assert.equal(live.length, 2, 'one live consent per row, the older ones closed');
  assert.throws(() => org.updateScopes('intruder', grant.id, {}), e => e.status === 404);
  org.endGrant(grant.id, 'member');
  assert.equal(org.grant(lead.id).status, 'ended');
  assert.equal(org.memberRecord('m').consents.filter(c => !c.revokedAt).length, 0);
  // Declining a request ends it too.
  const second = org.connect({ memberId: 'n', code: org.findCode(org.createCode({ ownerId: 'tr', gymId: g.id }).code), scopes: TRAINER_DEFAULTS });
  org.answer('tr', second.grant.id, false);
  assert.equal(org.grant(second.grant.id).status, 'ended');
});

test('removeUser: a member leaves no trace, a trainer leaves ended grants and the members to anonymize', () => {
  const org = createOrgStore({ file: null });
  org.setFreeTrainer('tr', true);
  const a = org.connect({ memberId: 'a', code: org.findCode(org.createCode({ ownerId: 'tr' }).code), scopes: TRAINER_DEFAULTS });
  org.connect({ memberId: 'b', code: org.findCode(org.createCode({ ownerId: 'tr' }).code), scopes: TRAINER_DEFAULTS });
  org.answer('tr', a.grant.id, true);
  org.removeUser('a');
  assert.equal(JSON.stringify(org.memberRecord('a')), JSON.stringify({ memberships: [], grants: [], consents: [] }));
  const touched = org.removeUser('tr');
  assert.deepEqual(touched, ['b']);
  assert.equal(org.get().grants.every(g => g.status === 'ended'), true);
  assert.equal(org.isFreeTrainer('tr'), false);
  assert.equal(org.get().codes.length, 0);
});

test('OIDC claims: the role map, and syncing only what claims gave', () => {
  const org = createOrgStore({ file: null });
  const g = org.createGym({ name: 'FitBox' });
  const rules = parseRoleMap(`access=opengym, admin=ops, trainer=pt, lead@${g.id}=fb-leads, trainer@${g.id}=fb-staff, member@${g.id}=fb, lead=bad, member=bad, wizard@x=bad, junk`);
  assert.equal(rules.length, 6);
  const r = rolesFromGroups(['fb-staff', 'fb', 'pt'], rules);
  assert.deepEqual(r, { access: true, admin: false, freeTrainer: true, staff: [{ gymId: g.id, role: 'trainer' }], memberOf: [g.id] });
  assert.equal(rolesFromGroups('ops', rules).admin, true);
  assert.equal(rolesFromGroups([], rules).access, false);
  // A lead role given by hand stays when the claims say nothing about it.
  org.setStaff(g.id, 'u', 'lead', true);
  let roles = org.syncClaimRoles('u', r);
  assert.equal(roles.freeTrainer, true);
  assert.deepEqual(roles.staff.map(s => s.role).sort(), ['lead', 'trainer']);
  roles = org.syncClaimRoles('u', rolesFromGroups([], rules));
  assert.deepEqual(roles.staff.map(s => s.role), ['lead'], 'the claimed trainer role went, the manual lead stayed');
  assert.equal(roles.freeTrainer, false);
});

test('share log: append only, looks folded per day, newest first, retention, anonymize, remove', () => {
  const dir = tmp();
  let t = Date.parse('2026-11-05T10:00:00Z');
  const log = createShareLog({ dir, now: () => t, keepDays: 30, maxEntries: 50 });
  const marco = { kind: 'trainer', id: 'tr', name: 'Marco' };
  log.append('m', { ev: 'grant.create', actor: { kind: 'self', id: 'm', name: 'Lea' } });
  for (let i = 0; i < 5; i++) { t += 1000; log.noteAccess('m', marco, 'workouts'); }
  log.noteAccess('m', marco, 'plans');
  t += 86400000; log.noteAccess('m', marco, 'workouts');
  const { log: rows } = log.list('m');
  assert.equal(rows.length, 4);
  assert.equal(rows[0].ev, 'access'); assert.equal(rows[0].n, 1);
  assert.equal(rows.find(e => e.cat === 'workouts' && e.n === 5).day, '2026-11-05');
  // Paging.
  const p1 = log.list('m', { limit: 2 });
  assert.equal(p1.log.length, 2);
  assert.equal(log.list('m', { limit: 2, before: p1.nextBefore }).log.length, 2);
  // Read back from disk by a new instance.
  assert.equal(createShareLog({ dir, now: () => t }).all('m').length, 4);
  log.anonymize(['m'], 'tr');
  assert.equal(log.all('m').filter(e => e.actor?.name === 'Marco').length, 0);
  assert.equal(log.all('m').find(e => e.ev === 'grant.create').actor.name, 'Lea', 'the member keeps their own name');
  t += 31 * 86400000; log.append('m', { ev: 'grant.end' });
  assert.equal(log.all('m').length, 1, 'older than keepDays went');
  assert.equal(fs.statSync(path.join(dir, 'm.json')).mode & 0o777, 0o600);
  log.remove('m');
  assert.equal(fs.existsSync(path.join(dir, 'm.json')), false);
  assert.equal(log.all('m').length, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('origin: one shape for trainer and library copies, cleaned', () => {
  assert.equal(cleanOrigin({ kind: 'sideload', id: 'x' }), null);
  assert.equal(cleanOrigin({ kind: 'library' }), null);
  const o = cleanOrigin({ kind: 'library', id: 's_abc', sourceId: 'r1', version: 3, by: 'Anna‮', at: 5, server: 'https://gym.example', extra: 1 });
  assert.deepEqual(o, { kind: 'library', id: 's_abc', by: 'Anna', at: 5, sourceId: 'r1', version: 3, server: 'https://gym.example' });
  assert.equal(cleanOrigin({ kind: 'trainer', id: 'u1', server: 'javascript:alert(1)' }).server, undefined);
  assert.equal(originFor({ kind: 'trainer', id: 'u1', by: 'Marco', now: 9 }).at, 9);
});

test('budgets: per key, per name, and the configured numbers are sane', () => {
  let t = 0;
  const b = createBudgets({ budgets: { x: { max: 2, windowMs: 1000 } }, now: () => t });
  assert.equal(b.take('x', 'a'), 0); assert.equal(b.take('x', 'a'), 0);
  assert.ok(b.take('x', 'a') > 0);
  assert.equal(b.take('x', 'b'), 0, 'another account has its own');
  t += 1000; assert.equal(b.take('x', 'a'), 0);
  assert.throws(() => b.take('nope', 'a'));
  b.stop();
  assert.equal(BUDGETS['trainer.code'].max, 20);
  for (const [k, v] of Object.entries(BUDGETS)) assert.ok(v.max > 0 && v.windowMs >= 60000, k);
});
