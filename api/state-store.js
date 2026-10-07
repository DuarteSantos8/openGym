// Compare-and-swap writes of state-<uid>.json, shared by PUT /api/data and the optional MCP
// server's write tools (mcp/src/state.js) when both are running. Keyed on `_rev`, the revision
// the api already hands out, so a write from a stale copy is refused whichever side made it.
// Only `_rev` and `active` are touched; everything else, `_ts` included, is the caller's.
import fs from 'node:fs';
import crypto from 'node:crypto';

// Returns { state, version }; a missing file is an empty profile at version 0. A file that does
// not parse throws, unless `corruptAsEmpty` — PUT /api/data has always let a device overwrite an
// unreadable file rather than leave it unable to sync.
export function readSnapshot(file, { corruptAsEmpty = false } = {}) {
  let state;
  try { state = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) {
    if (e.code === 'ENOENT' || corruptAsEmpty) return { state: null, version: 0 };
    throw e;
  }
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    if (corruptAsEmpty) return { state: null, version: 0 };
    throw new Error('profile state is not an object');
  }
  return { state, version: Number(state._rev) || 0 };
}

// `expectedVersion` undefined means an unconditional write (PUT without baseRev). `producer`
// gets a copy of the stored state and returns the next one. Throws `code: 'CONFLICT'` (with the
// current state and version) or `code: 'BUSY'` when the other process holds the lock.
export function changeState(file, expectedVersion, producer, { corruptAsEmpty = false } = {}) {
  const lock = file + '.lock';
  let fd;
  try { fd = fs.openSync(lock, 'wx', 0o600); }
  catch (e) {
    if (e.code !== 'EEXIST') throw e;
    // Never taken over by age: the holder may only be paused. A lock left by a crash is removed
    // by hand with both processes stopped (docs/MCP_REMOTE.md).
    throw Object.assign(new Error('profile is busy, retry'), { code: 'BUSY' });
  }
  const tmp = file + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
  try {
    const { state, version } = readSnapshot(file, { corruptAsEmpty });
    if (expectedVersion !== undefined && expectedVersion !== version) {
      throw Object.assign(new Error(`state changed: expected version ${expectedVersion}, current is ${version}; read it again before writing`), { code: 'CONFLICT', state, version });
    }
    const next = producer(structuredClone(state || {}));
    delete next.active;                    // in-progress workouts stay device-local
    next._rev = version + 1;
    fs.writeFileSync(tmp, JSON.stringify(next));
    fs.renameSync(tmp, file);
    return { state: next, version: next._rev };
  } finally {
    fs.rmSync(tmp, { force: true });
    fs.closeSync(fd);
    fs.unlinkSync(lock);
  }
}
