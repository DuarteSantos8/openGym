/* Bookkeeping for identities linked to a profile through an external provider, without a
   provider round trip. The routes that call this are in oidc-server.test.js. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { findIdentity, identityOf, addIdentity, identityView, unlinkIdentity, dropIdentities, pruneIdentities } from '../identities-store.js';

describe('findIdentity', () => {
  it('reads a missing identities array as nothing linked', () => {
    assert.equal(findIdentity({}, 'https://id.example.com', 'subject-1'), null);
  });

  it('matches only when both the issuer and the subject agree', () => {
    const row = { iss: 'https://id.example.com', sub: 'subject-1', userId: 'u1', email: null, linkedAt: '2026-01-01T00:00:00.000Z' };
    const db = { identities: [row] };
    assert.equal(findIdentity(db, 'https://id.example.com', 'subject-1'), row);
    // Same subject under a different issuer must not match: the handle is the pair, never the
    // subject alone, or a second provider configured later would collide with the first.
    assert.equal(findIdentity(db, 'https://other.example.com', 'subject-1'), null);
    assert.equal(findIdentity(db, 'https://id.example.com', 'subject-2'), null);
  });

  it('answers null with no identities linked to anything', () => {
    assert.equal(findIdentity({ identities: [] }, 'https://id.example.com', 'subject-1'), null);
  });
});

describe('identityOf', () => {
  it('reads a missing identities array as nothing linked', () => {
    assert.equal(identityOf({}, 'u1'), null);
  });

  it('finds the one row linked to a given profile', () => {
    const mine = { iss: 'https://id.example.com', sub: 'subject-1', userId: 'u1', email: null, linkedAt: '2026-01-01T00:00:00.000Z' };
    const theirs = { iss: 'https://id.example.com', sub: 'subject-2', userId: 'u2', email: null, linkedAt: '2026-01-01T00:00:00.000Z' };
    const db = { identities: [mine, theirs] };
    assert.equal(identityOf(db, 'u1'), mine);
    assert.equal(identityOf(db, 'u2'), theirs);
  });

  it('answers null for a profile with no linked identity', () => {
    const db = { identities: [{ iss: 'https://id.example.com', sub: 'subject-1', userId: 'u1', email: null, linkedAt: '2026-01-01T00:00:00.000Z' }] };
    assert.equal(identityOf(db, 'u2'), null);
  });
});

describe('addIdentity', () => {
  it('creates the array when absent and pushes the row', () => {
    const db = {};
    const r = addIdentity(db, { iss: 'https://id.example.com', sub: 'subject-1', userId: 'u1', email: null, linkedAt: '2026-01-01T00:00:00.000Z' });
    assert.deepEqual(r, { ok: true });
    assert.deepEqual(db.identities, [{ iss: 'https://id.example.com', sub: 'subject-1', userId: 'u1', email: null, linkedAt: '2026-01-01T00:00:00.000Z' }]);
  });

  it('refuses a pair already linked to any profile', () => {
    const row = { iss: 'https://id.example.com', sub: 'subject-1', userId: 'u1', email: null, linkedAt: '2026-01-01T00:00:00.000Z' };
    const db = { identities: [row] };
    const r = addIdentity(db, { iss: 'https://id.example.com', sub: 'subject-1', userId: 'u2', email: null, linkedAt: '2026-02-01T00:00:00.000Z' });
    assert.deepEqual(r, { error: 'this identity is already linked to a profile', code: 'identity-collision' });
    assert.equal(db.identities.length, 1, 'nothing is written on a refusal');
  });

  it('refuses a profile that already has a linked identity, even a different pair', () => {
    const row = { iss: 'https://id.example.com', sub: 'subject-1', userId: 'u1', email: null, linkedAt: '2026-01-01T00:00:00.000Z' };
    const db = { identities: [row] };
    const r = addIdentity(db, { iss: 'https://other.example.com', sub: 'subject-2', userId: 'u1', email: null, linkedAt: '2026-02-01T00:00:00.000Z' });
    assert.deepEqual(r, { error: 'this profile already has a linked identity', code: 'profile-linked' });
    assert.equal(db.identities.length, 1, 'nothing is written on a refusal');
  });
});

describe('identityView', () => {
  it('answers null with nothing linked', () => {
    assert.equal(identityView(null, 'Example ID'), null);
  });

  it('never discloses the issuer or the subject, only the provider name, the address and the link date', () => {
    const row = { iss: 'https://id.example.com', sub: 'subject-1', userId: 'u1', email: 'ana@example.com', linkedAt: '2026-01-01T00:00:00.000Z' };
    assert.deepEqual(identityView(row, 'Example ID'), { providerName: 'Example ID', email: 'ana@example.com', linkedAt: '2026-01-01T00:00:00.000Z', usable: true });
  });

  it('reads a stored null address back as null', () => {
    const row = { iss: 'https://id.example.com', sub: 'subject-1', userId: 'u1', email: null, linkedAt: '2026-01-01T00:00:00.000Z' };
    assert.deepEqual(identityView(row, 'Example ID'), { providerName: 'Example ID', email: null, linkedAt: '2026-01-01T00:00:00.000Z', usable: true });
  });

  it('shows a row that no longer signs in as not usable, and without the provider name', () => {
    const row = { iss: 'https://old.example.com', sub: 'subject-1', userId: 'u1', email: 'ana@example.com', linkedAt: '2026-01-01T00:00:00.000Z' };
    assert.deepEqual(identityView(row, 'Example ID', false), { providerName: null, email: 'ana@example.com', linkedAt: '2026-01-01T00:00:00.000Z', usable: false });
  });
});

describe('unlinkIdentity', () => {
  it('answers not-linked with a missing identities array', () => {
    const r = unlinkIdentity({}, 'u1');
    assert.deepEqual(r, { error: 'no identity is linked to this profile', code: 'not-linked' });
  });

  it('answers not-linked for a profile with none, and touches nothing', () => {
    const row = { iss: 'https://id.example.com', sub: 'subject-1', userId: 'u1', email: null, linkedAt: '2026-01-01T00:00:00.000Z' };
    const db = { identities: [row] };
    const r = unlinkIdentity(db, 'u2');
    assert.deepEqual(r, { error: 'no identity is linked to this profile', code: 'not-linked' });
    assert.equal(db.identities.length, 1);
  });

  it('removes the one row linked to the given profile, and leaves every other row alone', () => {
    const mine = { iss: 'https://id.example.com', sub: 'subject-1', userId: 'u1', email: null, linkedAt: '2026-01-01T00:00:00.000Z' };
    const theirs = { iss: 'https://id.example.com', sub: 'subject-2', userId: 'u2', email: null, linkedAt: '2026-01-01T00:00:00.000Z' };
    const db = { identities: [mine, theirs] };
    const r = unlinkIdentity(db, 'u1');
    assert.deepEqual(r, { ok: true, row: mine });
    assert.deepEqual(db.identities, [theirs]);
  });
});

describe('identity handles', () => {
  it('addIdentity refuses an issuer or a subject that is not a non-empty string, and writes nothing', () => {
    for (const [iss, sub] of [[undefined, undefined], ['https://id.example.com', undefined], [undefined, 'subject-1'],
      ['', 'subject-1'], ['https://id.example.com', ''], [42, 'subject-1'], ['https://id.example.com', { id: 1 }]]) {
      const db = {};
      const r = addIdentity(db, { iss, sub, userId: 'u1', email: null, linkedAt: '2026-01-01T00:00:00.000Z' });
      assert.equal(r.code, 'identity-invalid');
      assert.equal(db.identities, undefined);
    }
  });

  it('findIdentity never matches a lookup without real handles, even against a row stored without them', () => {
    const db = { identities: [{ userId: 'u1', linkedAt: '2026-01-01T00:00:00.000Z' }] };
    assert.equal(findIdentity(db, undefined, undefined), null);
    assert.equal(findIdentity(db, '', ''), null);
  });
});

describe('dropIdentities', () => {
  it('drops the rows of one profile and leaves the others', () => {
    const mine = { iss: 'https://id.example.com', sub: 'subject-1', userId: 'u1', email: 'ana@example.com', linkedAt: '2026-01-01T00:00:00.000Z' };
    const theirs = { iss: 'https://id.example.com', sub: 'subject-2', userId: 'u2', email: null, linkedAt: '2026-01-01T00:00:00.000Z' };
    const db = { identities: [mine, theirs] };
    dropIdentities(db, 'u1');
    assert.deepEqual(db.identities, [theirs]);
  });

  it('leaves a db.json with no identities key without one', () => {
    const db = {};
    dropIdentities(db, 'u1');
    assert.equal('identities' in db, false);
  });

  it('reads past malformed entries and a value that is not a list, instead of throwing', () => {
    const theirs = { iss: 'https://id.example.com', sub: 'subject-2', userId: 'u2', email: null, linkedAt: '2026-01-01T00:00:00.000Z' };
    const db = { identities: [null, 'x', 7, theirs] };
    dropIdentities(db, 'u2');
    assert.deepEqual(db.identities, [null, 'x', 7]);
    const odd = { identities: {} };
    dropIdentities(odd, 'u1');
    assert.deepEqual(odd.identities, {});
  });
});

describe('pruneIdentities', () => {
  const live = { iss: 'https://id.example.com', sub: 'subject-1', userId: 'u1', email: null, linkedAt: '2026-01-01T00:00:00.000Z' };
  const orphan = { iss: 'https://id.example.com', sub: 'subject-2', userId: 'gone', email: 'bea@example.com', linkedAt: '2026-01-01T00:00:00.000Z' };
  const handleless = { userId: 'u1', linkedAt: '2026-01-01T00:00:00.000Z' };

  it('drops rows whose profile is gone and rows without real handles, and says how many of each', () => {
    const db = { identities: [live, orphan, handleless] };
    assert.deepEqual(pruneIdentities(db, new Set(['u1'])), { orphaned: 1, malformed: 1 });
    assert.deepEqual(db.identities, [live]);
  });

  it('is idempotent: a second run drops nothing', () => {
    const db = { identities: [live, orphan] };
    pruneIdentities(db, new Set(['u1']));
    assert.deepEqual(pruneIdentities(db, new Set(['u1'])), { orphaned: 0, malformed: 0 });
    assert.deepEqual(db.identities, [live]);
  });

  it('leaves a db.json with no identities key without one', () => {
    const db = {};
    assert.deepEqual(pruneIdentities(db, new Set(['u1'])), { orphaned: 0, malformed: 0 });
    assert.equal('identities' in db, false);
  });

  it('drops null, non-object and array entries without throwing, and keeps the valid rows', () => {
    const db = { identities: [null, live, undefined, 'garbage', 42, true, [], { iss: 1, sub: {}, userId: 'u1' }] };
    assert.deepEqual(pruneIdentities(db, new Set(['u1'])), { orphaned: 0, malformed: 7 });
    assert.deepEqual(db.identities, [live]);
  });

  it('leaves an identities value that is not a list exactly as it is', () => {
    for (const value of [{}, { u1: live }, 'x', 3, null]) {
      const db = { identities: value };
      assert.deepEqual(pruneIdentities(db, new Set(['u1'])), { orphaned: 0, malformed: 0 });
      assert.deepEqual(db.identities, value);
    }
  });

  it('judges no row orphaned when the profile list cannot be read', () => {
    const db = { identities: [live, 'garbage'] };
    assert.deepEqual(pruneIdentities(db, null), { orphaned: 0, malformed: 1 });
    assert.deepEqual(db.identities, [live]);
  });

  it('leaves the list itself untouched when nothing is dropped', () => {
    const rows = [live];
    const db = { identities: rows };
    pruneIdentities(db, new Set(['u1']));
    assert.equal(db.identities, rows);
  });
});
