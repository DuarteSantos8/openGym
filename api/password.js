/* Password hashing and policy for the optional password sign-in (#118). node:crypto only.
 *
 * A hash is stored as one self-describing string, PHC style:
 *
 *     $scrypt$v=1$ln=15,r=8,p=1$<salt, base64>$<key, base64>
 *
 * The parameters travel with every hash, so they can be raised later without a migration:
 * verifyPassword() reads whatever a hash says, and needsRehash() tells the caller to store a
 * fresh one after the next successful sign-in.
 *
 * scrypt at N = 2^15, r = 8, p = 1 is 32 MiB and roughly 50–150 ms of one core per attempt on
 * the kind of machine people self-host on — slow enough that a stolen db.json is expensive to
 * crack, cheap enough for a Raspberry Pi to sign someone in. Because every attempt costs that
 * much, the number running at once is capped (SLOTS) and the queue behind it is short (QUEUE):
 * past that the caller is told to come back rather than the process being walked into its
 * memory limit by a burst of logins. */
import crypto from 'node:crypto';

export const MIN_LENGTH = 10;
// Long passphrases are the point, so the cap is only there to bound the work: scrypt runs its
// input through PBKDF2 first, and a 5 MiB "password" would be hashed in full.
export const MAX_LENGTH = 256;

const PARAMS = { ln: 15, r: 8, p: 1 };
const KEYLEN = 32;
const SALT_BYTES = 16;
// 128 * N * r is 32 MiB at these parameters; node refuses anything at or past `maxmem`.
const maxmem = ({ ln, r, p }) => 128 * 2 ** ln * r * p + 16 * 1024 * 1024;

const SLOTS = 2;
const QUEUE = 32;
let running = 0;
const waiting = [];

export class BusyError extends Error {}

const rawScrypt = (secret, salt, params, keylen = KEYLEN) => new Promise((resolve, reject) => crypto.scrypt(secret, salt, keylen,
  { N: 2 ** params.ln, r: params.r, p: params.p, maxmem: maxmem(params) },
  (err, key) => (err ? reject(err) : resolve(key))));

// Node's scrypt runs on the libuv pool (four threads by default), which also serves fs and dns
// work for everything else; two slots leave the rest of the server room to breathe.
async function scrypt(secret, salt, params, keylen) {
  if (running >= SLOTS) {
    if (waiting.length >= QUEUE) throw new BusyError('password check queue full');
    await new Promise(resolve => waiting.push(resolve));
  } else running++;
  try {
    return await rawScrypt(secret, salt, params, keylen);
  } finally {
    const next = waiting.shift();
    if (next) next(); else running--;
  }
}

// NFKC, so the same passphrase typed on two keyboards (a composed "é" on one, "e" plus a
// combining accent on the other) is the same passphrase. Nothing else is changed: no trimming,
// no case folding — every character someone chose is part of the secret.
const normalize = pw => String(pw).normalize('NFKC');
export const passwordLength = pw => [...normalize(pw)].length;

const format = (salt, key) => `$scrypt$v=1$ln=${PARAMS.ln},r=${PARAMS.r},p=${PARAMS.p}$${salt.toString('base64')}$${key.toString('base64')}`;

export async function hashPassword(pw) {
  const salt = crypto.randomBytes(SALT_BYTES);
  return format(salt, await scrypt(normalize(pw), salt, PARAMS));
}

function parse(stored) {
  const m = /^\$scrypt\$v=1\$ln=(\d{1,2}),r=(\d{1,2}),p=(\d{1,2})\$([A-Za-z0-9+/]+=*)\$([A-Za-z0-9+/]+=*)$/.exec(String(stored || ''));
  if (!m) return null;
  const params = { ln: +m[1], r: +m[2], p: +m[3] };
  // Bounds on what a stored string may ask for, so a hand-edited db.json cannot make one
  // sign-in allocate more than 256 MiB or spin for minutes.
  if (params.ln < 10 || params.ln > 17 || params.r < 1 || params.r > 16 || params.p < 1 || params.p > 16) return null;
  if (128 * 2 ** params.ln * params.r > 256 * 1024 * 1024) return null;
  const salt = Buffer.from(m[4], 'base64');
  const key = Buffer.from(m[5], 'base64');
  if (salt.length < 8 || key.length < 16 || key.length > 128) return null;
  return { params, salt, key };
}

