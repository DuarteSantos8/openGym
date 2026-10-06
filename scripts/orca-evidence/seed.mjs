/* Seed the throwaway instance that scripts/orca-evidence/capture.py screenshots.
 *
 * Runs the repository's own config module against a temporary DATA_DIR, so the encrypted
 * credential blob and the coach.json the server will read are produced by the same code the
 * server uses — no fixture invented for the screenshot. The key arrives in the environment and
 * is never printed; only the signed session token comes back on stdout.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const repo = process.argv[2];
const data = process.env.DATA_DIR;
if (!repo || !data) {
  console.error('usage: DATA_DIR=… node scripts/orca-evidence/seed.mjs <repo-root>');
  process.exit(2);
}
fs.mkdirSync(data, { recursive: true });

/* server.js generates ./data/secret on first boot and coach/config.js only reads it, so the
   same file has to exist here for both processes to share one HMAC key. */
const secretFile = path.join(data, 'secret');
if (!fs.existsSync(secretFile)) {
  fs.writeFileSync(secretFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
}

const cfg = await import(path.join(repo, 'api/coach/config.js'));

fs.writeFileSync(path.join(data, 'db.json'), JSON.stringify({
  users: [{ id: 'admin-1', name: 'Admin', admin: true }], creds: [], subs: [], invites: []
}, null, 2), { mode: 0o600 });

cfg.reset();
cfg.save({ enabled: true, provider: 'orcarouter', auth: {}, models: {}, providerOptions: {}, boundUid: {} });
cfg.saveAuth('orcarouter', {
  type: 'apikey',
  account: null,
  data: cfg.encrypt({ token: process.env.ORCAROUTER_API_KEY }),
  connectedAt: new Date().toISOString()
});
// A model the live catalog serves, so the picker opens on a real value rather than an empty
// selection. The capture asserts against whatever the catalog returns at run time.
cfg.saveModel('orcarouter', 'orcarouter/free');

const secret = fs.readFileSync(secretFile, 'utf8').trim();
const payload = 'admin-1:' + (Date.now() + 86400000) + ':0';
const mac = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
process.stdout.write(payload + '.' + mac);
