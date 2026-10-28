import { packProfile } from './profile-pack.js';
// Full-profile sync limit, shared by server and device migrations; nginx uses 16m.
export const MAX_SYNC_BODY = 16 * 1024 * 1024;
// What actually travels (and nginx counts): the packed form.
export const syncSize = state => new TextEncoder().encode(JSON.stringify({ state: packProfile(state), baseRev: Number.MAX_SAFE_INTEGER })).byteLength;
export function assertSyncSize(state) {
  if (syncSize(state) > MAX_SYNC_BODY) throw new Error('profile-too-large');
}
