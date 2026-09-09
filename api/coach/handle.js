/* The stable per-profile pseudonym a payload carries instead of the uid: never the uid, never
 * reversible, the same across jobs. Keyed on the instance secret so two instances never mint
 * the same handle for the same uid. Node-only — the phone mints its own random handle. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DATA = process.env.DATA_DIR || '/data';

export const HANDLE_LENGTH = 16;

export function handleFor(uid) {
  const secret = fs.readFileSync(path.join(DATA, 'secret'), 'utf8').trim();
  return crypto.createHmac('sha256', secret).update('coach-handle:' + uid).digest('base64url').slice(0, HANDLE_LENGTH);
}
