// /api/cycle: each account's own cycle log. Private by design:
//   - one file per account in DATA_DIR/cycle/ (D1 through the object's flush, so the backup has it),
//     sealed with the api's own scheme (AES-GCM, bound to the account), so the stored rows are not
//     readable as text and a copy in another account's file does not open;
//   - never part of the synced profile, so the Coach, the MCP server and the export cannot see it;
//   - nobody else reads it unless the owner picks that account (prefs.share: { [uid]: level }), and
//     even then only the phase, or the phase and the expected next period (lib/cycle.js sharedView).
//     Notes, symptoms, moods and the fertile window are never shared.
//
//   GET    /api/cycle              -> { days, prefs, people, partners }
//   PUT    /api/cycle/day          { date, flow, sym, mood, note } (an empty day deletes it)
//   PUT    /api/cycle/prefs        { share: { uid: 'phase' | 'period' }, push: { period }, tz }
//   DELETE /api/cycle              -> removes everything of this account
// The cron (worker.js /__wake) sends the one reminder, the day before an expected period, with a
// plain text that says nothing on a lock screen.
import fs from 'node:fs';
import path from 'node:path';
import { deriveKey, seal, open } from '../../api/integrations/crypto.js';
import { cleanDay, isDate, forecast, diffDays, sharedView, LEVELS } from '../../frontend/src/lib/cycle.js';
import { iso, minuteIn } from './garmin.js';
import { sendAll } from './webpush.js';

const ID = /^[\w-]{1,64}$/;
const MAX_DAYS = 5000, MAX_SHARE = 50;

export function cleanPrefs(p) {
  const out = {};
  if (p?.share && typeof p.share === 'object' && !Array.isArray(p.share)) {
    out.share = {};
    for (const [uid, level] of Object.entries(p.share).slice(0, MAX_SHARE)) if (ID.test(uid) && LEVELS.includes(level)) out.share[uid] = level;
  }
  if (p?.push && typeof p.push === 'object') out.push = { period: !!p.push.period };
  if (typeof p?.tz === 'string') { try { new Intl.DateTimeFormat('en', { timeZone: p.tz }); out.tz = p.tz; } catch { /* keep the old one */ } }
  return out;
}

export function makeCycle({ dataDir, fetchFn = (...a) => fetch(...a), now = () => Date.now(), subject = process.env.VAPID_SUBJECT || process.env.ORIGIN || 'mailto:admin@localhost' }) {
  const dir = path.join(dataDir, 'cycle');
  let box = null;
  const sealKey = () => (box ||= deriveKey(fs.readFileSync(path.join(dataDir, 'secret'), 'utf8').trim()));
  const fileOf = uid => path.join(dir, String(uid).replace(/[^\w-]/g, '_') + '.json');
  const aad = uid => 'cycle:' + uid;
  const load = uid => {
    try {
      const plain = open(sealKey(), JSON.parse(fs.readFileSync(fileOf(uid), 'utf8')).data, aad(uid));
      const rec = JSON.parse(plain);
      return { days: rec.days || {}, prefs: rec.prefs || {}, sent: rec.sent || {} };
    } catch { return { days: {}, prefs: {}, sent: {} }; }
  };
  const save = (uid, rec) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(fileOf(uid), JSON.stringify({ v: 1, data: seal(sealKey(), JSON.stringify(rec), aad(uid)) })); };
  const readData = f => { try { return JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8')); } catch { return null; } };
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

  /** Every other account (for the share picker) and what the ones sharing with `uid` show. */
  function people(uid) {
    const users = (readData('db.json')?.users || []).filter(u => u?.id && u.id !== uid);
    const partners = [];
    for (const u of users) {
      const rec = load(u.id), level = rec.prefs.share?.[uid];
      if (!level) continue;
      const tz = rec.prefs.tz, today = iso(now(), tz || null);
      const v = sharedView(rec.days, today, level);
      if (v.phase) partners.push({ uid: u.id, name: u.name || 'Friend', level, ...v });
    }
    return { people: users.map(u => ({ uid: u.id, name: u.name || '' })), partners };
  }

  async function handle(request, uid) {
    const { pathname } = new URL(request.url);
    const route = request.method + ' ' + pathname.replace(/\/$/, '');
    try {
      switch (route) {
        case 'GET /api/cycle': { const rec = load(uid); return json({ days: rec.days, prefs: rec.prefs, ...people(uid) }); }
        case 'PUT /api/cycle/day': {
          const text = await request.text();
          if (text.length > 4000) return json({ error: 'Too large.' }, 413);
          let body; try { body = JSON.parse(text); } catch { return json({ error: 'Not JSON.' }, 400); }
          if (!isDate(body?.date)) return json({ error: 'Bad date.' }, 400);
          const rec = load(uid), day = cleanDay(body);
          if (day) {
            if (!rec.days[body.date] && Object.keys(rec.days).length >= MAX_DAYS) return json({ error: 'Too many days logged.' }, 409);
            rec.days[body.date] = day;
          } else delete rec.days[body.date];
          save(uid, rec);
          return json({ day });
        }
        case 'PUT /api/cycle/prefs': {
          const text = await request.text();
          if (text.length > 6000) return json({ error: 'Too large.' }, 413);
          let body; try { body = JSON.parse(text); } catch { return json({ error: 'Not JSON.' }, 400); }
          const rec = load(uid);
          rec.prefs = { ...rec.prefs, ...cleanPrefs(body) };
          save(uid, rec);
          return json({ prefs: rec.prefs });
        }
        case 'DELETE /api/cycle': fs.rmSync(fileOf(uid), { force: true }); return json({ days: {}, prefs: {} });
        default: return json({ error: 'not found' }, 404);
      }
    } catch (e) {
      console.error('cycle:', route, e?.message);
      return json({ error: 'Something went wrong.' }, 500);
    }
  }

  /** The cron: a reminder the day before an expected period, once, between 09:00 and 12:00 local. */
  async function tick() {
    let files = [];
    try { files = fs.readdirSync(dir).filter(f => f.endsWith('.json')); } catch { return; }
    const vapid = readData('vapid.json'), subsAll = readData('db.json')?.subs || [];
    for (const f of files) {
      const uid = f.slice(0, -5), rec = load(uid), tz = rec.prefs.tz;
      if (!rec.prefs.push?.period || !tz) continue;
      const t = now(), clock = minuteIn(t, tz), today = iso(t, tz), next = forecast(rec.days)[0];
      if (!next || clock < 540 || clock >= 720 || diffDays(next.start, today) !== 1 || rec.sent.period === next.start) continue;
      const subs = subsAll.filter(s => s.userId === uid && s.endpoint && s.keys?.p256dh && s.keys?.auth).slice(0, 5);
      if (!subs.length || !vapid?.privateKey) continue;
      rec.sent.period = next.start;   // marked before sending: a lost push is not worth sending twice
      save(uid, rec);
      await sendAll(subs, { title: 'openGym', body: 'You have a reminder for tomorrow.', tag: 'cycle' }, vapid, subject, fetchFn).catch(e => console.error('cycle push:', e?.message));
    }
  }

  return { handle, tick };
}
