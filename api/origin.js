/* Where a copied item came from: the `origin` field a routine, exercise or sound carries once a
 * trainer assigned it or it was taken from the shared library. One shape for both features
 * (trainer design 4.4, library design 2.2), cleaned the same way wherever it is written:
 *
 *   origin: { kind: 'trainer'|'library', id, sourceId, version, by, at, server? }
 *     id        the trainer's profile id, or the library item id ('s_…')
 *     sourceId  the original's id on the other side (the trainer's routine), when there is one
 *     version   the original's version at the time of copying
 *     by        the name to credit, a snapshot taken when copied (never looked up again)
 *     at        when it was copied (ms)
 *     server    the instance's ORIGIN, so a copy keeps saying where it came from after a move */

const KINDS = new Set(['trainer', 'library']);
const str = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, '').slice(0, n) : '');

export function cleanOrigin(o) {
  if (!o || typeof o !== 'object' || !KINDS.has(o.kind)) return null;
  const id = str(o.id, 64);
  if (!id) return null;
  const out = { kind: o.kind, id, by: str(o.by, 60), at: Number.isFinite(o.at) && o.at > 0 ? Math.floor(o.at) : 0 };
  const sourceId = str(o.sourceId, 64);
  if (sourceId) out.sourceId = sourceId;
  if (Number.isInteger(o.version) && o.version > 0) out.version = o.version;
  const server = str(o.server, 200);
  if (/^https?:\/\/[^\s/]+/i.test(server)) out.server = server;
  return out;
}

/** The origin a copy gets when it is made: `by` and `at` are frozen here. */
export const originFor = ({ kind, id, sourceId, version, by, server, now = Date.now() }) =>
  cleanOrigin({ kind, id, sourceId, version, by, at: now, server });
