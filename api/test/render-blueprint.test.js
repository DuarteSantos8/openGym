/* render.yaml (repo root) is how the hosted Ironvane service runs this server on Render
 * (docs/next/CLOUD-SERVER.md). Nothing else reads it, so a mistake in it shows only as a failed
 * or misconfigured deploy. This holds it to what the server actually is: the image it builds, the
 * route it is health-checked on, the directory its disk is mounted at, and settings the server
 * really reads. It also keeps the project's own addresses and ids out of a public repository:
 * those are typed into Render's dashboard, never committed. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(API, '..');
const read = p => fs.readFileSync(p, 'utf8');

/** The few shapes render.yaml uses, read without a YAML dependency: `key: value` lines of the one
 *  service, and its envVars as { KEY: { value } | { sync: false } }. */
export function readBlueprint(text) {
  const lines = text.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
  const scalars = {}, env = {};
  let inEnv = false, current = null;
  for (const line of lines) {
    const t = line.trim();
    if (t === 'envVars:') { inEnv = true; continue; }
    const kv = /^(-\s+)?([A-Za-z]+):\s*(.*)$/.exec(t);
    if (!kv) continue;
    const [, dash, k, raw] = kv;
    const v = raw.replace(/^["']|["']$/g, '');
    if (inEnv) {
      if (dash && k === 'key') { current = v; env[current] = {}; }
      else if (current && k === 'value') env[current].value = v;
      else if (current && k === 'sync') env[current].sync = v;
      else if (!dash && line.search(/\S/) <= 4) inEnv = false;
    }
    if (!inEnv && raw !== '') scalars[k] = v;
  }
  return { scalars, env };
}

const file = path.join(ROOT, 'render.yaml');
const service = (text, name) => readBlueprint(text.split(/(?=^  - type: )/m)
  .find(part => part.split('\n').includes(`    name: ${name}`)) || '');
const apiService = (text = read(file)) => service(text, 'ironvane-api');

test('the hosted MCP service uses a private upstream and does not mount a disk', () => {
  const { scalars, env } = service(read(file), 'ironvane-mcp');
  assert.equal(scalars.name, 'ironvane-mcp');
  assert.equal(scalars.runtime, 'docker');
  assert.equal(scalars.dockerfilePath, './mcp/Dockerfile');
  assert.equal(scalars.dockerContext, '.');
  assert.equal(scalars.healthCheckPath, '/mcp/health');
  assert.equal(scalars.region, 'virginia');
  assert.equal(scalars.mountPath, undefined);
  assert.equal(env.MCP_PORT.value, '3100');
  assert.equal(env.OPENGYM_API_URL.sync, 'false');
  assert.equal(env.ORIGIN.sync, 'false');
});

test('the blueprint builds the api image from the api directory', () => {
  const { scalars } = apiService();
  assert.equal(scalars.runtime, 'docker');
  assert.ok(fs.existsSync(path.join(ROOT, scalars.dockerfilePath)), 'dockerfilePath exists');
  assert.equal(path.resolve(ROOT, scalars.dockerContext), API);
});

test('it is health-checked on a route the server has', () => {
  const { scalars } = apiService();
  assert.ok(read(path.join(API, 'server.js')).includes(`'GET ${scalars.healthCheckPath}'`));
});

test('the disk is mounted where the server keeps its data, and the port is the one it is told', () => {
  const { scalars, env } = apiService();
  assert.equal(scalars.mountPath, env.DATA_DIR.value);
  assert.match(env.PORT.value, /^\d+$/);
});

test('every setting is one the server reads', () => {
  const { env } = apiService();
  const source = ['server.js', 'oidc/config.js'].map(f => read(path.join(API, f))).join('\n');
  for (const key of Object.keys(env)) assert.ok(new RegExp(`\\benv\\.${key}\\b`).test(source), `${key} is read by the server`);
});

test("the project's own addresses and ids are typed into the dashboard, never committed", () => {
  const text = read(file);
  const { env } = apiService(text);
  for (const key of ['ORIGIN', 'RP_ID', 'OIDC_ISSUER', 'OIDC_CLIENT_ID']) {
    assert.equal(env[key]?.sync, 'false', `${key} is asked for in the dashboard`);
    assert.equal(env[key].value, undefined, `${key} carries no value here`);
  }
  // A placeholder such as <project-ref>.supabase.co is fine in a comment; a real project is not.
  assert.doesNotMatch(text, /[a-z0-9]{20}\.supabase\.co|onrender\.com|vercel\.app|hstgr\.cloud|sb_(publishable|secret)_/);
});

test('sign-up is through the identity provider only', () => {
  const { env } = apiService();
  assert.equal(env.OIDC_ONLY.value, '1');
});

// Anyone can make a hosted account, so "the first profile is the admin" would hand the server to
// whoever signs in first once the address is public. The admin is named by id instead.
test('nobody becomes the admin by arriving first: the admin is named by id, in the dashboard', () => {
  const { env } = apiService();
  assert.equal(env.FIRST_USER_ADMIN, undefined);
  assert.equal(env.ADMIN_UIDS?.sync, 'false');
  assert.equal(env.ADMIN_UIDS.value, undefined);
});
