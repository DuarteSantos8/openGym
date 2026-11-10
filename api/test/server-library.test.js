/* The community library end to end against the real server.js in a child process (LIBRARY=on):
   share with a consent, browse, import (the files land in the importer's own folder), report,
   auto-hide, admin approve / hide / restore / remove (which takes importers' copies too), ban,
   unshare, account deletion, the review switch, personal media, the file checks and the budgets.
   Plus the switch being off by default. */
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
import { currentConsent } from '../consent.js';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'http://localhost:8080';
const SECRET = crypto.randomBytes(32).toString('hex');
const mint = uid => {
  const payload = `${uid}:${Date.now() + 86400000}:0`;
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
};
const USERS = [
  { id: 'u_admin', name: 'Adam', admin: true, owner: true },
  { id: 'u_anna', name: 'Anna' },
  { id: 'u_ben', name: 'Ben' },
  { id: 'u_cleo', name: 'Cleo' },
  { id: 'u_dan', name: 'Dan' },
  { id: 'u_eve', name: 'Eve' },
];
const c = currentConsent('library');
const CONSENT = { v: c.v, hash: c.hash, own: true };

// A JPEG that is only a JFIF header and the scan: what a canvas re-encode writes.
const cleanJpeg = (n = 600) => Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from('JFIF\0', 'latin1'), Buffer.alloc(9),
  Buffer.from([0xff, 0xda, 0x00, 0x08]), crypto.randomBytes(n), Buffer.from([0xff, 0xd9])
]);
// The same with an Exif block, the kind a phone camera writes with the GPS position in it.
const exifJpeg = () => Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x10]), Buffer.from('Exif\0\0', 'latin1'), Buffer.alloc(8),
  Buffer.from([0xff, 0xda, 0x00, 0x08]), crypto.randomBytes(200), Buffer.from([0xff, 0xd9])
]);
const ref = (bytes, mime, kind, extra = {}) => ({ kind, hash: M.sha(bytes), mime, size: bytes.length, width: 256, height: 256, ...extra });