// A well-formed hash of a random secret nobody knows. Signing in as a name that has no
// password runs the same scrypt against this, so the answer takes as long either way and the
// response time does not say which names exist. Made once, outside the slots, so that a full
// queue cannot leave it a rejected promise for good.
let dummy = null;
function dummyHash() {
  if (!dummy) {
    const salt = crypto.randomBytes(SALT_BYTES);
    dummy = rawScrypt(crypto.randomBytes(24).toString('base64'), salt, PARAMS).then(key => format(salt, key));
    dummy.catch(() => { dummy = null; });
  }
  return dummy;
}

/** true only when `pw` matches `stored`. A missing or malformed `stored` does the same work
 *  against the dummy hash and answers false. */
export async function verifyPassword(pw, stored) {
  const real = parse(stored);
  const h = real || parse(await dummyHash());
  // Derived at the length the stored key has, so a hash made with another key length still verifies.
  const key = await scrypt(normalize(pw), h.salt, h.params, h.key.length);
  return !!real && crypto.timingSafeEqual(key, h.key);
}
/** Makes the dummy hash now, so the first sign-in with an unknown name is not the one that pays
 *  for it — and takes measurably longer than every later one. */
export const warmUp = () => dummyHash().then(() => {}, () => {});

export const needsRehash = stored => {
  const h = parse(stored);
  return !h || h.params.ln !== PARAMS.ln || h.params.r !== PARAMS.r || h.params.p !== PARAMS.p;
};

// How names compare for password sign-in: the same NFKC as above, then trimmed and case-folded,
// so "Ana", "ana " and "ＡＮＡ" are one name. The stored display name is never changed.
export const nameKey = name => String(name || '').normalize('NFKC').trim().toLowerCase();

/* ------------------------------------------------------------------ e-mail ----------------
   An optional second name to sign in with. Nothing is ever sent to it — no verification, no
   reset mail; an admin's code stays the only reset — so it is only ever compared, the way a name
   is: the same fold as nameKey() (NFKC, trimmed, lower-cased). Lower-casing the local part is
   stricter than RFC 5321 allows, and what every mail provider people actually use does anyway;
   two profiles on one instance told apart only by the case of their address is not a thing
   worth supporting. The syntax check is deliberately loose — one "@", something before it, a
   dotted domain after it, no spaces or brackets — because nothing here delivers mail and a
   stricter rule would only refuse real addresses. 254 is the longest address SMTP can carry. */
