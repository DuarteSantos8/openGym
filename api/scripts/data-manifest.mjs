// A manifest of an API data directory (DATA_DIR): a SHA-256 and size per file, and how many
// records the server keeps. Used to prove a backup, restore or migration carried every byte
// (docs/deployment/DATA_MIGRATION.md). Holds no names or record contents, but file paths carry
// account ids (state-<id>.json, uploads/<id>/), so a manifest and a --compare result are as
// private as the archive they describe. Quote only the counts and `equal` in a report.
//
//   node api/scripts/data-manifest.mjs /data > manifest.json
//   node api/scripts/data-manifest.mjs --compare a.json b.json
//     exit 0 equal, 1 they differ, 2 could not tell (missing file, unreadable directory, usage)
//
// Dependency-free on purpose: it can be piped into a running container with
// `node --input-type=module - /data < data-manifest.mjs`, where only node exists.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// What the server writes and removes on its own: durable.js's `<file>.tmp` before each rename,
// the write probe /api/health makes, and uploads still in flight (media.js: uploads/<id>/.tmp/).
// Never data, and never the same twice.
const TRANSIENT = name => /\.tmp(-\d+)?$/.test(name) || name.startsWith('.health-');
const TRANSIENT_DIR = name => name === '.tmp';

function walk(root, rel = '') {
  const out = [];
  for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) { if (!TRANSIENT_DIR(e.name)) out.push(...walk(root, p)); }
    else if (e.isFile() && !TRANSIENT(e.name)) out.push(p);
  }
  return out;
}

const len = v => (Array.isArray(v) ? v.length : 0);

export function dataManifest(dir) {
  const files = walk(dir).map(p => {
    const buf = fs.readFileSync(path.join(dir, p));
    return { path: p, size: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex') };
  });
  let db = null;
  try { db = JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8')); } catch { db = null; }
  const dbReadable = !!db && typeof db === 'object' && !Array.isArray(db);
  const top = files.filter(f => !f.path.includes('/'));
  return {
    dbReadable,
    counts: {
      users: dbReadable ? len(db.users) : null,
      creds: dbReadable ? len(db.creds) : null,
      subs: dbReadable ? len(db.subs) : null,
      invites: dbReadable ? len(db.invites) : null,
      stateFiles: top.filter(f => /^state-.+\.json$/.test(f.path)).length,
      watchFiles: top.filter(f => /^watch-.+\.json$/.test(f.path)).length,
      uploadFiles: files.filter(f => f.path.startsWith('uploads/')).length,
      files: files.length,
    },
    files,
  };
}

export function compareManifests(a, b) {
  const A = new Map(a.files.map(f => [f.path, f.sha256]));
  const B = new Map(b.files.map(f => [f.path, f.sha256]));
  const changed = [...A].filter(([p, h]) => B.has(p) && B.get(p) !== h).map(([p]) => p);
  const missing = [...A.keys()].filter(p => !B.has(p));
  const extra = [...B.keys()].filter(p => !A.has(p));
  return { equal: !changed.length && !missing.length && !extra.length, changed, missing, extra };
}

const invoked = process.argv[1] && (process.argv[1] === '-' || import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href);
if (invoked || process.argv[1] === undefined) {
  const args = process.argv.slice(process.argv[1] === undefined ? 1 : 2);
  const usage = 'usage: data-manifest.mjs <data-dir> | --compare <a.json> <b.json>';
  try {
    if (args[0] === '--compare') {
      if (args.length !== 3) throw new Error(usage);
      const r = compareManifests(...args.slice(1, 3).map(f => JSON.parse(fs.readFileSync(f, 'utf8'))));
      console.log(JSON.stringify(r, null, 2));
      process.exitCode = r.equal ? 0 : 1;
    } else if (args.length === 1) {
      console.log(JSON.stringify(dataManifest(args[0]), null, 2));
    } else {
      throw new Error(usage);
    }
  } catch (e) {
    console.error(e.message);
    process.exitCode = 2;
  }
}
