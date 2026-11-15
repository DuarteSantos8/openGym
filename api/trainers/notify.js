/* Telling a member what just happened between them and a trainer or a gym: a line in their inbox
 * (the in-app notice on Home and in Trainer & gym) and a push notification to their devices, in
 * their own language (push-copy.js, generated from the frontend's packs). A connection made or
 * changed always says so: on a hijacked account it is how the owner finds out (design 8.4). */
import { TRAINER_COPY } from './push-copy.js';

const fill = (s, names) => String(s || '').replace(/\{(\d)\}/g, (_, i) => names[+i] ?? '');
const copyFor = lang => TRAINER_COPY[lang] || TRAINER_COPY[String(lang || '').split('-')[0]] || TRAINER_COPY.en;

/** The push payload for one notice kind ('connected', 'scopes', 'joined', 'change', 'suggest', 'comment', 'offer'). */
export function trainerPush(lang, kind, names = [], body = null) {
  const c = copyFor(lang)[kind] || TRAINER_COPY.en[kind];
  if (!c) return null;
  const text = body != null && body !== '' ? String(body).slice(0, 180) : fill(c.body, names);
  return { title: fill(c.title, names), body: text, tag: 'trainer-' + kind, url: '#/settings/trainer' };
}

export function createNotify({ log, sendPush = () => {}, langOf = () => 'en' }) {
  const push = (uid, kind, names, body) => {
    const p = trainerPush(langOf(uid), kind, names, body);
    if (!p) return;
    // Never awaited: a push service that is slow or down does not hold up the request.
    try { Promise.resolve(sendPush(uid, p)).catch(e => console.error('trainer push', e.message)); } catch (e) { console.error('trainer push', e.message); }
  };
  return {
    push,
    /** An inbox notice and its push. `from` is who it is about ({ kind, id, name }). */
    notice(uid, kind, { from = null, names = [], grantId = null, extra = null } = {}) {
      const row = log.addInbox(uid, { kind: 'notice', notice: kind, names: names.map(n => String(n || '').slice(0, 60)), ...(from ? { from } : {}), ...(grantId ? { grantId } : {}), ...(extra || {}) });
      push(uid, kind, names);
      return row;
    }
  };
}
