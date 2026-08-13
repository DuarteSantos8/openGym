import crypto from 'node:crypto';

export const DEVICE_LINK_TTL_MS = 15 * 60 * 1000;

function prune(db, now, keepUserId) {
  db.deviceLinks = (db.deviceLinks || []).filter(l => l.exp > now && l.userId !== keepUserId);
}

export function createDeviceLink(db, userId, now = Date.now(), ttlMs = DEVICE_LINK_TTL_MS) {
  prune(db, now, userId);
  const link = {
    token: crypto.randomBytes(18).toString('base64url'),
    userId,
    exp: now + ttlMs,
    created: now
  };
  db.deviceLinks.push(link);
  return link;
}

export function claimDeviceLink(db, token, now = Date.now()) {
  db.deviceLinks = db.deviceLinks || [];
  const i = db.deviceLinks.findIndex(l => l.token === token);
  if (i < 0) return { error: 'unknown or already used' };
  const link = db.deviceLinks[i];
  db.deviceLinks.splice(i, 1);
  if (link.exp < now) return { error: 'link expired' };
  return { userId: link.userId };
}

export function deviceLinkUrl(origin, token) {
  const base = String(origin || '').replace(/\/+$/, '');
  return base + '/?link=' + encodeURIComponent(token);
}
