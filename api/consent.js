/* Versioned consent texts and the one record format both the trainer feature and the shared
 * library write (docs/TRAINERS.md, docs/dev/SHARED-LIBRARY-API.md). The English text is the
 * canonical one: the app shows its translation, and the record says which version and hash of
 * the canonical text was agreed to, plus the language it was read in. */
import crypto from 'node:crypto';

// Bump `v` whenever a text changes in meaning. Old records keep the version they were given.
export const CONSENT_TEXTS = {
  trainer: {
    v: 1,
    text: 'You are letting this trainer see the categories marked here, and change the ones marked suggest or apply. '
      + 'If the trainer works for a gym, its gym lead sees the categories in the gym lead row, never more than view. '
      + 'You can change this or disconnect any time, and it stops working the moment you do. '
      + 'Every look and every change is written to your sharing log, which only you can read.'
  },
  lead: {
    v: 1,
    text: 'You are joining this gym. Its gym lead sees your name and the categories you mark here, never more than view. '
      + 'You can change this or leave the gym any time, and it stops working the moment you do.'
  },
  library: {
    v: 1,
    text: 'This is public to everyone on this server: everyone with an account here can see it, try it and copy it. Your name and the date go with it, always. '
      + 'Only share what is yours: something you made, recorded or have the right to pass on. '
      + 'The exercise pictures and animations of the built-in library are licensed and can never be shared. '
      + 'You can stop sharing any time; copies people already took stay with them.'
  }
};
export const CONSENT_KINDS = Object.keys(CONSENT_TEXTS);

export const consentHash = (kind, v, text) =>
  crypto.createHash('sha256').update(`${kind}\n${v}\n${text}`).digest('hex');

/** What the app needs to show and later prove a consent: kind, version, hash, canonical text. */
export function currentConsent(kind) {
  const c = CONSENT_TEXTS[kind];
  if (!c) return null;
  return { kind, v: c.v, hash: consentHash(kind, c.v, c.text), text: c.text };
}

/** Whether what the client says it showed is the current text. Anything else is a 409 for the
 *  caller, with the current text, so the app can show it again. */
export function consentCurrent(kind, given) {
  const cur = currentConsent(kind);
  return !!cur && !!given && typeof given === 'object' && given.v === cur.v && given.hash === cur.hash;
}

const LANG_RE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/;

/** A consent record, the same shape for every kind:
 *  { id, kind, memberId, subjectId, v, hash, lang, scopes?, at, revokedAt } */
export function consentRecord({ kind, memberId, subjectId, given, scopes, lang, now = Date.now() }) {
  const cur = currentConsent(kind);
  return {
    id: 'c_' + crypto.randomBytes(9).toString('base64url'),
    kind, memberId, subjectId,
    v: cur.v, hash: cur.hash,
    lang: typeof lang === 'string' && LANG_RE.test(lang) ? lang : 'en',
    ...(scopes ? { scopes: { ...scopes } } : {}),
    at: now, revokedAt: null
  };
}
