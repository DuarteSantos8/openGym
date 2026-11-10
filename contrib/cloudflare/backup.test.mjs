// node --test contrib/cloudflare/backup.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { backup, restoreSql } from './backup.js';

const big = Buffer.alloc(1_500_000, 7);
const rows = [
  { path: 'db.json', body: Buffer.from('{"users":[]}') },
  { path: "state-o'neil.json#part0", body: big.subarray(0, 1_000_000) },
  { path: "state-o'neil.json#part1", body: big.subarray(1_000_000) },
];

test('backup puts today and drops copies older than 30 days', async () => {
  const store = new Map([['backups/2026-09-01.json', ''], ['backups/2026-10-20.json', ''], ['uploads/u1/a.jpg', '']]);
  const env = {
    DB: { prepare: () => ({ all: async () => ({ results: rows }) }) },
    MEDIA: {
      put: async (k, v) => { store.set(k, v); },
      list: async ({ prefix }) => ({ objects: [...store.keys()].filter(k => k.startsWith(prefix)).map(key => ({ key })) }),
      delete: async k => { store.delete(k); },
    },
  };
  await backup(env, new Date('2026-11-10T03:00:00Z'));
  assert.deepEqual([...store.keys()].sort(), ['backups/2026-10-20.json', 'backups/2026-11-10.json', 'uploads/u1/a.jpg']);
  const saved = JSON.parse(store.get('backups/2026-11-10.json'));
  assert.equal(Buffer.from(saved['db.json'], 'base64').toString(), '{"users":[]}');
});

test('restoreSql rebuilds every file in statements D1 accepts', () => {
  const files = Object.fromEntries(rows.map(r => [r.path, Buffer.from(r.body).toString('base64')]));
  const lines = restoreSql(files).trim().split('\n');
  assert.equal(lines[0], 'DELETE FROM files;');
  for (const l of lines) assert.ok(l.length < 100_000, 'statement under 100 KB');
  const parts = lines.slice(1).map(l => l.match(/VALUES \('(.*)', X'([0-9a-f]*)'\);$/)).map(m => [m[1].replace(/''/g, "'"), m[2]]);
  assert.deepEqual(parts.find(([p]) => p === 'db.json')[1], Buffer.from('{"users":[]}').toString('hex'));
  const state = parts.filter(([p]) => p.startsWith("state-o'neil.json#part"))
    .sort((a, b) => Number(a[0].split('#part')[1]) - Number(b[0].split('#part')[1]));
  assert.ok(Buffer.from(state.map(([, h]) => h).join(''), 'hex').equals(big));
});
