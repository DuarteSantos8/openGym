/* The shared library's switches (docs/dev/SHARED-LIBRARY-API.md, docs/SELF_HOSTING.md), read once
 * from the environment. LIBRARY=on is the master switch and is off by default, so an instance
 * that never asked for a community library has no routes, no config block and no trace of it.
 * SHARING=off still wins over it (permissions.js reads that one too). */

const ON = /^(1|true|yes|on)$/i;
const OFF = /^(0|false|no|off)$/i;

export const BASE_TYPES = ['sound', 'exercise', 'plan', 'equipment', 'tip', 'look', 'measures', 'avatar'];
export const PERSONAL_TYPES = ['photo', 'formvideo', 'progress'];
export const ALL_TYPES = [...BASE_TYPES, ...PERSONAL_TYPES];

export function libraryConfig(env = process.env) {
  const num = (key, def, min) => {
    const raw = env[key];
    if (raw == null || String(raw).trim() === '') return def;
    const n = Number(raw);
    return Number.isFinite(n) && n >= min ? n : def;
  };
  const on = ON.test(String(env.LIBRARY || '').trim()) && !OFF.test(String(env.SHARING || '').trim());
  const personalMedia = ON.test(String(env.SHARE_PERSONAL_MEDIA || '').trim());
  const allowed = personalMedia ? ALL_TYPES : BASE_TYPES;
  const listed = String(env.SHARE_TYPES || '').split(',').map(s => s.trim()).filter(Boolean);
  // A list that names personal types without SHARE_PERSONAL_MEDIA still leaves them out: that
  // switch is the one that decides about photos of people.
  let types = listed.length ? allowed.filter(t => listed.includes(t)) : allowed.slice();
  if (personalMedia && listed.length && !PERSONAL_TYPES.some(t => listed.includes(t))) types = [...types, ...PERSONAL_TYPES];
  return {
    on,
    types,
    review: ON.test(String(env.SHARE_REVIEW || '').trim()),
    personalMedia,
    quotaMB: num('SHARE_QUOTA_MB', 50, 0),             // per person, across everything they share; 0 = no cap
    videoMB: num('SHARE_VIDEO_MAX_MB', 25, 0.001),     // tighter than private uploads: many people load it
    imageMB: num('SHARE_IMAGE_MAX_MB', 2, 0.001),
    gifMB: num('SHARE_GIF_MAX_MB', 8, 0.001),
    soundMB: num('SHARE_SOUND_MAX_MB', 2, 0.001),
    soundSec: num('SHARE_SOUND_MAX_SEC', 30, 1),
    avatarKB: num('SHARE_AVATAR_MAX_KB', 32, 1),
    autohide: Math.floor(num('SHARE_AUTOHIDE_REPORTS', 3, 1)),
    perType: Math.floor(num('SHARE_ITEMS_PER_TYPE', 50, 1)),
    graceDays: num('SHARE_GC_GRACE_DAYS', 14, 0)
  };
}

export const TEXT = { title: 60, desc: 500, tip: 500, note: 300 };

/** The block GET /api/config hands a session. */
export const publicLibraryConfig = (c, consent) => ({
  types: c.types,
  review: c.review,
  personalMedia: c.personalMedia,
  limits: { quotaMB: c.quotaMB, videoMB: c.videoMB, imageMB: c.imageMB, gifMB: c.gifMB, soundMB: c.soundMB, soundSec: c.soundSec, title: TEXT.title, desc: TEXT.desc },
  consent: { kind: consent.kind, v: consent.v, hash: consent.hash }
});
