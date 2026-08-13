import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createDeviceLink, claimDeviceLink, deviceLinkUrl } from './device-link.js';

describe('createDeviceLink', () => {
  it('issues a one-time token bound to the user, with an expiry', () => {
    const db = { deviceLinks: [] };
    const now = 1_700_000_000_000;
    const link = createDeviceLink(db, 'user-a', now, 15 * 60 * 1000);
    assert.equal(link.userId, 'user-a');
    assert.equal(link.exp, now + 15 * 60 * 1000);
    assert.equal(typeof link.token, 'string');
    assert.ok(link.token.length >= 20);
    assert.equal(db.deviceLinks.length, 1);
    assert.equal(db.deviceLinks[0].token, link.token);
  });

  it('replaces any unused link for the same user', () => {
    const db = { deviceLinks: [] };
    const first = createDeviceLink(db, 'user-a', 1000, 60_000);
    const second = createDeviceLink(db, 'user-a', 2000, 60_000);
    assert.equal(db.deviceLinks.length, 1);
    assert.equal(db.deviceLinks[0].token, second.token);
    assert.notEqual(first.token, second.token);
  });

  it('leaves another user’s unused link alone', () => {
    const db = { deviceLinks: [] };
    createDeviceLink(db, 'user-a', 1000, 60_000);
    createDeviceLink(db, 'user-b', 1000, 60_000);
    assert.equal(db.deviceLinks.length, 2);
  });
});

describe('claimDeviceLink', () => {
  it('returns the user and burns the token', () => {
    const db = { deviceLinks: [] };
    const link = createDeviceLink(db, 'user-a', 1000, 60_000);
    const claimed = claimDeviceLink(db, link.token, 2000);
    assert.deepEqual(claimed, { userId: 'user-a' });
    assert.equal(db.deviceLinks.length, 0);
    assert.deepEqual(claimDeviceLink(db, link.token, 3000), { error: 'unknown or already used' });
  });

  it('refuses an expired link and removes it', () => {
    const db = { deviceLinks: [] };
    const link = createDeviceLink(db, 'user-a', 1000, 60_000);
    const claimed = claimDeviceLink(db, link.token, 1000 + 60_000 + 1);
    assert.deepEqual(claimed, { error: 'link expired' });
    assert.equal(db.deviceLinks.length, 0);
  });

  it('refuses a missing token without touching other links', () => {
    const db = { deviceLinks: [] };
    createDeviceLink(db, 'user-a', 1000, 60_000);
    assert.deepEqual(claimDeviceLink(db, 'nope', 1000), { error: 'unknown or already used' });
    assert.equal(db.deviceLinks.length, 1);
  });
});

describe('deviceLinkUrl', () => {
  it('puts the token on the origin as ?link=', () => {
    assert.equal(
      deviceLinkUrl('https://gym.avott.duckdns.org', 'abc+1'),
      'https://gym.avott.duckdns.org/?link=abc%2B1'
    );
  });

  it('does not double the slash when the origin already has one', () => {
    assert.equal(
      deviceLinkUrl('https://gym.example.com/', 'tok'),
      'https://gym.example.com/?link=tok'
    );
  });
});