async function start(t, env = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-library-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({ users: USERS.map(u => ({ ...u, created: new Date().toISOString() })), creds: [], subs: [], invites: [] }));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN, RP_ID: 'localhost', MEDIA_MIN_FREE_MB: '1', LIBRARY: 'on', ...env }
  });
  const h = { log: '', dataDir };
  child.stdout.on('data', d => h.log += d);
  child.stderr.on('data', d => h.log += d);
  t.after(() => { child.kill('SIGKILL'); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const port = await boundPort(child, () => h.log);
  h.api = `http://127.0.0.1:${port}`;
  h.call = async (who, method, p, body, headers = {}) => {
    const r = await fetch(h.api + p, {
      method, headers: { 'Content-Type': 'application/json', ...(who ? { Cookie: `gymsid=${mint(who)}` } : {}), ...headers },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    return { status: r.status, body: await r.json().catch(() => null), headers: r.headers };
  };
  h.put = (who, bytes, declare) => fetch(`${h.api}/api/media/${M.sha(bytes)}`, { method: 'PUT', headers: { Cookie: `gymsid=${mint(who)}`, 'Content-Type': declare }, body: bytes });
  h.raw = (who, p) => fetch(h.api + p, { headers: { Cookie: `gymsid=${mint(who)}` } });
  h.share = (who, body) => h.call(who, 'POST', '/api/shared', { consent: CONSENT, lang: 'en', ...body });
  return h;
}

test('off by default: no config block, every route 404 sharing-off', async t => {
  const h = await start(t, { LIBRARY: '' });
  assert.equal((await h.call('u_anna', 'GET', '/api/config')).body.shared, undefined);
  const r = await h.call('u_anna', 'GET', '/api/shared');
  assert.equal(r.status, 404);
  assert.equal(r.body.code, 'sharing-off');
  assert.equal((await h.share('u_anna', { type: 'tip', payload: { exId: '0001', text: 'hi' } })).body.code, 'sharing-off');
});

test('the whole road: share, browse, import, report, auto-hide, admin remove, unshare', async t => {
  const h = await start(t);
  const { call } = h;
  // Config tells a session what this server shares, and the consent to show.
  const cfg = (await call('u_anna', 'GET', '/api/config')).body.shared;
  assert.ok(cfg.types.includes('sound') && !cfg.types.includes('photo'));
  assert.equal(cfg.consent.hash, c.hash);
  assert.equal(cfg.limits.videoMB, 25);
  assert.equal((await call(null, 'GET', '/api/config')).body.shared, undefined, 'not before signing in');

  // Consent: the tick, then the current text.
  const sound = M.wav(22050);
  const soundRef = ref(sound, 'audio/wav', 'audio', { width: 1, height: 1, dur: 1 });
  const body = { type: 'sound', src: 'sound:s1', title: 'Gong', desc: 'A big gong for the end of a rest.', payload: { name: 'Gong', m: soundRef } };
  assert.equal((await h.call('u_anna', 'POST', '/api/shared', { ...body, consent: { v: c.v, hash: c.hash } })).body.code, 'consent-own');
  const stale = await h.call('u_anna', 'POST', '/api/shared', { ...body, consent: { v: c.v, hash: 'x'.repeat(64), own: true } });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'consent-outdated');
  assert.equal(stale.body.consent.hash, c.hash);

  // The file has to be uploaded first.
  const missing = await h.share('u_anna', body);
  assert.equal(missing.status, 409);
  assert.deepEqual(missing.body.missing, [soundRef.hash]);
  assert.equal((await h.put('u_anna', sound, 'audio/wav')).status, 201);
  const shared = await h.share('u_anna', body);
  assert.equal(shared.status, 201, JSON.stringify(shared.body));
  const id = shared.body.id;
  assert.match(id, /^s_[a-z2-7]{16}$/);
  assert.equal(shared.body.status, 'live');
  assert.equal(shared.body.item.by.name, 'Anna');
  assert.ok(fs.existsSync(path.join(h.dataDir, 'shared', 'media', soundRef.hash + '.wav')), 'copied into the shared folder');
  const log = (await call('u_anna', 'GET', '/api/admin/audit')).status;
  assert.equal(log, 403, 'Anna is no admin');

  // Browse: Ben sees it with Anna's name and the date, finds it by a word, opens it.
  const list = await call('u_ben', 'GET', '/api/shared?type=sound&sort=new');
  assert.equal(list.status, 200);
  assert.equal(list.body.items.length, 1);
  const card = list.body.items[0];
  assert.equal(card.by.name, 'Anna');
  assert.ok(card.at > 0);
  assert.equal(card.mine, undefined);
  assert.equal(card.src, undefined, 'only the owner learns which of hers it is');
  assert.equal((await call('u_anna', 'GET', '/api/shared?mine=1')).body.items[0].src, 'sound:s1');
  assert.equal(card.importers, undefined, 'never sent');
  assert.equal(card.reports, undefined, 'never sent');
  assert.equal((await call('u_ben', 'GET', '/api/shared?q=gong')).body.items.length, 1);
  assert.equal((await call('u_ben', 'GET', '/api/shared?q=trumpet')).body.items.length, 0);
  assert.equal((await call('u_ben', 'GET', `/api/shared/${id}`)).body.item.payload.name, 'Gong');
  const preview = await h.raw('u_ben', `/api/shared/media/${soundRef.hash}`);
  assert.equal(preview.status, 200);
  assert.equal(preview.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(Buffer.from(await preview.arrayBuffer()).length, sound.length);

  // Import: a copy, the file in Ben's own folder, the origin frozen with Anna's name.
  assert.equal((await h.raw('u_ben', `/api/media/${soundRef.hash}`)).status, 404, 'not Ben\'s yet');
  const imp = await call('u_ben', 'POST', `/api/shared/${id}/import`, {});
  assert.equal(imp.status, 200);
  assert.equal(imp.body.origin.kind, 'library');
  assert.equal(imp.body.origin.by, 'Anna');
  assert.equal(imp.body.origin.id, id);
  assert.equal(imp.body.origin.server, ORIGIN);
  assert.deepEqual(imp.body.media, [soundRef.hash]);
  assert.equal((await h.raw('u_ben', `/api/media/${soundRef.hash}`)).status, 200, 'now Ben\'s own');
  await call('u_ben', 'POST', `/api/shared/${id}/import`, {});
  assert.equal((await call('u_cleo', 'GET', `/api/shared/${id}`)).body.item.stats.imports, 1, 'once per person');
  await call('u_cleo', 'POST', `/api/shared/${id}/import`, {});
  assert.equal((await call('u_cleo', 'GET', '/api/shared?sort=popular')).body.items[0].stats.imports, 2);

  // Report: never your own, once per person, a reason from the list.
  assert.equal((await call('u_anna', 'POST', `/api/shared/${id}/report`, { reason: 'spam' })).body.code, 'own-item');
  assert.equal((await call('u_ben', 'POST', `/api/shared/${id}/report`, { reason: 'nope' })).body.code, 'bad-reason');
  assert.equal((await call('u_ben', 'POST', `/api/shared/${id}/report`, { reason: 'spam', note: 'Too loud' })).body.status, 'live');
  assert.equal((await call('u_ben', 'POST', `/api/shared/${id}/report`, { reason: 'spam' })).body.code, 'already-reported');
  assert.equal((await call('u_cleo', 'POST', `/api/shared/${id}/report`, { reason: 'offensive' })).body.status, 'live');
  // The third person: out of sight until an admin decides.
  assert.equal((await call('u_dan', 'POST', `/api/shared/${id}/report`, { reason: 'other' })).body.status, 'pending');
  assert.equal((await call('u_eve', 'GET', '/api/shared')).body.items.length, 0, 'gone from the list');
  assert.equal((await call('u_eve', 'POST', `/api/shared/${id}/import`, {})).status, 404, 'no new imports');
  assert.equal((await call('u_anna', 'GET', '/api/shared?mine=1')).body.items[0].status, 'pending', 'the owner still sees it');

  // The admin's list has the reports, with names; approve brings it back and resets the count.
  const mod = await call('u_admin', 'GET', '/api/admin/shared?reported=1');
  assert.equal(mod.status, 200);
  assert.equal(mod.body.counts.pending, 1);
  assert.deepEqual(mod.body.items[0].reports.map(r => r.by).sort(), ['Ben', 'Cleo', 'Dan']);
  assert.equal(mod.body.items[0].owner.name, 'Anna');
  assert.equal(mod.body.items[0].importers, 2);
  assert.equal((await call('u_ben', 'GET', '/api/admin/shared')).status, 403, 'not for everyone');
  assert.equal((await call('u_admin', 'POST', `/api/admin/shared/${id}`, { action: 'approve' })).body.code, 'reason-needed');
  assert.equal((await call('u_admin', 'POST', `/api/admin/shared/${id}`, { action: 'approve', reason: 'just a loud gong' })).body.status, 'live');
  assert.equal((await call('u_eve', 'GET', '/api/shared')).body.items.length, 1);
  assert.equal((await call('u_admin', 'POST', `/api/admin/shared/${id}`, { action: 'hide', reason: 'checking' })).body.status, 'hidden');
  assert.equal((await call('u_eve', 'GET', '/api/shared')).body.items.length, 0);
  assert.equal((await call('u_admin', 'POST', `/api/admin/shared/${id}`, { action: 'restore', reason: 'fine' })).body.status, 'live');

  // A licence report hides it with one voice.
  assert.equal((await call('u_eve', 'POST', `/api/shared/${id}/report`, { reason: 'licensed', note: 'This is from a film' })).body.status, 'pending');

  // Remove: the files leave the shared folder and the importers' folders, the hash is blocked.
  const rm = await call('u_admin', 'POST', `/api/admin/shared/${id}`, { action: 'remove', reason: 'licensed audio' });
  assert.equal(rm.body.status, 'removed');
  assert.equal(rm.body.copiesRemoved, 2);
  assert.equal((await h.raw('u_ben', `/api/media/${soundRef.hash}`)).status, 404, 'Ben\'s copy is gone');
  assert.equal((await h.raw('u_cleo', `/api/media/${soundRef.hash}`)).status, 404, 'and Cleo\'s');
  assert.equal((await h.raw('u_anna', `/api/shared/media/${soundRef.hash}`)).status, 404);
  assert.ok(!fs.existsSync(path.join(h.dataDir, 'shared', 'media', soundRef.hash + '.wav')));
  const again = await h.share('u_anna', { ...body, title: 'Gong again' });
  assert.equal(again.status, 422);
  assert.equal(again.body.code, 'media-blocked');
  // Every step is in the activity log.
  const evs = (await call('u_admin', 'GET', '/api/admin/audit')).body.events.map(e => e.ev);
  for (const ev of ['shared.publish', 'shared.report', 'shared.autohide', 'shared.approve', 'shared.hide', 'shared.restore', 'shared.remove']) assert.ok(evs.includes(ev), ev);

  // Unshare: a tip Ben imported stays his after Anna withdraws it; nobody new gets it.
  const tip = await h.share('u_anna', { type: 'tip', title: 'Squat tip', payload: { exId: '0001', exName: 'Squat', text: 'Knees out, chest up.' } });
  assert.equal(tip.status, 201);
  assert.equal((await call('u_ben', 'GET', '/api/shared?ex=0001')).body.items.length, 1, 'tips about one exercise');
  assert.equal((await call('u_ben', 'GET', '/api/shared?ex=0002')).body.items.length, 0);
  const tipImp = await call('u_ben', 'POST', `/api/shared/${tip.body.id}/import`, {});
  assert.equal(tipImp.body.payload.text, 'Knees out, chest up.');
  assert.equal((await call('u_ben', 'DELETE', `/api/shared/${tip.body.id}`)).body.code, 'not-owner');
  assert.equal((await call('u_anna', 'DELETE', `/api/shared/${tip.body.id}`)).body.status, 'withdrawn');
  assert.equal((await call('u_cleo', 'GET', '/api/shared?type=tip')).body.items.length, 0);
  assert.equal((await call('u_cleo', 'POST', `/api/shared/${tip.body.id}/import`, {})).status, 404);
  assert.equal((await call('u_anna', 'GET', '/api/shared?mine=1&type=tip')).body.items[0].status, 'withdrawn');
  const annaLog = (await call('u_anna', 'GET', '/api/sharing/log')).status;
  assert.ok(annaLog === 404 || annaLog === 200);
});

test('a new version, If-Match, and the owner alone may change it', async t => {
  const h = await start(t);
  const s = await h.share('u_anna', { type: 'measures', title: 'Bodybuilding points', payload: { fields: [{ name: 'Calf', unit: 'cm' }] } });
  const id = s.body.id;
  assert.equal((await h.call('u_ben', 'PATCH', `/api/shared/${id}`, { rev: 1, title: 'Mine now' })).body.code, 'not-owner');
  assert.equal((await h.call('u_anna', 'PATCH', `/api/shared/${id}`, { title: 'Old' }, { 'If-Match': '7' })).status, 412);
  const up = await h.call('u_anna', 'PATCH', `/api/shared/${id}`, { payload: { fields: [{ name: 'Calf', unit: 'cm' }, { name: 'Neck', unit: 'cm' }] } }, { 'If-Match': '1' });
  assert.equal(up.status, 200);
  assert.equal(up.body.version, 2);
  assert.equal(up.body.rev, 2);
  assert.equal((await h.call('u_ben', 'GET', `/api/shared/${id}`)).body.item.payload.fields.length, 2);
});

test('the files: metadata, WebM, size caps, a type that does not fit, the profile picture', async t => {
  const h = await start(t);
  const dirty = exifJpeg();
  await h.put('u_anna', dirty, 'image/jpeg');
  const r = await h.share('u_anna', { type: 'exercise', payload: { ex: { n: 'Cable thing', eq: 'cable' }, media: ref(dirty, 'image/jpeg', 'image') } });
  assert.equal(r.status, 422);
  assert.equal(r.body.code, 'media-metadata');

  // A 1:1 copy of a built-in catalogue picture: blocked by its hash, whatever it is called.
  const stillDir = path.join(API, '..', 'catalogue', 'media', 'still');
  const first = fs.existsSync(stillDir) ? fs.readdirSync(stillDir).find(n => n.endsWith('.webp')) : null;
  if (first) {
    const bytes = fs.readFileSync(path.join(stillDir, first));
    assert.equal((await h.put('u_anna', bytes, 'image/webp')).status, 201);
    const lic = await h.share('u_anna', { type: 'exercise', payload: { ex: { n: 'My squat' }, media: ref(bytes, 'image/webp', 'image') } });
    assert.equal(lic.status, 422);
    assert.equal(lic.body.code, 'media-blocked');
    assert.match(lic.body.error, /licensed/);
  }

  const webm = M.ebml('webm', 600);
  await h.put('u_anna', webm, 'video/webm');
  assert.equal((await h.share('u_anna', { type: 'exercise', payload: { ex: { n: 'Clip' }, media: ref(webm, 'video/webm', 'video') } })).body.code, 'media-webm');

  const tagged = Buffer.concat([M.wav(2205), Buffer.from('LIST\x08\0\0\0INFOtest', 'latin1')]);
  tagged.writeUInt32LE(tagged.length - 8, 4);
  await h.put('u_anna', tagged, 'audio/wav');
  assert.equal((await h.share('u_anna', { type: 'sound', payload: { name: 'Tagged', m: ref(tagged, 'audio/wav', 'audio', { width: 1, height: 1 }) } })).body.code, 'media-metadata');

  const long = M.wav(22050 * 40);
  await h.put('u_anna', long, 'audio/wav');
  assert.equal((await h.share('u_anna', { type: 'sound', payload: { name: 'Long', m: ref(long, 'audio/wav', 'audio', { width: 1, height: 1 }) } })).body.code, 'media-too-long');

  const pic = cleanJpeg(40 * 1024);
  await h.put('u_anna', pic, 'image/jpeg');
  assert.equal((await h.share('u_anna', { type: 'avatar', payload: { m: ref(pic, 'image/jpeg', 'image') } })).body.code, 'media-too-large', 'a profile picture is 32 KB');
  assert.equal((await h.share('u_anna', { type: 'sound', payload: { name: 'x', m: ref(pic, 'image/jpeg', 'image') } })).body.code, 'bad-payload');

  const face = cleanJpeg(8000);
  await h.put('u_anna', face, 'image/jpeg');
  const av = await h.share('u_anna', { type: 'avatar', payload: { m: ref(face, 'image/jpeg', 'image') } });
  assert.equal(av.status, 201, JSON.stringify(av.body));
  // The picture is next to her name from now on.
  const tip = await h.share('u_anna', { type: 'tip', payload: { exId: '0001', text: 'Breathe.' } });
  assert.equal(tip.body.item.by.avatar, M.sha(face));
  const still = cleanJpeg(3000);
  await h.put('u_anna', still, 'image/jpeg');
  const ex = await h.share('u_anna', { type: 'exercise', title: 'Banded walk', payload: { ex: { n: 'Banded walk', id: '0042', url: 'javascript:alert(1)', _ts: 5 }, media: ref(still, 'image/jpeg', 'image') } });
  assert.equal(ex.status, 201, JSON.stringify(ex.body));
  assert.equal(ex.body.item.payload.ex.id, undefined, 'never a catalogue id');
  assert.equal(ex.body.item.payload.ex.url, undefined, 'only http(s) links');
});

test('SHARE_REVIEW=on: an admin approves first; personal media need their own switch', async t => {
  const h = await start(t, { SHARE_REVIEW: 'on' });
  const s = await h.share('u_anna', { type: 'look', title: 'Purple rain', payload: { flame: { v: 'bolt', c: '#bf5af2' }, accent: 'purple' } });
  assert.equal(s.body.status, 'pending');
  assert.equal((await h.call('u_ben', 'GET', '/api/shared')).body.items.length, 0);
  assert.equal((await h.call('u_admin', 'GET', '/api/admin/shared?status=pending')).body.items.length, 1);
  await h.call('u_admin', 'POST', `/api/admin/shared/${s.body.id}`, { action: 'approve', reason: 'nice' });
  assert.equal((await h.call('u_ben', 'GET', '/api/shared')).body.items.length, 1);
  assert.equal((await h.share('u_anna', { type: 'photo', payload: { media: [] } })).body.code, 'type-off');
});

test('SHARE_PERSONAL_MEDIA=on: photos are possible, and always reviewed', async t => {
  const h = await start(t, { SHARE_PERSONAL_MEDIA: 'on' });
  assert.ok((await h.call('u_anna', 'GET', '/api/config')).body.shared.types.includes('progress'));
  const pic = cleanJpeg(5000);
  await h.put('u_anna', pic, 'image/jpeg');
  const s = await h.share('u_anna', { type: 'progress', payload: { media: [ref(pic, 'image/jpeg', 'image')], caption: 'Week 12' } });
  assert.equal(s.status, 201, JSON.stringify(s.body));
  assert.equal(s.body.status, 'pending');
  await h.call('u_admin', 'POST', `/api/admin/shared/${s.body.id}`, { action: 'approve', reason: 'fine' });
  assert.equal((await h.call('u_ben', 'POST', `/api/shared/${s.body.id}/import`, {})).body.code, 'not-importable', 'only to look at');
  const local = await h.share('u_anna', { type: 'formvideo', payload: { media: [ref(pic, 'image/jpeg', 'image', { local: true })] } });
  assert.equal(local.status, 422);
});

test('a ban pauses sharing and hides what was live; the unban brings back exactly that', async t => {
  const h = await start(t);
  const a = await h.share('u_anna', { type: 'tip', payload: { exId: '0001', text: 'One' } });
  const b = await h.share('u_anna', { type: 'tip', payload: { exId: '0002', text: 'Two' } });
  await h.call('u_admin', 'POST', `/api/admin/shared/${b.body.id}`, { action: 'hide', reason: 'off topic' });
  assert.equal((await h.call('u_admin', 'POST', '/api/admin/users/u_anna/sharing', { banned: true })).body.code, 'reason-needed');
  const ban = await h.call('u_admin', 'POST', '/api/admin/users/u_anna/sharing', { banned: true, reason: 'spam wave' });
  assert.equal(ban.body.items, 1);
  assert.equal((await h.share('u_anna', { type: 'tip', payload: { exId: '0003', text: 'Three' } })).body.code, 'banned');
  assert.equal((await h.call('u_anna', 'PATCH', `/api/shared/${a.body.id}`, { rev: a.body.item.rev, title: 'x' })).body.code, 'banned');
  assert.equal((await h.call('u_ben', 'GET', '/api/shared')).body.items.length, 0);
  assert.equal((await h.call('u_ben', 'POST', '/api/admin/users/u_anna/sharing', { banned: false })).status, 403);
  await h.call('u_admin', 'POST', '/api/admin/users/u_anna/sharing', { banned: false });
  const back = (await h.call('u_ben', 'GET', '/api/shared')).body.items;
  assert.deepEqual(back.map(i => i.id), [a.body.id], 'the one an admin hid stays hidden');
});

test('account deletion withdraws everything; an importer keeps the copy', async t => {
  const h = await start(t);
  const sound = M.wav(4410);
  await h.put('u_dan', sound, 'audio/wav');
  const s = await h.share('u_dan', { type: 'sound', payload: { name: 'Beep', m: ref(sound, 'audio/wav', 'audio', { width: 1, height: 1 }) } });
  await h.call('u_ben', 'POST', `/api/shared/${s.body.id}/import`, {});
  const del = await h.call('u_admin', 'POST', '/api/admin/user/delete', { id: 'u_dan' });
  assert.equal(del.status, 200);
  assert.equal((await h.call('u_cleo', 'GET', '/api/shared')).body.items.length, 0);
  assert.equal((await h.raw('u_ben', `/api/media/${M.sha(sound)}`)).status, 200, 'Ben\'s copy stays');
  // What Dan shared leaves the server now, not after the withdraw grace: the file and his words.
  assert.ok(!fs.existsSync(path.join(h.dataDir, 'shared', 'media', M.sha(sound) + '.wav')), 'the shared file is gone');
  const items = JSON.parse(fs.readFileSync(path.join(h.dataDir, 'shared', 'items.json'), 'utf8')).items;
  const row = items.find(i => i.id === s.body.id);
  assert.equal(row.status, 'withdrawn');
  assert.deepEqual([row.title, row.payload, row.media], ['', {}, []]);
  assert.ok(!JSON.stringify(items).includes('Beep'));
});

test('account deletion keeps a file someone else shared too', async t => {
  const h = await start(t);
  const sound = M.wav(4410);
  for (const who of ['u_dan', 'u_eve']) await h.put(who, sound, 'audio/wav');
  const body = { type: 'sound', payload: { name: 'Beep', m: ref(sound, 'audio/wav', 'audio', { width: 1, height: 1 }) } };
  await h.share('u_dan', body);
  const e = await h.share('u_eve', body);
  assert.equal((await h.call('u_admin', 'POST', '/api/admin/user/delete', { id: 'u_dan' })).status, 200);
  assert.ok(fs.existsSync(path.join(h.dataDir, 'shared', 'media', M.sha(sound) + '.wav')));
  assert.equal((await h.raw('u_ben', `/api/shared/media/${M.sha(sound)}`)).status, 200);
  assert.equal((await h.call('u_ben', 'GET', '/api/shared')).body.items.map(i => i.id).join(), e.body.id);
});

test('budgets: the 21st share in an hour is 429 with Retry-After', async t => {
  const h = await start(t);
  for (let i = 0; i < 20; i++) assert.equal((await h.share('u_eve', { type: 'tip', payload: { exId: '0001', text: 'Tip ' + i } })).status, 201);
  const r = await h.share('u_eve', { type: 'tip', payload: { exId: '0001', text: 'one more' } });
  assert.equal(r.status, 429);
  assert.equal(r.body.code, 'rate-limited');
  assert.ok(+r.headers.get('retry-after') > 0);
});
