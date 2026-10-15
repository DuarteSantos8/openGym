/* Invite expiry, single use and the public check (invites.js). The routes are in
   server-invites.test.js. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  INVITE_TTL_MS, inviteStatus, usableInvite, newInvite, migrateInvites, revokeInvite, inviteCheck, inviteName, codeHint
} from '../invites.js';

const NOW = Date.UTC(2026, 9, 15, 12);
const iso = ms => new Date(ms).toISOString();
const DAY = 86400000;

describe('inviteStatus', () => {
  const fresh = newInvite({ code: 'AAAA1111BBBB2222', note: '', createdBy: 'adm', now: NOW });

  it('is valid for fourteen days after it was made, and expired from then on', () => {
    assert.equal(fresh.expiresAt, iso(NOW + 14 * DAY));
    assert.equal(INVITE_TTL_MS, 14 * DAY);
    assert.equal(inviteStatus(fresh, NOW), 'valid');
    assert.equal(inviteStatus(fresh, NOW + 14 * DAY - 1), 'valid');
    assert.equal(inviteStatus(fresh, NOW + 14 * DAY), 'expired');
  });

  it('is used once someone signed up with it, whatever its date says', () => {
    assert.equal(inviteStatus({ ...fresh, usedBy: 'u9' }, NOW), 'used');
    assert.equal(inviteStatus({ ...fresh, usedBy: 'u9' }, NOW + 30 * DAY), 'used');
  });

  it('is revoked once revoked, and an invite with no readable expiry is expired', () => {
    const inv = { ...fresh };
    revokeInvite(inv, NOW);
    assert.equal(inviteStatus(inv, NOW), 'revoked');
    assert.equal(inv.revokedAt, iso(NOW));
    assert.equal(inviteStatus({ code: 'X', expiresAt: 'soon' }, NOW), 'expired');
    assert.equal(inviteStatus({ code: 'X' }, NOW), 'expired');
  });
});

describe('usableInvite', () => {
  const invites = [
    newInvite({ code: 'GOOD0000GOOD0000', note: '', createdBy: 'adm', now: NOW }),
    { ...newInvite({ code: 'USED0000USED0000', note: '', createdBy: 'adm', now: NOW }), usedBy: 'u1' },
    newInvite({ code: 'OLD00000OLD00000', note: '', createdBy: 'adm', now: NOW - 15 * DAY })
  ];

  it('finds only an invite that can still sign someone up', () => {
    assert.equal(usableInvite(invites, 'GOOD0000GOOD0000', NOW)?.code, 'GOOD0000GOOD0000');
    assert.equal(usableInvite(invites, 'USED0000USED0000', NOW), null);
    assert.equal(usableInvite(invites, 'OLD00000OLD00000', NOW), null);
    assert.equal(usableInvite(invites, 'NOPE', NOW), null);
    assert.equal(usableInvite(undefined, 'GOOD0000GOOD0000', NOW), null);
  });
});

describe('migrateInvites', () => {
  it('gives every invite from before expiry the full fourteen days from now, once', () => {
    const made = iso(NOW - 100 * DAY);
    const invites = [
      { code: 'A', created: made },
      { code: 'B', created: made, usedBy: 'u1' },
      { code: 'C', created: made, expiresAt: iso(NOW + DAY) }
    ];
    assert.equal(migrateInvites(invites, NOW), true);
    assert.equal(invites[0].expiresAt, iso(NOW + 14 * DAY));
    assert.equal(invites[1].expiresAt, iso(NOW + 14 * DAY));
    assert.equal(invites[2].expiresAt, iso(NOW + DAY), 'one that has an expiry keeps it');
    assert.equal(inviteStatus(invites[0], NOW), 'valid', 'an unused old invite still works after the update');
    assert.equal(inviteStatus(invites[1], NOW), 'used');
    assert.equal(migrateInvites(invites, NOW + DAY), false, 'a second boot changes nothing');
    assert.equal(invites[0].expiresAt, iso(NOW + 14 * DAY));
  });
});

describe('inviteCheck', () => {
  const users = [{ id: 'adm', name: 'Adrian', pw: { h: 'secret' } }, { id: 'u1', name: 'Bea' }];
  const invites = [
    newInvite({ code: 'AAAA1111BBBB2222', note: 'for my sister', name: 'Ana', createdBy: 'adm', now: NOW }),
    { ...newInvite({ code: 'CCCC3333DDDD4444', note: 'gym buddy', name: 'Carl', createdBy: 'adm', now: NOW }), usedBy: 'u1', usedAt: iso(NOW) },
    newInvite({ code: 'EEEE5555FFFF6666', note: '', name: 'Eve', createdBy: 'gone-admin', now: NOW })
  ];

  it('answers the status, the inviter and the suggested name of a usable invite, in any case', () => {
    assert.deepEqual(inviteCheck(invites, users, 'AAAA1111BBBB2222', NOW), { status: 'valid', inviterName: 'Adrian', suggestedName: 'Ana' });
    assert.deepEqual(inviteCheck(invites, users, 'aaaa1111bbbb2222', NOW), { status: 'valid', inviterName: 'Adrian', suggestedName: 'Ana' });
  });

  it('names nobody for a used, revoked or expired one: the status only', () => {
    assert.deepEqual(inviteCheck(invites, users, 'CCCC3333DDDD4444', NOW), { status: 'used', inviterName: null, suggestedName: null });
    assert.deepEqual(inviteCheck(invites, users, 'AAAA1111BBBB2222', NOW + 15 * DAY), { status: 'expired', inviterName: null, suggestedName: null });
    const revoked = invites.map(i => ({ ...i }));
    revokeInvite(revoked[0], NOW);
    assert.deepEqual(inviteCheck(revoked, users, 'AAAA1111BBBB2222', NOW), { status: 'revoked', inviterName: null, suggestedName: null });
  });

  it('hints at a code for the audit log without giving it away', () => {
    assert.equal(codeHint('AAAA1111BBBB2222'), 'AAAA…');
    assert.equal(codeHint(undefined), '');
  });

  it('says nothing of an inviter whose profile is gone', () => {
    assert.deepEqual(inviteCheck(invites, users, 'EEEE5555FFFF6666', NOW), { status: 'valid', inviterName: null, suggestedName: 'Eve' });
  });

  it('leaks nothing else: no note, no user, no dates, no ids', () => {
    for (const code of ['AAAA1111BBBB2222', 'CCCC3333DDDD4444']) {
      const r = inviteCheck(invites, users, code, NOW);
      assert.deepEqual(Object.keys(r).sort(), ['inviterName', 'status', 'suggestedName']);
      const text = JSON.stringify(r);
      for (const secret of ['sister', 'buddy', 'Bea', 'u1', 'adm', 'secret', '2026']) assert.ok(!text.includes(secret), secret);
    }
  });

  it('answers null for a code that names no invite, or is not a code at all', () => {
    for (const code of ['ZZZZ0000ZZZZ0000', '', 'a/b', '../db.json', 'x'.repeat(65), 'AB', null, 42]) {
      assert.equal(inviteCheck(invites, users, code, NOW), null, String(code));
    }
  });

  it('never uses the invite up', () => {
    const before = JSON.stringify(invites);
    inviteCheck(invites, users, 'AAAA1111BBBB2222', NOW);
    assert.equal(JSON.stringify(invites), before);
  });
});

describe('inviteName', () => {
  it('folds control and invisible characters and caps the length', () => {
    assert.equal(inviteName('  Ana\u0000 ‮Maria  '), 'Ana Maria');
    assert.equal(inviteName('x'.repeat(100)).length, 40);
    assert.equal(inviteName(42), '');
    assert.equal(newInvite({ code: 'C', note: '', name: '   ', createdBy: 'a', now: NOW }).name, undefined);
  });
});