export const EMAIL_MAX = 254;
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]{1,64}@(?=.{1,253}$)[^\s@<>()[\]\\,;:"._-][^\s@<>()[\]\\,;:"]*\.[^\s@<>()[\]\\,;:".]{2,}$/u;
/** The stored form of an address, or null when it is not one. */
export function normalizeEmail(raw) {
  if (typeof raw !== 'string') return null;
  const e = nameKey(raw);
  if (!e || [...e].length > EMAIL_MAX || !EMAIL_RE.test(e) || e.includes('..')) return null;
  return e;
}
/** What the audit log and the console may say about an address: its first character and its
 *  domain's, nothing that would let someone reading the log write to it. */
export const maskEmail = e => {
  const [local = '', domain = ''] = String(e || '').split('@');
  return (local[0] || '?') + '…@' + (domain[0] || '?') + '…';
};

/* ------------------------------------------------------------------ policy ----------------
   Length first, which is what actually matters; then a short list of the passwords every
   guessing script tries first. The list only has to hold entries of MIN_LENGTH or more — the
   rest are already too short — plus the stems people pad with digits and a "!" to get past a
   length rule. A leaked-password database would be better and is deliberately not bundled:
   it is megabytes, and an instance that locks an account after a handful of wrong guesses is
   not where the long tail of that list gets tried. */
const COMMON = new Set([
  '1234567890', '0987654321', '12345678910', '123456789012', '1234567890123', '11111111111',
  '1111111111', '0000000000', '9999999999', '1q2w3e4r5t', '1q2w3e4r5t6y', 'q1w2e3r4t5',
  'qwertyuiop', 'qwertyuiop[]', 'asdfghjkl;', 'asdfghjkl', 'zxcvbnm,./', '1qaz2wsx3edc',
  'qazwsxedc123', 'qwerty123456', 'qwertz123456', 'azerty123456', 'password12', 'password123',
  'password1234', 'password12345', 'passw0rd123', 'iloveyou123', 'abcdefghij', 'abcd123456',
  'abc1234567', 'a1b2c3d4e5', 'aaaaaaaaaa', 'princess123', 'football123', 'baseball123',
  'sunshine123', 'superman123', 'welcome123', 'welcome1234', 'letmein123', 'trustno1234',
  'changeme123', 'administrator', 'opengym123', 'opengym1234', 'qwerty1234567', '123qweasdzxc',
  'zaq12wsxcde3', '1q2w3e4r5t6y7u', 'q1w2e3r4t5y6', '123123123123', '1234512345',
  '123456123456', 'monkey12345', 'dragon12345', 'master12345', 'shadow12345', 'michael123',
  'jennifer123', 'computer123', 'starwars123', 'whatever123', 'freedom1234', 'pokemon1234',
  'liverpool123', 'chelsea1234', 'arsenal1234', 'barcelona123', 'realmadrid123', 'juventus123',
  'hallo12345', 'passwort123', 'passwort1234', 'motdepasse123', 'contrasena123', 'contraseña123',
  'senha123456', 'parola12345', 'haslo123456', 'wachtwoord123', 'salasana123', 'gymgymgym1'
]);
const STEMS = new Set([
  'password', 'passwort', 'passw0rd', 'motdepasse', 'contrasena', 'contraseña', 'senha', 'parola',
  'haslo', 'wachtwoord', 'salasana', 'qwerty', 'qwertz', 'azerty', 'qwertyuiop', 'asdfgh',
  'letmein', 'welcome', 'iloveyou', 'admin', 'administrator', 'changeme', 'opengym', 'gym',
  'workout', 'fitness', 'dragon', 'monkey', 'football', 'baseball', 'sunshine', 'princess',
  'superman', 'batman', 'master', 'shadow', 'trustno', 'abc', 'abcdef', 'secret', 'login'
]);

/** Why a password may not be used, as a short code the client translates — or null. `name` is
 *  the profile name it will sign in with: that name plus a few digits is not a password. */
export function passwordProblem(pw, name) {
  if (typeof pw !== 'string') return 'too-short';
  const len = passwordLength(pw);
  if (len < MIN_LENGTH) return 'too-short';
  if (len > MAX_LENGTH) return 'too-long';
  const low = normalize(pw).toLowerCase();
  if (new Set(low).size <= 2) return 'too-common';          // "aaaaaaaaaa", "abababababab"
  if (COMMON.has(low)) return 'too-common';
  // Letters of any script count as the stem; what a length rule gets padded with does not.
  const stem = low.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '');
  if (STEMS.has(stem)) return 'too-common';                   // "Password123!", "qwerty.2024"
  const n = nameKey(name);
  if (n.length >= 3 && stem === n) return 'too-common';       // "ana.2024.2024"
  return null;
}

/* ----------------------------------------------------------------- reset codes -------------
   What an admin hands someone who can no longer get in. 12 characters from the pairing-code
   alphabet (no 0/O/1/I) is 60 bits: it is read off a screen and typed once, and it lives a day,
   so the per-address throttle is all that needs to stand in front of it — a per-name pause would
   only let a stranger keep the real code refused. Stored only as a SHA-256 — the code is random,
   so a slow hash would add nothing but a second way to exhaust the server. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const RESET_TTL_MS = 24 * 3600000;

export function makeResetCode() {
  const bytes = crypto.randomBytes(12);
  // 256 is a multiple of 32, so the modulo is unbiased.
  const raw = Array.from(bytes, b => ALPHABET[b % ALPHABET.length]).join('');
  return raw.slice(0, 4) + '-' + raw.slice(4, 8) + '-' + raw.slice(8);
}
const cleanCode = code => String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export const hashResetCode = code => crypto.createHash('sha256').update('opengym-reset:' + cleanCode(code)).digest('hex');
export function resetCodeMatches(code, stored) {
  if (!stored || typeof stored.h !== 'string' || !(stored.exp > Date.now())) return false;
  const a = Buffer.from(hashResetCode(code), 'hex');
  const b = Buffer.from(stored.h, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
