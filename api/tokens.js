/* Scoped access tokens (docs/API_TOKENS.md): a key a person makes in Settings for one program
 * (an AI client over MCP, a planner, a script) that reaches only what they ticked, never more
 * than the profile itself may do, and nothing outside that profile.
 *
 *   createToken(db, user, { name, scopes, days })   → { token, row }  (the token is shown once)
 *   findToken(db, token, ownerOf)                   → row or null, compared in constant time
 *   scopedState(S, scopes)                          → the part of a document a token may read
 *   mergeScoped(cur, sent, scopes)                  → the stored document with the token's write in it,
 *                                                     or a ScopeError naming the first key it may not write
 *
 * A token is `ogt_` and 256 random bits. Only its SHA-256 is stored (`db.apiTokens[].h`), so a
 * copy of db.json holds nothing that works. Like a watch link it carries the account's session
 * version: "sign out everywhere", a new password, a disabled or deleted account end it with every
 * session. It never stands in for a session: readSession() does not know it, so no route but the
 * token routes in server.js answers to it, and none of those is an admin, trainer or account route.
 *
 * Scopes use the categories of trainer sharing (trainers/scopes.js), each `off`, `view` or `apply`
 * (no `suggest`: a program has nobody to ask). What a category covers in the document is
 * KEY_CATEGORY below; a key no category names is a setting, readable by any token that reads
 * anything and writable by none, and the keys in NEVER are not handed to any token at all. */
import crypto from 'node:crypto';

export const TOKEN_PREFIX = 'ogt_';
export const TOKEN_LEVELS = ['off', 'view', 'apply'];
// The categories a token can hold, each with the most it can reach. Photos, nutrition and the
// derived trainer numbers are not offered: a program has no use for them here.
export const TOKEN_CATEGORIES = [
  { id: 'workouts', max: 'apply' },
  { id: 'plans', max: 'apply' },
  { id: 'bodyweight', max: 'apply' },
  { id: 'measurements', max: 'apply' },
  { id: 'notes', max: 'view' },
];
export const TOKEN_CATEGORY_IDS = TOKEN_CATEGORIES.map(c => c.id);
export const TOKENS_MAX = 10;
export const TOKEN_DAYS = [7, 30, 90, 365, 0];   // 0: until revoked
export const DEFAULT_DAYS = 90;
const DAY = 86400000;
const rank = lv => Math.max(0, TOKEN_LEVELS.indexOf(lv));

// The document's keys by category. customEx (the profile's own exercises) belongs to both
// workouts and plans: a logged workout or a routine may need a new one.
export const KEY_CATEGORY = {
  workouts: ['workouts'], exWeights: ['workouts'], sessionTargets: ['plans'],
  customEx: ['workouts', 'plans'],
  routines: ['plans'], week: ['plans'], dayPlan: ['plans'], queue: ['plans'], rotation: ['plans'],
  scheduleMode: ['plans'], programmes: ['plans'], programme: ['plans'],
  bodyweight: ['bodyweight'], targetW: ['bodyweight'], rateGoal: ['bodyweight'],
  measurements: ['measurements'], customMeasurements: ['measurements'], measurementEnabled: ['measurements'],
  dayNotes: ['notes'], exNotes: ['notes'], gymNotes: ['notes'], journalFolders: ['notes'],
  recoverySessions: ['workouts'], activities: ['workouts'],
  // Body facts the Tools page and the strength levels read (v1.4.5): personal, so not a setting
  // that rides along with a plans-only token.
  heightCm: ['bodyweight', 'measurements'], birthYear: ['bodyweight', 'measurements'], sex: ['bodyweight', 'measurements'],
};
// Never in a token's read, whatever it holds: pictures and videos (their own category, not
// offered), the Coach's conversation, the live workout, linked services, and the server's notes.
// Your own sounds (`sounds`, v1.4.5) are recordings of yours like the photos.
const NEVER = new Set(['dayPhotos', 'exMedia', 'dayForm', 'avatar', 'sounds', 'active', 'coach', 'integrations', '_unstamped', '_prior', 'deleted', 'edited', 'undone']);
const NEVER_RE = /photo|avatar|video|secret|token|password|integration/i;
// What the server keeps itself and the token reads along with the document, never writes.
const BOOK = new Set(['_rev', '_wid', '_wids', '_ts']);

export class ScopeError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

const sha = v => crypto.createHash('sha256').update('opengym-token:' + v).digest('hex');
/** Two hex digests compared in constant time; false for anything malformed. */
export function sameHash(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !/^[0-9a-f]{64}$/.test(a) || !/^[0-9a-f]{64}$/.test(b)) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

