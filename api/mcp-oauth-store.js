import crypto from 'node:crypto';
import fs from 'node:fs';
import { atomicWrite } from './durable.js';

const MaxRecords = 10000;
const RenameAttempts = 5;
const RenameRetryMilliseconds = 25;
// shortcut: one Node writer; use a transactional shared adapter before scaling API replicas.

/** Single Node writer. Persist OAuth artifacts separately, encrypted with a domain-separated key.
 * Loss/corruption fails closed; do not recreate this file after a failed restore. */
export function createOAuthStore(file, secret, active = () => true) {
  const key = crypto.createHmac('sha256', secret).update('opengym-oauth-store-v1').digest();
  let rows = new Map();
  try {
    const document = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (document.version !== 1) throw new Error('unsupported OAuth store');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(document.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(document.tag, 'base64'));
    const entries = JSON.parse(Buffer.concat([decipher.update(Buffer.from(document.data, 'base64')), decipher.final()]).toString('utf8'));
    if (!Array.isArray(entries) || entries.length > MaxRecords || entries.some(row =>
      !Array.isArray(row) || typeof row[0] !== 'string' || !row[1]?.payload || !Number.isFinite(row[1].expiresAt)))
      throw new Error('invalid OAuth records');
    rows = new Map(entries);
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('OAuth store unreadable; restore it with the matching data/secret', { cause: error });
  }
  const index = (model, id) => `${model}:${crypto.createHash('sha256').update(String(id)).digest('hex')}`;
  let durableRows = new Map(rows);
  const sweep = () => { for (const [id, row] of rows) if (row.expiresAt <= Date.now()) rows.delete(id); };
  const save = () => {
    sweep();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const data = Buffer.concat([cipher.update(JSON.stringify([...rows])), cipher.final()]);
    try {
      const document = JSON.stringify({ version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') });
      for (let attempt = 0; attempt < RenameAttempts; attempt++) {
        try { atomicWrite(file, document, 0o600); break; }
        catch (error) {
          if (error.syscall !== 'rename' || !['EPERM', 'EBUSY'].includes(error.code) || attempt === RenameAttempts - 1) throw error;
          // Windows scanners can briefly lock the destination. Stay synchronous to preserve single-writer ordering.
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, RenameRetryMilliseconds);
        }
      }
      durableRows = new Map(rows);
    } catch (error) {
      rows = new Map(durableRows);
      throw error;
    }
  };
  const get = (model, id) => {
    const row = rows.get(index(model, id));
    return row && row.expiresAt > Date.now() ? structuredClone(row.payload) : undefined;
  };
  const set = (model, id, payload, seconds = 30 * 86400) => {
    sweep();
    if (rows.size >= MaxRecords && !rows.has(index(model, id))) throw new Error('OAuth storage capacity exceeded');
    rows.set(index(model, id), { payload: structuredClone(payload), expiresAt: Date.now() + seconds * 1000 });
    save();
  };
  const remove = (model, id) => { rows.delete(index(model, id)); save(); };
  const revoke = grantId => {
    for (const [id, row] of rows) if (row.payload.grantId === grantId) rows.delete(id);
    rows.delete(index('Grant', grantId));
    rows.delete(index('OpenGymGrant', grantId));
    save();
  };
  class Adapter {
    constructor(model) { this.model = model; }
    async upsert(id, payload, expiresIn) { set(this.model, id, payload, expiresIn); }
    async find(id) {
      const payload = get(this.model, id);
      const grantId = this.model === 'Grant' ? id : payload?.grantId;
      const binding = grantId && get('OpenGymGrant', grantId);
      return binding && !active(binding) ? undefined : payload;
    }
    async findByUid(uid) { return this.findBy('uid', uid); }
    async findByUserCode(code) { return this.findBy('userCode', code); }
    async findBy(field, value) {
      for (const [id, row] of rows) if (id.startsWith(this.model + ':') && row.expiresAt > Date.now() && row.payload[field] === value)
        return structuredClone(row.payload);
    }
    async consume(id) {
      const payload = get(this.model, id);
      if (payload) set(this.model, id, { ...payload, consumed: Math.floor(Date.now() / 1000) },
        Math.max(1, (rows.get(index(this.model, id)).expiresAt - Date.now()) / 1000));
    }
    async destroy(id) { this.model === 'Grant' ? revoke(id) : remove(this.model, id); }
    async revokeByGrantId(id) { revoke(id); }
  }
  return { Adapter, get, set, remove, revoke, list: model => [...rows]
    .filter(([id, row]) => id.startsWith(model + ':') && row.expiresAt > Date.now())
    .map(([, row]) => structuredClone(row.payload)) };
}
