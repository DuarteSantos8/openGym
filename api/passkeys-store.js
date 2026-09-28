/* More than one passkey on a profile (#95).
 *
 * A passkey lives where it was made — Windows Hello on one PC, one phone's keychain, one security
 * key — so a profile that only ever had the passkey it was created with could not be reached from
 * a second device, and "Create profile" there made a new, empty one. These are the bookkeeping
 * rules for more than one, kept out of server.js so they can be tested without a WebAuthn
 * ceremony: which rows belong to whom, what a list may show of them, and the rule that matters
 * most — a profile never loses its last way in.
 *
 * `otherWays` is how many ways besides its passkeys can still sign the profile in (a password, on
 * an instance with password sign-in on). server.js decides that; this only counts. */

// Far above anyone's real use — a phone, a laptop, a security key or two. What it bounds is a
// signed-in session adding rows to db.json, which is rewritten whole on every save.
export const MAX_PASSKEYS = 20;
export const NAME_MAX = 40;

// A label someone typed: control characters out, runs of whitespace folded, capped. Empty means
// no name, and the app shows a numbered "Passkey n" instead.
//
// Invisible format characters go too. The device redeeming a code names its own passkey, and the
// owner and the admin read that name: a right-to-left override (U+202E) turns the rest of it
// around, so a passkey could be made to read like another one. The two joiners stay, since emoji
// sequences and several scripts (Devanagari and Arabic among them) need them to render.
export const passkeyName = v => (typeof v === 'string' ? v : '')
  .replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/(?![\u200c\u200d])\p{Cf}/gu, '')
  .replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);

// `transports` comes from the browser that made the passkey, which is to say from the request. It
// is handed back to browsers as a hint, so only a short list of short words is kept.
const transportsOf = v => (Array.isArray(v) ? v.filter(x => typeof x === 'string' && x.length <= 16).slice(0, 8) : []);

// What the owner sees of their passkeys: never the public key, which nothing on screen needs.
export function listPasskeys(db, userId) {
  return (db.creds || [])
    .filter(c => c.userId === userId)
    .map(c => ({
      id: c.id,
      name: c.name || null,
      // Passkeys made before these fields existed have neither; the list leaves the line out.
      created: c.created || null,
      lastUsed: c.lastUsed || null,
      transports: transportsOf(c.transports)
    }));
}

export function addPasskeyRecord(db, userId, cred) {
  db.creds = db.creds || [];
  if (db.creds.some(c => c.id === cred.id)) return { error: 'credential already registered', code: 'credential-exists' };
  if (db.creds.filter(c => c.userId === userId).length >= MAX_PASSKEYS) {
    return { error: `a profile can have at most ${MAX_PASSKEYS} passkeys`, code: 'passkey-limit' };
  }
  const row = {
    id: cred.id,
    userId,
    publicKey: cred.publicKey,
    counter: cred.counter || 0,
    transports: transportsOf(cred.transports),
    created: cred.created || new Date().toISOString()
  };
  const name = passkeyName(cred.name);
  if (name) row.name = name;
  db.creds.push(row);
  return { ok: true, row };
}

export function renamePasskeyRecord(db, userId, credId, name) {
  const row = (db.creds || []).find(c => c.id === credId && c.userId === userId);
  if (!row) return { error: 'passkey not found', code: 'not-found' };
  const clean = passkeyName(name);
  if (clean) row.name = clean; else delete row.name;
  return { ok: true, row };
}

// Why removing `credId` would be refused, or null when it could go: not this profile's, or its
// last way in — the last passkey goes only while something else (`otherWays`) can still sign it
// in. On its own so server.js can ask before it asks the owner for proof, and again, through
// removePasskeyRecord, once the proof is in.
export function passkeyRemovalRefused(db, userId, credId, otherWays = 0) {
  const creds = db.creds || [];
  if (!creds.some(c => c.id === credId && c.userId === userId)) return { error: 'passkey not found', code: 'not-found' };
  const mine = creds.filter(c => c.userId === userId).length;
  if (mine - 1 + otherWays < 1) return { error: 'this passkey is the only way into this profile', code: 'last-way-in' };
  return null;
}

export function removePasskeyRecord(db, userId, credId, otherWays = 0) {
  const refused = passkeyRemovalRefused(db, userId, credId, otherWays);
  if (refused) return refused;
  const i = db.creds.findIndex(c => c.id === credId && c.userId === userId);
  const [row] = db.creds.splice(i, 1);
  return { ok: true, row };
}
