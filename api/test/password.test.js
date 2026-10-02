/* Hashing, policy and reset codes for password sign-in (#118), in-process. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  hashPassword, verifyPassword, needsRehash, passwordProblem, nameKey,
  makeResetCode, hashResetCode, resetCodeMatches
} from '../password.js';

test('a hash is a versioned scrypt string with its own salt, and only the password verifies', async () => {
  const a = await hashPassword('correct horse battery');
  const b = await hashPassword('correct horse battery');
  assert.match(a, /^\$scrypt\$v=1\$ln=15,r=8,p=1\$[A-Za-z0-9+/]+=*\$[A-Za-z0-9+/]+=*$/);
  assert.notEqual(a, b, 'a fresh salt every time');
  assert.equal(await verifyPassword('correct horse battery', a), true);
  assert.equal(await verifyPassword('correct horse batterY', a), false);
  assert.equal(needsRehash(a), false);
  assert.equal(needsRehash(a.replace('ln=15', 'ln=14')), true);
});

test('a hash with other parameters or another key length still verifies, and asks to be redone', async () => {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync('correct horse battery', salt, 64, { N: 2 ** 14, r: 8, p: 1 });
  const stored = `$scrypt$v=1$ln=14,r=8,p=1$${salt.toString('base64')}$${key.toString('base64')}`;
  assert.equal(await verifyPassword('correct horse battery', stored), true);
  assert.equal(await verifyPassword('correct horse batter', stored), false);
  assert.equal(needsRehash(stored), true);
  // …but not one that would take a gigabyte to check.
  assert.equal(await verifyPassword('correct horse battery', stored.replace('ln=14', 'ln=20')), false);
});

test('the same passphrase typed with a composed or a combining accent is the same', async () => {
  const h = await hashPassword('café au lait, bitte');
  assert.equal(await verifyPassword('café au lait, bitte', h), true);
});

test('no stored hash, or a malformed one, never verifies — and still does the work', async () => {
  for (const stored of [undefined, null, '', 'plaintext', '$scrypt$v=1$ln=40,r=8,p=1$c2FsdHNhbHQ=$a2V5a2V5a2V5a2V5a2V5']) {
    assert.equal(await verifyPassword('anything', stored), false);
  }
});

test('policy: length first, then the passwords every script tries first', () => {
  assert.equal(passwordProblem('short', 'Ana'), 'too-short');
  assert.equal(passwordProblem(12345678901, 'Ana'), 'too-short', 'not a string');
  assert.equal(passwordProblem('x'.repeat(257) + 'yz', 'Ana'), 'too-long');
  assert.equal(passwordProblem('correct horse battery staple '.repeat(9).slice(0, 256), 'Ana'), null, '256 characters are fine');
  for (const pw of ['Password123!', 'qwerty.2024!!', '1234567890', 'aaaaaaaaaaaa', 'abababababab', 'ana.2024.2024', 'OpenGym2026!']) {
    assert.equal(passwordProblem(pw, 'Ana'), 'too-common', pw);
  }
  for (const pw of ['correct horse battery', '日本語のパスワードです', '73920184652', 'Ana likes deadlifts']) {
    assert.equal(passwordProblem(pw, 'Ana'), null, pw);
  }
});

test('names compare folded and trimmed', () => {
  assert.equal(nameKey('  Ana Lu '), 'ana lu');
  assert.equal(nameKey('ＡＮＡ'), 'ana');
});

test('reset codes: readable, compared on the hash, typed any way, dead after expiry', () => {
  const code = makeResetCode();
  assert.match(code, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  const stored = { h: hashResetCode(code), exp: Date.now() + 60000 };
  assert.equal(stored.h.includes(code), false);
  assert.equal(resetCodeMatches(code.toLowerCase().replace(/-/g, ' '), stored), true);
  assert.equal(resetCodeMatches(makeResetCode(), stored), false);
  assert.equal(resetCodeMatches(code, { ...stored, exp: Date.now() - 1 }), false);
  assert.equal(resetCodeMatches(code, null), false);
});
