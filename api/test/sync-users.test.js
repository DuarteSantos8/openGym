/* usersPage (sync-data.js): the listing GET /api/sync/users answers with, on its own. The route, its
   token and its refusals are in server-sync.test.js. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { usersPage, USERS_LIMIT_DEFAULT, USER_ID } from '../sync-data.js';

const user = (id, extra = {}) => ({ id, name: 'Ana ' + id, email: id + '@example.test', passkeys: ['secret'], created: '2026-01-01', ...extra });
const revs = { a1: 4, b2: 9, c3: 0, d4: 12 };
const versionOf = id => ({ rev: revs[id] ?? 0 });
// Every page of one pass, as the hub reads it: each page starts after the last id of the one before.
function pass({ users, gone = [], limit, between = () => {} }) {
  const pages = [];
  let after = null, n = 0;
  do {
    const p = usersPage({ users: users(), gone: gone(), versionOf, after, limit });
    pages.push(p);
    after = p.next_after;
    between(++n);
  } while (after);
  return pages;
}

describe('usersPage', () => {
  it('lists id, state and revision, in id order, and nothing else about a profile', () => {
    const page = usersPage({ users: [user('d4'), user('a1'), user('c3', { disabled: true }), user('b2', { admin: true })], versionOf });
    assert.deepEqual(page, {
      users: [
        { id: 'a1', state: 'active', rev: 4 },
        { id: 'b2', state: 'active', rev: 9 },
        { id: 'c3', state: 'disabled', rev: 0 },
        { id: 'd4', state: 'active', rev: 12 }
      ],
      next_after: null
    });
    const text = JSON.stringify(page);
    for (const secret of ['Ana', 'example.test', 'secret', 'passkeys', '2026-01-01', 'admin', 'name', 'email']) assert.ok(!text.includes(secret), `${secret} never leaves`);
  });

  it('a deleted profile is listed as gone, with when, and a profile that exists is never hidden by an old record', () => {
    const page = usersPage({
      users: [user('a1'), user('c3')],
      gone: [{ id: 'b2', at: 1_760_000_000_000 }, { id: 'c3', at: 1_750_000_000_000 }, { id: 'x9', at: 'soon' }, { nope: true }, null],
      versionOf
    });
    assert.deepEqual(page.users, [
      { id: 'a1', state: 'active', rev: 4 },
      { id: 'b2', state: 'gone', rev: 0, gone_at: 1_760_000_000_000 },
      { id: 'c3', state: 'active', rev: 0 },
      { id: 'x9', state: 'gone', rev: 0, gone_at: null }
    ]);
  });

  it('pages by key: limit, then after, until next_after is null', () => {
    const all = ['a1', 'b2', 'c3', 'd4', 'e5'].map(id => user(id));
    const one = usersPage({ users: all, versionOf, limit: 2 });
    assert.deepEqual(one.users.map(u => u.id), ['a1', 'b2']);
    assert.equal(one.next_after, 'b2');
    const two = usersPage({ users: all, versionOf, limit: 2, after: one.next_after });
    assert.deepEqual(two.users.map(u => u.id), ['c3', 'd4']);
    const three = usersPage({ users: all, versionOf, limit: 2, after: two.next_after });
    assert.deepEqual(three, { users: [{ id: 'e5', state: 'active', rev: 0 }], next_after: null });
    // A page that ends exactly on the last profile has no next page.
    assert.equal(usersPage({ users: all.slice(0, 2), versionOf, limit: 2 }).next_after, null);
    assert.deepEqual(usersPage({ users: [], versionOf }), { users: [], next_after: null });
    assert.ok(USERS_LIMIT_DEFAULT >= 1);
  });

  it('reads the version for the profiles on the page only', () => {
    const asked = [];
    usersPage({ users: ['a1', 'b2', 'c3', 'd4'].map(id => user(id)), versionOf: id => { asked.push(id); return { rev: 1 }; }, limit: 2, after: 'a1' });
    assert.deepEqual(asked, ['b2', 'c3']);
  });

  it('carries the write id with the revision, so a restored backup that reuses a revision still shows', () => {
    const wids = { a1: 'aaaa1111', b2: '' };
    const page = usersPage({
      users: [user('a1'), user('b2'), user('c3', { disabled: true })],
      gone: [{ id: 'z9', at: 1 }],
      versionOf: id => ({ rev: 5, wid: wids[id] })
    });
    assert.deepEqual(page.users, [
      { id: 'a1', state: 'active', rev: 5, wid: 'aaaa1111' },
      { id: 'b2', state: 'active', rev: 5 },
      { id: 'c3', state: 'disabled', rev: 5 },
      { id: 'z9', state: 'gone', rev: 0, gone_at: 1 }
    ]);
    // Same revision, other contents: the rows differ.
    const at = wid => usersPage({ users: [user('a1')], versionOf: () => ({ rev: 5, wid }) }).users[0];
    assert.notDeepEqual(at('aaaa1111'), at('bbbb2222'));
  });

  it('is stable while profiles come and go between pages: nobody is repeated, nobody who stayed is missed', () => {
    let users = ['b2', 'd4', 'f6', 'h8', 'j0', 'l2'].map(id => user(id));
    let gone = [];
    const pages = pass({
      users: () => users, gone: () => gone, limit: 2,
      between: n => {
        if (n === 1) {
          // Behind the cursor: one profile is created and one is deleted. Ahead of it: one is
          // created, one disabled, one deleted.
          users = users.filter(u => u.id !== 'b2' && u.id !== 'h8');
          gone = [{ id: 'b2', at: 1 }, { id: 'h8', at: 2 }];
          users.push(user('a1'), user('g7'));
          users = users.map(u => (u.id === 'j0' ? { ...u, disabled: true } : u));
        }
      }
    });
    const seen = pages.flatMap(p => p.users.map(u => u.id));
    assert.equal(new Set(seen).size, seen.length, 'no profile twice');
    assert.deepEqual(seen, [...seen].sort(), 'ascending across pages');
    // Everyone who existed at the start and was not touched is in it, once.
    for (const id of ['d4', 'f6', 'j0', 'l2']) assert.ok(seen.includes(id), id);
    // One deleted ahead of the cursor after the first page simply is not there as a profile any more.
    assert.ok(seen.includes('h8'), 'and it is reported as gone instead');
    assert.equal(pages.flatMap(p => p.users).find(u => u.id === 'h8').state, 'gone');
    assert.equal(pages.flatMap(p => p.users).find(u => u.id === 'j0').state, 'disabled');
    // A profile created behind the cursor after the pass went by is for the next pass.
    assert.ok(!seen.includes('a1'));
    assert.deepEqual(usersPage({ users, gone, versionOf }).users.map(u => u.id).slice(0, 2), ['a1', 'b2']);
  });

  it('an id that is not an id is ignored, and the cursor pattern is the id pattern', () => {
    const page = usersPage({ users: [user('a1'), { id: 5 }, { id: 'has space' }, { id: '' }, null, 'x', user('b/c')], versionOf });
    assert.deepEqual(page.users.map(u => u.id), ['a1']);
    for (const ok of ['a1', 'Vh3kQ9w2ZbYc0aLm', 'a_b-c']) assert.ok(USER_ID.test(ok), ok);
    for (const bad of ['', 'a b', 'a/b', 'a'.repeat(65), '../x', 'a\nb']) assert.ok(!USER_ID.test(bad), JSON.stringify(bad));
  });
});
