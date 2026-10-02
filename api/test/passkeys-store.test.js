/* Bookkeeping for more than one passkey on a profile (#95). The routes are in
   server-passkeys.test.js; this is the part that decides without a WebAuthn ceremony. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  addPasskeyRecord, listPasskeys, removePasskeyRecord, passkeyRemovalRefused, renamePasskeyRecord, passkeyName, MAX_PASSKEYS
} from '../passkeys-store.js';

const cred = (id, userId = 'u1') => ({
  id, userId, publicKey: 'pk-' + id, counter: 0, transports: ['internal']
});

describe('addPasskeyRecord', () => {
  it('attaches a credential to the existing user', () => {
    const db = { creds: [cred('hello', 'u1')] };
    const r = addPasskeyRecord(db, 'u1', { ...cred('phone', 'u1'), name: '  Work   phone ' });
    assert.equal(r.ok, true);
    assert.equal(db.creds.length, 2);
    assert.equal(db.creds[1].id, 'phone');
    assert.equal(db.creds[1].userId, 'u1');
    assert.equal(db.creds[1].name, 'Work phone');
    assert.ok(db.creds[1].created);
  });

  it('refuses a credential id that already exists', () => {
    const db = { creds: [cred('hello', 'u1')] };
    const r = addPasskeyRecord(db, 'u2', cred('hello', 'u2'));
    assert.deepEqual(r, { error: 'credential already registered', code: 'credential-exists' });
    assert.equal(db.creds.length, 1);
  });

  it('keeps only a short list of short transport words', () => {
    const db = { creds: [] };
    addPasskeyRecord(db, 'u1', { ...cred('a'), transports: ['usb', 42, 'x'.repeat(100), ...Array(20).fill('nfc')] });
    assert.deepEqual(db.creds[0].transports, ['usb', ...Array(7).fill('nfc')]);
    addPasskeyRecord(db, 'u1', { ...cred('b'), transports: 'internal' });
    assert.deepEqual(db.creds[1].transports, []);
  });

  it(`stops at ${MAX_PASSKEYS} passkeys per profile`, () => {
    const db = { creds: Array.from({ length: MAX_PASSKEYS }, (_, i) => cred('k' + i)) };
    assert.equal(addPasskeyRecord(db, 'u1', cred('one-more')).code, 'passkey-limit');
    assert.equal(addPasskeyRecord(db, 'u2', cred('theirs', 'u2')).ok, true);
  });
});

describe('listPasskeys', () => {
  it('returns only this user’s credentials, without the public key', () => {
    const db = { creds: [cred('a', 'u1'), cred('b', 'u2'), { ...cred('c', 'u1'), name: 'Laptop', created: 'x', lastUsed: 'y' }] };
    const list = listPasskeys(db, 'u1');
    assert.deepEqual(list.map(c => c.id), ['a', 'c']);
    for (const c of list) assert.equal(c.publicKey, undefined);
    assert.deepEqual(list[0], { id: 'a', name: null, created: null, lastUsed: null, transports: ['internal'] });
    assert.deepEqual(list[1], { id: 'c', name: 'Laptop', created: 'x', lastUsed: 'y', transports: ['internal'] });
  });
});

describe('renamePasskeyRecord', () => {
  it('names one of the user’s passkeys, and an empty name clears it', () => {
    const db = { creds: [cred('a', 'u1')] };
    assert.equal(renamePasskeyRecord(db, 'u1', 'a', 'Security key\n').ok, true);
    assert.equal(db.creds[0].name, 'Security key');
    renamePasskeyRecord(db, 'u1', 'a', '   ');
    assert.equal('name' in db.creds[0], false);
  });

  it('does not touch another user’s passkey', () => {
    const db = { creds: [cred('a', 'u1')] };
    assert.equal(renamePasskeyRecord(db, 'u2', 'a', 'mine now').code, 'not-found');
    assert.equal(db.creds[0].name, undefined);
  });
});

describe('passkeyName', () => {
  it('folds whitespace and control characters, and caps the length', () => {
    assert.equal(passkeyName('a\u0000b\tc'), 'a b c');
    assert.equal(passkeyName('x'.repeat(100)).length, 40);
    assert.equal(passkeyName(42), '');
    assert.equal(passkeyName({ toString: () => 'x' }), '');
  });

  it('drops invisible format characters that reorder or hide text, and keeps the joiners', () => {
    // Right-to-left override and isolates, zero-width space, word joiner, byte-order mark, soft hyphen.
    assert.equal(passkeyName('Phone\u202Egnp.exe'), 'Phonegnp.exe');
    assert.equal(passkeyName('\u2066Lap\u200Btop\u2069 \u2060\uFEFFkey\u00AD'), 'Laptop key');
    assert.equal(passkeyName('\u200E\u200F\u061C'), '');
    // An emoji sequence and a Devanagari conjunct keep their joiners.
    assert.equal(passkeyName('👨\u200D👩\u200D👧 iPad'), '👨\u200D👩\u200D👧 iPad');
    assert.equal(passkeyName('क्\u200Dष फ़ोन'), 'क्\u200Dष फ़ोन');
  });
});

describe('removePasskeyRecord', () => {
  it('removes one of several passkeys', () => {
    const db = { creds: [cred('hello', 'u1'), cred('phone', 'u1')] };
    const r = removePasskeyRecord(db, 'u1', 'hello');
    assert.equal(r.ok, true);
    assert.equal(r.row.id, 'hello');
    assert.deepEqual(db.creds.map(c => c.id), ['phone']);
  });

  it('refuses to remove the last passkey when nothing else signs the profile in', () => {
    const db = { creds: [cred('hello', 'u1'), cred('other', 'u2')] };
    const r = removePasskeyRecord(db, 'u1', 'hello');
    assert.deepEqual(r, { error: 'this passkey is the only way into this profile', code: 'last-way-in' });
    assert.equal(db.creds.length, 2);
  });

  it('lets the last passkey go while a password still signs the profile in', () => {
    const db = { creds: [cred('hello', 'u1')] };
    assert.equal(removePasskeyRecord(db, 'u1', 'hello', 1).ok, true);
    assert.equal(db.creds.length, 0);
  });

  it('does not let one user delete another’s passkey', () => {
    const db = { creds: [cred('hello', 'u1'), cred('other', 'u2')] };
    const r = removePasskeyRecord(db, 'u2', 'hello');
    assert.deepEqual(r, { error: 'passkey not found', code: 'not-found' });
    assert.equal(db.creds.length, 2);
  });
});

describe('passkeyRemovalRefused', () => {
  // Asked before the route asks the owner for proof, so it must answer as the removal would —
  // and change nothing.
  it('answers what removePasskeyRecord would, without removing anything', () => {
    const db = { creds: [cred('hello', 'u1'), cred('phone', 'u1'), cred('other', 'u2')] };
    assert.equal(passkeyRemovalRefused(db, 'u1', 'hello'), null);
    assert.deepEqual(passkeyRemovalRefused(db, 'u1', 'other'), { error: 'passkey not found', code: 'not-found' });
    assert.deepEqual(passkeyRemovalRefused(db, 'u2', 'other'), { error: 'this passkey is the only way into this profile', code: 'last-way-in' });
    assert.equal(passkeyRemovalRefused(db, 'u2', 'other', 1), null);
    assert.equal(passkeyRemovalRefused({}, 'u1', 'hello').code, 'not-found');
    assert.equal(db.creds.length, 3);
  });
});