const nameOf = v => (typeof v === 'string' ? v : '').replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, '').trim().slice(0, 40) || 'API token';

/** A clean scope map: every token category present, each capped at what it can reach. */
export function cleanTokenScopes(input) {
  const out = {};
  for (const c of TOKEN_CATEGORIES) {
    const want = input && typeof input === 'object' && TOKEN_LEVELS.includes(input[c.id]) ? input[c.id] : 'off';
    out[c.id] = TOKEN_LEVELS[Math.min(rank(want), rank(c.max))];
  }
  return out;
}
export const grantsNothing = scopes => TOKEN_CATEGORY_IDS.every(id => rank(scopes?.[id]) === 0);
/** Whether `scopes` hold `category` at `level` or more. */
export const allows = (scopes, category, level) => TOKEN_CATEGORY_IDS.includes(category) && rank(scopes?.[category]) >= rank(level);

function prune(db, now) {
  db.apiTokens = (db.apiTokens || []).filter(r => r && typeof r.h === 'string' && !(r.exp && r.exp <= now));
}

/** A new token for `user`. Past TOKENS_MAX the profile is told no rather than losing one silently. */
// `kind: 'calendar'` (integrations/calendar.js): a token for one calendar feed address. It is
// listed with the others and revoked like them, but no token route takes it (tokenAuth), and the
// feed route takes nothing else.
export const TOKEN_KINDS = ['calendar'];
// `evict(row)`: rows that may make room when the profile is at TOKENS_MAX, the least recently
// used first. The connector sign-in (oauth.js) passes its own earlier connections: Claude
// registers a new client on every fresh connection, so "remove and add the connector again" ten
// times would otherwise end at a consent screen that cannot say yes.
export function createToken(db, user, { name, scopes, days, kind, evict } = {}, now = Date.now()) {
  prune(db, now);
  const clean = cleanTokenScopes(scopes);
  if (grantsNothing(clean)) throw new ScopeError(400, 'nothing-granted', 'a token needs at least one thing it may see');
  // Ended by an earlier session version: dead for good, so they make room.
  db.apiTokens = db.apiTokens.filter(r => r.userId !== user.id || r.sv === (user.sv || 0));
  const mine = () => db.apiTokens.filter(r => r.userId === user.id);
  if (mine().length >= TOKENS_MAX && typeof evict === 'function') {
    const old = mine().filter(evict).sort((a, b) => (a.used || a.created) - (b.used || b.created))[0];
    if (old) db.apiTokens = db.apiTokens.filter(r => r !== old);
  }
  if (mine().length >= TOKENS_MAX) {
    throw new ScopeError(409, 'too-many', `at most ${TOKENS_MAX} tokens per profile: revoke one first`);
  }
  const d = days == null ? DEFAULT_DAYS : Number(days);
  if (!TOKEN_DAYS.includes(d)) throw new ScopeError(400, 'bad-days', 'days must be one of ' + TOKEN_DAYS.join(', '));
  const token = TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url');
  const row = {
    id: 't_' + crypto.randomBytes(6).toString('hex'), userId: user.id, sv: user.sv || 0, h: sha(token),
    // The first characters after the prefix, so a list can tell two tokens apart. Six of 43
    // base64url characters say nothing useful about the other 37.
    hint: token.slice(TOKEN_PREFIX.length, TOKEN_PREFIX.length + 6),
    name: nameOf(name), scopes: clean, created: now, exp: d ? now + d * DAY : null, used: null,
    ...(TOKEN_KINDS.includes(kind) ? { kind } : {}),
  };
  db.apiTokens.push(row);
  return { token, row };
}

/**
 * The live token row a presented value stands for, or null. `ownerOf(userId)` is the account,
 * or null when it may not sign in. Every stored row is compared, in constant time, so the
 * answer takes as long for a near miss as for a stranger's value.
 */
export function findToken(db, token, ownerOf, now = Date.now()) {
  if (typeof token !== 'string' || !token.startsWith(TOKEN_PREFIX) || token.length !== TOKEN_PREFIX.length + 43) return null;
  const h = sha(token);
  let hit = null;
  for (const r of db.apiTokens || []) if (r && sameHash(r.h, h)) hit = r;
  // `aexp`: a connector's access token, which lives a day and is renewed with its refresh token
  // (oauth.js) while the connection itself runs until `exp`.
  if (!hit || (hit.exp && hit.exp <= now) || (hit.aexp && hit.aexp <= now)) return null;
  const owner = ownerOf(hit.userId);
  if (!owner || owner.disabled || (owner.sv || 0) !== hit.sv) return null;
  return hit;
}

