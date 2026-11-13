/* What a shared item may carry, per type (library design 2.3). The server keeps the shape small
 * and harmless: plain JSON, short strings without control or bidi characters, bounded lists, no
 * prototype keys, media only as refs to files the item names. The field-by-field healing of a
 * routine or an exercise happens again in the app that imports it, through the same sanitizers a
 * plan file goes through, so a copy can never be more than a file someone could have sent anyway. */
import { HASH_RE } from '../media.js';
import { TEXT } from './config.js';

export class LibraryError extends Error {
  constructor(status, code, message, extra) {
    super(message || code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}
const bad = (code, message, status = 400) => new LibraryError(status, code, message);

// Control characters, bidi overrides and isolates out; Unicode normalised so two looks of one
// name are one name.
const STRIP = /[\u0000-\u0008\u000b-\u001f\u007f‎‏‪-‮⁦-⁩]/g;
export function cleanText(v, max, { lines = false } = {}) {
  if (typeof v !== 'string') return '';
  let s = v.normalize('NFC').replace(STRIP, '');
  s = lines ? s.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n') : s.replace(/\s+/g, ' ');
  return s.trim().slice(0, max);
}
export const cleanLang = v => (typeof v === 'string' && /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(v) ? v : 'en');

/** http(s) only, no user:password, at most 2048 characters. Anything else is no link. */
export function cleanUrl(v) {
  if (typeof v !== 'string' || !v.trim()) return '';
  let u;
  try { u = new URL(v.trim()); } catch { return ''; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
  if (u.username || u.password) return '';
  const s = u.toString();
  return s.length <= 2048 ? s : '';
}

const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);
/* Plain JSON, rebuilt: strings cleaned, numbers finite, depth, keys and list lengths bounded.
   Throws on anything that is not data. */
export function cleanJson(v, { depth = 8, maxList = 500, maxKeys = 200, maxString = 2000 } = {}, d = 0) {
  if (d > depth) throw bad('bad-payload', 'that is nested too deeply');
  if (v === null || typeof v === 'boolean') return v;
  if (typeof v === 'number') { if (!Number.isFinite(v)) throw bad('bad-payload', 'numbers only'); return v; }
  if (typeof v === 'string') return cleanText(v, maxString, { lines: true });
  if (Array.isArray(v)) {
    if (v.length > maxList) throw bad('bad-payload', 'that list is too long');
    return v.map(x => cleanJson(x, { depth, maxList, maxKeys, maxString }, d + 1));
  }
  if (typeof v === 'object') {
    const keys = Object.keys(v);
    if (keys.length > maxKeys) throw bad('bad-payload', 'too many fields');
    const out = {};
    for (const k of keys) {
      if (FORBIDDEN.has(k) || k.length > 64) continue;
      if (v[k] === undefined) continue;
      out[k] = cleanJson(v[k], { depth, maxList, maxKeys, maxString }, d + 1);
    }
    return out;
  }
  throw bad('bad-payload', 'plain data only');
}

const MIME_KIND = {
  'image/jpeg': 'image', 'image/png': 'image', 'image/webp': 'image', 'image/gif': 'gif',
  'video/mp4': 'video', 'video/quicktime': 'video', 'video/webm': 'video', 'audio/wav': 'audio'
};
const intIn = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
/* A MediaRef as frontend/src/lib/media-refs.js normalizeMediaRef keeps it, or null. */
export function cleanRef(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
  if (typeof r.hash !== 'string' || !HASH_RE.test(r.hash)) return null;
  const kind = MIME_KIND[r.mime];
  if (!kind || r.kind !== kind) return null;
  if (!intIn(r.size, 1, 200 * 1024 * 1024) || !intIn(r.width, 1, 16384) || !intIn(r.height, 1, 16384)) return null;
  const out = { kind, hash: r.hash, mime: r.mime, size: r.size, width: r.width, height: r.height };
  if (typeof r.dur === 'number' && Number.isFinite(r.dur) && r.dur >= 0 && r.dur <= 3600) out.dur = Math.round(r.dur * 10) / 10;
  if (kind === 'video' && typeof r.codec === 'string' && /^[a-z0-9]{2,8}$/.test(r.codec)) out.codec = r.codec;
  const p = r.poster;
  if (p && typeof p === 'object' && typeof p.hash === 'string' && HASH_RE.test(p.hash) && (p.mime === 'image/webp' || p.mime === 'image/jpeg')
    && intIn(p.size, 1, 200 * 1024 * 1024) && intIn(p.width, 1, 16384) && intIn(p.height, 1, 16384)) {
    out.poster = { hash: p.hash, mime: p.mime, size: p.size, width: p.width, height: p.height };
  }
  return out;
}

/** Every file hash a cleaned payload refers to (refs and their posters), in order, once. */
export function refsOf(payload) {
  const out = [];
  const walk = (v, d) => {
    if (!v || typeof v !== 'object' || d > 12) return;
    if (Array.isArray(v)) { for (const x of v) walk(x, d + 1); return; }
    if (typeof v.hash === 'string' && HASH_RE.test(v.hash) && typeof v.mime === 'string') {
      if (!out.includes(v.hash)) out.push(v.hash);
      if (v.poster && HASH_RE.test(v.poster.hash || '') && !out.includes(v.poster.hash)) out.push(v.poster.hash);
      return;
    }
    for (const x of Object.values(v)) walk(x, d + 1);
  };
  walk(payload, 0);
  return out;
}
/** Every ref object in a payload, for the size and type checks against the stored file. */
export function refObjects(payload) {
  const out = [];
  const walk = (v, d) => {
    if (!v || typeof v !== 'object' || d > 12) return;
    if (Array.isArray(v)) { for (const x of v) walk(x, d + 1); return; }
    if (typeof v.hash === 'string' && HASH_RE.test(v.hash) && typeof v.mime === 'string') {
      out.push(v);
      if (v.poster && typeof v.poster === 'object' && HASH_RE.test(v.poster.hash || '')) out.push({ ...v.poster, kind: v.poster.mime === 'image/gif' ? 'gif' : 'image', poster: true });
      return;
    }
    for (const x of Object.values(v)) walk(x, d + 1);
  };
  walk(payload, 0);
  return out;
}

const ID = /^[A-Za-z0-9_.:-]{1,64}$/;
const HEX = /^#[0-9a-fA-F]{6}$/;
const ICON = /^[A-Za-z][A-Za-z0-9]{0,23}$/;
const sizeOf = v => Buffer.byteLength(JSON.stringify(v));
const MEASURE_UNITS = new Set(['cm', 'in', '%', 'kg', 'lb', 'none']);
// Fields of a custom exercise that are not the exercise itself: whose it is, where it syncs, how
// it was shared. A copy gets fresh ones.
const EX_DROP = new Set(['id', '_ts', 'shared', 'origin', 'from', 'custom', 'media', 'deleted', 'hidden']);

function cleanExercise(ex) {
  if (!ex || typeof ex !== 'object' || Array.isArray(ex)) throw bad('bad-payload', 'an exercise is needed');
  const n = cleanText(ex.n, 100);
  if (!n) throw bad('bad-payload', 'the exercise needs a name');
  const out = { n };
  for (const [k, v] of Object.entries(ex)) {
    if (k === 'n' || EX_DROP.has(k) || !/^[A-Za-z][A-Za-z0-9]{0,23}$/.test(k)) continue;
    if (typeof v === 'string') out[k] = k === 'url' ? cleanUrl(v) : cleanText(v, k === 'desc' || k === 'cues' ? 2000 : 120, { lines: k === 'desc' || k === 'cues' });
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'boolean') out[k] = v;
    else if (Array.isArray(v) && v.length <= 40) out[k] = v.filter(x => typeof x === 'string' || (typeof x === 'number' && Number.isFinite(x))).map(x => (typeof x === 'string' ? cleanText(x, 120, { lines: true }) : x));
  }
  if (out.url === '') delete out.url;
  return out;
}

/**
 * The cleaned payload of one item, or a LibraryError. Media refs are cleaned here; whether each
 * file exists, fits and is free of metadata is the route's job (it needs the disk).
 */
export function cleanPayload(type, p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw bad('bad-payload', 'the item needs a payload');
  switch (type) {
    case 'sound': {
      const m = cleanRef(p.m);
      if (!m || m.kind !== 'audio') throw bad('bad-payload', 'a sound needs its WAV file');
      return { name: cleanText(p.name, 40) || 'Sound', m };
    }
    case 'exercise': {
      const out = { ex: cleanExercise(p.ex) };
      if (p.media) {
        const m = cleanRef(p.media);
        if (!m || m.kind === 'audio') throw bad('bad-payload', 'that is not a picture or a video');
        out.media = m;
      }
      return out;
    }
    case 'plan': {
      const bundle = cleanJson(p.bundle, { depth: 10, maxList: 500, maxKeys: 300, maxString: 4000 });
      if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) throw bad('bad-payload', 'a plan file is needed');
      if (!Array.isArray(bundle.routines) && !Array.isArray(bundle.programmes)) throw bad('bad-payload', 'that plan has no routines');
      if (sizeOf(bundle) > 512 * 1024) throw bad('bad-payload', 'that plan is too big', 413);
      return { bundle };
    }
    case 'equipment': {
      const profile = cleanJson(p.profile, { depth: 6, maxList: 300, maxKeys: 60, maxString: 120 });
      if (!profile || typeof profile !== 'object' || Array.isArray(profile)) throw bad('bad-payload', 'a gym profile is needed');
      for (const k of ['id', '_ts', 'shared', 'origin', 'from']) delete profile[k];
      if (sizeOf(profile) > 32 * 1024) throw bad('bad-payload', 'that gym profile is too big', 413);
      if (refsOf(profile).length) throw bad('bad-payload', 'a gym profile carries no files');
      return { profile, name: cleanText(p.name, 60) };
    }
    case 'tip': {
      const exId = typeof p.exId === 'string' && ID.test(p.exId) ? p.exId : '';
      const text = cleanText(p.text, TEXT.tip, { lines: true });
      if (!exId || !text) throw bad('bad-payload', 'a tip needs an exercise and some words');
      return { exId, text, exName: cleanText(p.exName, 100) };
    }
    case 'look': {
      const icon = x => {
        if (!x || typeof x !== 'object') return null;
        const v = typeof x.v === 'string' ? x.v : '';
        // An icon name, or one emoji (a few code points with joiners and variation selectors).
        const okV = ICON.test(v) || (v.length <= 16 && /^\p{Extended_Pictographic}/u.test(v) && !/[\s<>"'`]/.test(v));
        if (!okV) return null;
        return { v, ...(HEX.test(x.c || '') ? { c: x.c.toLowerCase() } : {}) };
      };
      const out = {};
      const f = icon(p.flame), z = icon(p.freeze);
      if (f) out.flame = f;
      if (z) out.freeze = z;
      if (HEX.test(p.accent || '') || /^[a-z]{3,12}$/.test(p.accent || '')) out.accent = String(p.accent).toLowerCase();
      if (!Object.keys(out).length) throw bad('bad-payload', 'a look needs an icon or a colour');
      return out;
    }
    case 'measures': {
      const fields = (Array.isArray(p.fields) ? p.fields : []).slice(0, 20).map(f => ({
        name: cleanText(f?.name, 40), unit: MEASURE_UNITS.has(f?.unit) ? f.unit : 'cm'
      })).filter(f => f.name);
      if (!fields.length) throw bad('bad-payload', 'a set needs at least one field');
      return { fields };
    }
    case 'avatar': {
      const m = cleanRef(p.m);
      if (!m || m.kind !== 'image') throw bad('bad-payload', 'a profile picture is a still image');
      return { m };
    }
    case 'photo': case 'progress': case 'formvideo': {
      // A set video kept "only on this phone" was never meant to leave it.
      if (p.local === true || (Array.isArray(p.media) && p.media.some(m => m?.local === true))) throw bad('media-local', 'that video stays on the phone that filmed it', 422);
      const list = (Array.isArray(p.media) ? p.media : []).map(cleanRef).filter(Boolean);
      if (!list.length || list.length > 6) throw bad('bad-payload', 'one to six photos or videos');
      if (list.some(m => m.kind === 'audio')) throw bad('bad-payload', 'photos and videos only');
      if (type === 'formvideo' && list.some(m => m.kind !== 'video')) throw bad('bad-payload', 'form checks are videos');
      const out = { media: list, caption: cleanText(p.caption, 200) };
      const exId = typeof p.exId === 'string' && ID.test(p.exId) ? p.exId : '';
      if (exId) out.exId = exId;
      return out;
    }
  }
  throw bad('type-off', 'that kind of item is not shared on this server');
}

/** The words a search looks through, beside title and description. */
export function searchTextOf(item) {
  const p = item.payload || {};
  const parts = [item.title, item.desc];
  if (item.type === 'exercise') parts.push(p.ex?.n, p.ex?.eq, p.ex?.bp, p.ex?.tg);
  if (item.type === 'sound') parts.push(p.name);
  if (item.type === 'tip') parts.push(p.exName, p.text);
  if (item.type === 'equipment') parts.push(p.name);
  if (item.type === 'plan') for (const r of (p.bundle?.routines || []).slice(0, 30)) parts.push(r?.name);
  return parts.filter(x => typeof x === 'string').join(' ').toLowerCase();
}
