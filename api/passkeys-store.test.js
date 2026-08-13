import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { addPasskeyRecord, listPasskeys, removePasskeyRecord } from './passkeys-store.js';

const cred = (id, userId = 'u1') => ({
  id, userId, publicKey: 'pk-' + id, counter: 0, transports: ['internal']
});

describe('addPasskeyRecord', () => {
  it('attaches a credential to the existing user', () => {
    const db = { creds: [cred('hello', 'u1')] };
    const r = addPasskeyRecord(db, 'u1', cred('phone', 'u1'));
    assert.deepEqual(r, { ok: true });
    assert.equal(db.creds.length, 2);
    assert.equal(db.creds[1].id, 'phone');
    assert.equal(db.creds[1].userId, 'u1');
    assert.ok(db.creds[1].created);
  });

  it('refuses a credential id that already exists', () => {
    const db = { creds: [cred('hello', 'u1')] };
    const r = addPasskeyRecord(db, 'u2', cred('hello', 'u2'));
    assert.deepEqual(r, { error: 'credential already registered' });
    assert.equal(db.creds.length, 1);
  });
});

describe('listPasskeys', () => {
  it('returns only this user’s credentials, without the public key', () => {
    const db = { creds: [cred('a', 'u1'), cred('b', 'u2'), cred('c', 'u1')] };
    const list = listPasskeys(db, 'u1');
    assert.deepEqual(list.map(c => c.id), ['a', 'c']);
    for (const c of list) assert.equal(c.publicKey, undefined);
  });
});

describe('removePasskeyRecord', () => {
  it('removes one of several passkeys', () => {
    const db = { creds: [cred('hello', 'u1'), cred('phone', 'u1')] };
    const r = removePasskeyRecord(db, 'u1', 'hello');
    assert.deepEqual(r, { ok: true });
    assert.deepEqual(db.creds.map(c => c.id), ['phone']);
  });

  it('refuses to remove the last passkey', () => {
    const db = { creds: [cred('hello', 'u1')] };
    const r = removePasskeyRecord(db, 'u1', 'hello');
    assert.deepEqual(r, { error: 'keep at least one passkey' });
    assert.equal(db.creds.length, 1);
  });

  it('does not let one user delete another’s passkey', () => {
    const db = { creds: [cred('hello', 'u1'), cred('other', 'u2')] };
    const r = removePasskeyRecord(db, 'u2', 'hello');
    assert.deepEqual(r, { error: 'passkey not found' });
    assert.equal(db.creds.length, 2);
  });
});