/** A new value for an existing token row (the connector's refresh, oauth.js): the old value stops
 *  working at once, the row (its id, scopes, end and history) stays. Returns the new value. */
export function rotateToken(row) {
  const token = TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url');
  row.h = sha(token);
  row.hint = token.slice(TOKEN_PREFIX.length, TOKEN_PREFIX.length + 6);
  return token;
}

/** Marks a token used; true when that is worth a save (at most once a minute). */
export function touchToken(row, now = Date.now()) {
  if (row.used && now - row.used < 60000) return false;
  row.used = now;
  return true;
}

/** A profile's tokens as Settings lists them: no hash. Expired ones, and those an earlier session
 *  version (sign out everywhere, a new password) ended, are not listed. */
export const listTokens = (db, user, now = Date.now()) => (db.apiTokens || [])
  .filter(r => r && r.userId === user.id && r.sv === (user.sv || 0) && !(r.exp && r.exp <= now))
  .map(r => ({ id: r.id, name: r.name, hint: r.hint, scopes: { ...r.scopes }, created: r.created, exp: r.exp || null, used: r.used || null, ...(r.kind ? { kind: r.kind } : {}),
    // Made by an assistant's connector sign-in: which assistant (claude, chatgpt, gemini, other).
    ...(r.connector ? { connector: { assistant: r.connector.assistant || 'other', client: r.connector.name || '' } } : {}) }));

/** One token gone (`id`), or all of a profile's (no `id`). Returns the rows that went. */
export function revokeTokens(db, userId, id = null) {
  const gone = [];
  db.apiTokens = (db.apiTokens || []).filter(r => {
    const hit = r && r.userId === userId && (id == null || r.id === id);
    if (hit) gone.push(r);
    return !hit;
  });
  return gone;
}

/* ---------- what a token sees and writes ---------- */

// The categories a key belongs to; null for a setting, false for a key no token gets.
function keyClass(k) {
  if (NEVER.has(k) || NEVER_RE.test(k)) return false;
  if (BOOK.has(k)) return 'book';
  // Own keys only: `constructor` or `__proto__` sent in a document names no category.
  return Object.hasOwn(KEY_CATEGORY, k) ? KEY_CATEGORY[k] : null;
}
const readable = (k, scopes) => {
  const c = keyClass(k);
  if (c === false) return false;
  if (c === 'book' || c === null) return TOKEN_CATEGORY_IDS.some(id => allows(scopes, id, 'view'));
  return c.some(id => allows(scopes, id, 'view'));
};
const writable = (k, scopes) => {
  const c = keyClass(k);
  return Array.isArray(c) && c.some(id => allows(scopes, id, 'apply'));
};

/** The categories a key belongs to (for the sharing log), or []. */
export const categoriesOf = k => (Array.isArray(keyClass(k)) ? keyClass(k) : []);

/** The part of document `S` a token with `scopes` may read. A read-only setting rides along. */
export function scopedState(S, scopes) {
  const out = {};
  if (!S || typeof S !== 'object' || Array.isArray(S)) return out;
  for (const [k, v] of Object.entries(S)) if (readable(k, scopes)) out[k] = v;
  return out;
}

/** The categories a token at `scopes` may read, as the sharing log names them. */
export const readCategories = scopes => TOKEN_CATEGORY_IDS.filter(id => allows(scopes, id, 'view'));

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The document after a token's write: a copy of `cur` with every key `sent` carries that the
 * token may write put in. A key it may only read has to come back as it is (a client sends the
 * document it was given), and is then ignored; a key it may not write and changed, or one it
 * could never have read, is refused. Bookkeeping keys are the server's and are ignored.
 * → { next, touched: [categories] }
 */
export function mergeScoped(cur, sent, scopes) {
  if (!sent || typeof sent !== 'object' || Array.isArray(sent)) throw new ScopeError(400, 'bad-state', 'state must be an object');
  const base = cur && typeof cur === 'object' ? cur : {};
  const next = JSON.parse(JSON.stringify(base));
  const touched = new Set();
  for (const [k, v] of Object.entries(sent)) {
    if (BOOK.has(k)) continue;
    if (writable(k, scopes)) {
      if (!same(base[k], v)) {
        if (v === undefined) delete next[k]; else next[k] = JSON.parse(JSON.stringify(v));
        for (const c of KEY_CATEGORY[k]) if (allows(scopes, c, 'apply')) touched.add(c);
      }
      continue;
    }
    if (readable(k, scopes) && same(base[k], v)) continue;
    throw new ScopeError(403, 'scope', `this token may not change ${JSON.stringify(k).slice(0, 60)}`);
  }
  return { next, touched: [...touched] };
}
