/* The device-link bookkeeping (#95): one code per profile, hashed at rest, good once and for a few
   minutes. The routes around it are in server-passkeys.test.js. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createDeviceLink, findDeviceLink, burnDeviceLink, dropDeviceLinks, hashLinkCode, makeLinkCode, DEVICE_LINK_TTL_MS
} from '../device-link.js';

describe('createDeviceLink', () => {
  it('issues a code bound to the user, with an expiry, and keeps only its hash', () => {
    const db = { deviceLinks: [] };
    const now = 1_700_000_000_000;
    const { code, link } = createDeviceLink(db, 'user-a', now, 10 * 60 * 1000);
    assert.equal(link.userId, 'user-a');
    assert.equal(link.exp, now + 10 * 60 * 1000);
    assert.match(code, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    assert.equal(db.deviceLinks.length, 1);
    assert.equal(db.deviceLinks[0].h, hashLinkCode(code));
    // Nowhere in what is stored does the code itself appear.
    assert.doesNotMatch(JSON.stringify(db), new RegExp(code.replace(/-/g, '')));
    assert.doesNotMatch(JSON.stringify(db), new RegExp(code));
  });

  it('lasts ten minutes unless told otherwise', () => {
    const db = {};
    const { link } = createDeviceLink(db, 'user-a', 1000);
    assert.equal(link.exp, 1000 + DEVICE_LINK_TTL_MS);
    assert.equal(DEVICE_LINK_TTL_MS, 10 * 60 * 1000);
  });

  it('replaces any unused link for the same user', () => {
    const db = { deviceLinks: [] };
    const first = createDeviceLink(db, 'user-a', 1000, 60_000);
    const second = createDeviceLink(db, 'user-a', 2000, 60_000);
    assert.equal(db.deviceLinks.length, 1);
    assert.equal(findDeviceLink(db, first.code, 2500), null);
    assert.equal(findDeviceLink(db, second.code, 2500), second.link);
  });

  it('leaves another user’s unused link alone', () => {
    const db = { deviceLinks: [] };
    createDeviceLink(db, 'user-a', 1000, 60_000);
    createDeviceLink(db, 'user-b', 1000, 60_000);
    assert.equal(db.deviceLinks.length, 2);
  });

  it('makes codes that differ', () => {
    const seen = new Set(Array.from({ length: 200 }, makeLinkCode));
    assert.equal(seen.size, 200);
  });
});

describe('findDeviceLink', () => {
  it('finds the link however the code is typed, without using it up', () => {
    const db = { deviceLinks: [] };
    const { code, link } = createDeviceLink(db, 'user-a', 1000, 60_000);
    assert.equal(findDeviceLink(db, code, 2000), link);
    assert.equal(findDeviceLink(db, ' ' + code.toLowerCase().replace(/-/g, ' ') + ' ', 2000), link);
    assert.equal(db.deviceLinks.length, 1);
  });

  it('is single use once burned', () => {
    const db = { deviceLinks: [] };
    const { code, link } = createDeviceLink(db, 'user-a', 1000, 60_000);
    burnDeviceLink(db, link);
    assert.equal(findDeviceLink(db, code, 2000), null);
    assert.equal(db.deviceLinks.length, 0);
  });

  it('refuses an expired link and drops it', () => {
    const db = { deviceLinks: [] };
    const { code } = createDeviceLink(db, 'user-a', 1000, 60_000);
    assert.equal(findDeviceLink(db, code, 1000 + 60_000 + 1), null);
    assert.equal(db.deviceLinks.length, 0);
  });

  it('refuses a wrong code without touching other links, and ignores rows that are not links', () => {
    const db = { deviceLinks: [null, { userId: 'x', exp: Infinity }] };
    createDeviceLink(db, 'user-a', 1000, 60_000);
    assert.equal(findDeviceLink(db, 'nope', 1000), null);
    assert.equal(findDeviceLink(db, 'AAAA-AAAA-AAAA', 1000), null);
    assert.equal(findDeviceLink(db, { toString: 1 }, 1000), null);
    assert.equal(db.deviceLinks.length, 1);
  });
});

describe('dropDeviceLinks', () => {
  it('drops only that user’s links and says whether any went', () => {
    const db = { deviceLinks: [] };
    const a = createDeviceLink(db, 'user-a', 1000, 60_000);
    const b = createDeviceLink(db, 'user-b', 1000, 60_000);
    assert.equal(dropDeviceLinks(db, 'user-a'), true);
    assert.equal(dropDeviceLinks(db, 'user-a'), false);
    assert.equal(findDeviceLink(db, a.code, 2000), null);
    assert.equal(findDeviceLink(db, b.code, 2000), b.link);
  });
});
