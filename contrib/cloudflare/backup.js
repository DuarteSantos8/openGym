// A daily copy of the D1 `files` table in R2 (backups/YYYY-MM-DD.json), kept 30 days. D1 Time
// Travel already rewinds the last 30 days; this copy also survives a deleted database and can be
// downloaded. Uploads are in R2 already and are not copied.
// Restore: node contrib/cloudflare/backup.js <backup.json> <restore.sql> (README "Back up").
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const KEEP_DAYS = 30;
// D1 refuses a statement over 100 KB, so a restore writes bodies as hex in rows of at most CHUNK
// bytes, named "<path>#part<n>" the way worker.js stores large files.
const CHUNK = 40_000;
const SEP = '#part';

export async function backup(env, when) {
  const day = when.toISOString().slice(0, 10);
  const { results } = await env.DB.prepare('SELECT path, body FROM files ORDER BY path').all();
  const files = Object.fromEntries(results.map(r => [r.path, Buffer.from(r.body).toString('base64')]));
  await env.MEDIA.put(`backups/${day}.json`, JSON.stringify(files), { httpMetadata: { contentType: 'application/json' } });
  const cut = new Date(when.getTime() - KEEP_DAYS * 864e5).toISOString().slice(0, 10);
  const { objects } = await env.MEDIA.list({ prefix: 'backups/' });
  await Promise.all(objects.filter(o => o.key.slice(8, 18) < cut).map(o => env.MEDIA.delete(o.key)));
}

// A backup file back into SQL for `wrangler d1 execute --file`. Parts of a large file are joined
// first, then cut again into rows small enough for one statement.
export function restoreSql(files) {
  const whole = new Map();
  for (const [p, b64] of Object.entries(files)) {
    const at = p.lastIndexOf(SEP);
    const rel = at < 0 ? p : p.slice(0, at);
    if (!whole.has(rel)) whole.set(rel, []);
    whole.get(rel)[at < 0 ? 0 : Number(p.slice(at + SEP.length))] = Buffer.from(b64, 'base64');
  }
  const q = s => "'" + s.replace(/'/g, "''") + "'";
  const out = ['DELETE FROM files;'];
  for (const [rel, list] of whole) {
    const body = Buffer.concat(list);
    const row = (p, buf) => `INSERT INTO files (path, body) VALUES (${q(p)}, X'${buf.toString('hex')}');`;
    if (body.length <= CHUNK) out.push(row(rel, body));
    else for (let i = 0; i * CHUNK < body.length; i++) out.push(row(rel + SEP + i, body.subarray(i * CHUNK, (i + 1) * CHUNK)));
  }
  return out.join('\n') + '\n';
}

if (process.argv?.[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  fs.writeFileSync(process.argv[3], restoreSql(JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))));
}
