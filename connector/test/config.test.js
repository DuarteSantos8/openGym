import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import net from 'node:net'
import { spawn, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfig, ConfigError } from '../src/config.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = f => readFileSync(join(root, f), 'utf8')
const key = () => crypto.randomBytes(32).toString('base64')
const good = () => ({
  CONNECTOR_PUBLIC_ORIGIN: 'https://gym.example.test',
  CONNECTOR_PREFIX: '/connector',
  CONNECTOR_ENCRYPTION_KEY: key(),
  CONNECTOR_UPSTREAM_URL: 'http://opengym-web-1',
})
const bad = (over, opts) => assert.throws(() => loadConfig({ ...good(), ...over }, opts), ConfigError)
const without = name => { const e = good(); delete e[name]; return e }

test('valid env yields a normalized config', () => {
  const env = { ...good(), CONNECTOR_PUBLIC_ORIGIN: 'https://gym.example.test/', CONNECTOR_UPSTREAM_URL: 'http://opengym-web-1/' }
  const c = loadConfig(env)
  assert.equal(c.origin, 'https://gym.example.test')
  assert.equal(c.prefix, '/connector')
  assert.equal(c.apiBase, 'http://opengym-web-1')
  assert.ok(Buffer.isBuffer(c.key) && c.key.length === 32)
  assert.equal(c.host, '127.0.0.1')
  assert.equal(c.port, 8787)
})

test('prefix defaults to /connector and must match the server exactly', () => {
  assert.equal(loadConfig(without('CONNECTOR_PREFIX')).prefix, '/connector')
  for (const p of ['/claude', '/connector/', 'connector', '', '/Connector', '/connector/x']) bad({ CONNECTOR_PREFIX: p })
})

test('public origin is required, HTTPS and a bare origin', () => {
  assert.throws(() => loadConfig(without('CONNECTOR_PUBLIC_ORIGIN')), ConfigError)
  for (const o of ['', 'gym.example.test', 'http://gym.example.test', 'ftp://gym.example.test', 'javascript:alert(1)', 'file:///etc/passwd',
    'https://gym.example.test/connector', 'https://gym.example.test/?x=1', 'https://gym.example.test/#x', 'https://u:p@gym.example.test']) bad({ CONNECTOR_PUBLIC_ORIGIN: o })
})

test('plain http origin is allowed only with the explicit test option', () => {
  const env = { ...good(), CONNECTOR_PUBLIC_ORIGIN: 'http://127.0.0.1:4000' }
  assert.throws(() => loadConfig(env), ConfigError)
  assert.equal(loadConfig(env, { test: true }).origin, 'http://127.0.0.1:4000')
  bad({ CONNECTOR_PUBLIC_ORIGIN: 'javascript:alert(1)' }, { test: true })
})

test('encryption key must be exactly 32 random bytes, base64', () => {
  assert.throws(() => loadConfig(without('CONNECTOR_ENCRYPTION_KEY')), ConfigError)
  const k = crypto.randomBytes(32)
  assert.equal(loadConfig({ ...good(), CONNECTOR_ENCRYPTION_KEY: k.toString('base64url') }).key.equals(k), true)
  for (const v of [
    '', 'short', 'change-me', 'changeme', 'default', 'secret', '<paste output of: openssl rand -base64 32>',
    crypto.randomBytes(16).toString('base64'), crypto.randomBytes(31).toString('base64'), crypto.randomBytes(33).toString('base64'),
    crypto.randomBytes(32).toString('hex'), // right entropy, wrong encoding: ambiguous, so refused
    Buffer.alloc(32).toString('base64'), Buffer.alloc(32, 0x41).toString('base64'),
    ` ${k.toString('base64')}`, `${k.toString('base64')}=`, k.toString('base64').replace(/.$/, 'A'), 'a'.repeat(43) + '=',
  ]) bad({ CONNECTOR_ENCRYPTION_KEY: v })
})

test('upstream URL is required, http(s) only, a bare origin, no credentials', () => {
  assert.throws(() => loadConfig(without('CONNECTOR_UPSTREAM_URL')), ConfigError)
  assert.equal(loadConfig({ ...good(), CONNECTOR_UPSTREAM_URL: 'https://opengym.internal:8443' }).apiBase, 'https://opengym.internal:8443')
  for (const u of ['', 'opengym-web-1', 'file:///srv/data', 'javascript:alert(1)', 'ftp://opengym-web-1', 'data:text/plain,x',
    'http://user:pw@opengym-web-1', 'http://opengym-web-1/api', 'http://opengym-web-1/?a=b', 'http://opengym-web-1/#x']) bad({ CONNECTOR_UPSTREAM_URL: u })
})

test('the test option relaxes only the origin scheme, never key or upstream', () => {
  bad({ CONNECTOR_ENCRYPTION_KEY: 'change-me' }, { test: true })
  bad({ CONNECTOR_UPSTREAM_URL: 'file:///x' }, { test: true })
  assert.throws(() => loadConfig(without('CONNECTOR_UPSTREAM_URL'), { test: true }), ConfigError)
  assert.throws(() => loadConfig(without('CONNECTOR_ENCRYPTION_KEY'), { test: true }), ConfigError)
})

test('host and port are validated', () => {
  assert.equal(loadConfig({ ...good(), CONNECTOR_HOST: '0.0.0.0', CONNECTOR_PORT: '9000' }).port, 9000)
  for (const p of ['0', '-1', '65536', '80.5', 'abc', '']) bad({ CONNECTOR_PORT: p })
  bad({ CONNECTOR_HOST: '' })
})

test('errors name the variable and never echo secret values', () => {
  const secret = 'hunter2-sentinel'
  const env = {
    CONNECTOR_PUBLIC_ORIGIN: `https://admin:${secret}@gym.example.test`,
    CONNECTOR_PREFIX: `/${secret}`,
    CONNECTOR_ENCRYPTION_KEY: secret,
    CONNECTOR_UPSTREAM_URL: `http://svc:${secret}@opengym-web-1/${secret}?t=${secret}`,
  }
  let err
  try { loadConfig(env) } catch (e) { err = e }
  assert.ok(err instanceof ConfigError)
  for (const name of Object.keys(env)) assert.match(err.message, new RegExp(name), `${name} reported`)
  assert.equal(err.message.includes(secret), false)
  assert.equal(JSON.stringify(err, Object.getOwnPropertyNames(err)).includes(secret), false)
})

test('loadConfig reads only the env it is given', () => {
  const saved = process.env.CONNECTOR_ENCRYPTION_KEY
  process.env.CONNECTOR_ENCRYPTION_KEY = key()
  try { assert.throws(() => loadConfig({}), ConfigError) } finally {
    if (saved === undefined) delete process.env.CONNECTOR_ENCRYPTION_KEY; else process.env.CONNECTOR_ENCRYPTION_KEY = saved
  }
})

// --- Packaging contract: static checks, no Docker needed. ---

test('package has no runtime dependencies, so the image installs none', () => {
  const pkg = JSON.parse(read('package.json'))
  for (const f of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) assert.equal(pkg[f], undefined, f)
  assert.equal(pkg.license, 'AGPL-3.0-or-later')
})

test('Dockerfile: node:22-alpine, non-root, no data volume, no installs, no baked secrets', () => {
  const d = read('Dockerfile')
  assert.match(d, /^FROM node:22-alpine\b/m)
  assert.match(d, /^USER node$/m)
  assert.match(d, /^CMD \["node", "src\/main\.js"\]$/m)
  assert.match(d, /org\.opencontainers\.image\.licenses="AGPL-3\.0-or-later"/)
  assert.doesNotMatch(d, /^\s*VOLUME\b/m)
  assert.doesNotMatch(d, /\bnpm (ci|i|install)\b/)
  assert.doesNotMatch(d, /^COPY\s+\.\s/m)
  assert.doesNotMatch(d, /ENCRYPTION_KEY\s*=/)
  assert.doesNotMatch(d, /^USER\s+(root|0)\b/m)
})

test('compose: loopback-only publish, external openGym network, no mounts, no baked key', () => {
  const c = read('compose.yaml')
  const ports = [...c.matchAll(/^\s+-\s+["']?(\S+?:\d*\S*?)["']?\s*$/gm)].map(m => m[1]).filter(p => /^[^$]*\d+:\d+|:\d+$/.test(p) && !p.startsWith('CONNECTOR_'))
  assert.ok(ports.length >= 1)
  for (const p of ports) assert.match(p, /^127\.0\.0\.1:/, `port ${p}`)
  assert.doesNotMatch(c, /0\.0\.0\.0/)
  assert.doesNotMatch(c, /^\s*volumes:/m)
  assert.doesNotMatch(c, /^\s*(privileged|network_mode|env_file):/m)
  assert.match(c, /external:\s*true/)
  assert.match(c, /opengym_default/)
  assert.match(c, /CONNECTOR_ENCRYPTION_KEY:\s*\$\{CONNECTOR_ENCRYPTION_KEY:\?/)
  assert.match(c, /http:\/\/opengym-web-1/)
})

test('docs and compose carry no usable key; documented placeholders are rejected by the validator', () => {
  for (const f of ['README.md', 'compose.yaml', 'Dockerfile']) {
    const t = read(f)
    assert.equal(/[A-Za-z0-9+/_-]{43}=?/.test(t.replace(/https?:\/\/\S+/g, '')), false, `${f} has a key-shaped token`)
    for (const m of t.matchAll(/CONNECTOR_ENCRYPTION_KEY=(\S*)/g)) bad({ CONNECTOR_ENCRYPTION_KEY: m[1] })
  }
})

test('README documents the contract and is explicit that nothing is deployed', () => {
  const r = read('README.md')
  for (const v of ['CONNECTOR_PUBLIC_ORIGIN', 'CONNECTOR_PREFIX', 'CONNECTOR_ENCRYPTION_KEY', 'CONNECTOR_UPSTREAM_URL', 'CONNECTOR_HOST', 'CONNECTOR_PORT', 'CONNECTOR_BIND_PORT', 'OPENGYM_NETWORK']) assert.match(r, new RegExp(v), v)
  assert.match(r, /127\.0\.0\.1/)
  assert.match(r, /Cloudflare/)
  assert.match(r, /Settings.*Connectors/s)
  assert.match(r, /public deployment is \*\*not\*\* performed/i)
  assert.match(r, /AGPL-3\.0-or-later/)
})

// --- Entrypoint ---

const freePort = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => r(port)) }) })
const run = { cwd: root, encoding: 'utf8' }

test('main.js refuses to start on bad config, exits 1, prints no secret', () => {
  const secret = 'hunter2-sentinel'
  const r = spawnSync(process.execPath, ['src/main.js'], {
    ...run, env: { PATH: process.env.PATH, CONNECTOR_PUBLIC_ORIGIN: 'http://gym.example.test', CONNECTOR_ENCRYPTION_KEY: secret, CONNECTOR_UPSTREAM_URL: `http://u:${secret}@opengym-web-1` },
  })
  assert.equal(r.status, 1)
  assert.match(r.stderr, /CONNECTOR_ENCRYPTION_KEY/)
  assert.equal((r.stdout + r.stderr).includes(secret), false)
})

test('main.js starts on loopback by default and serves discovery for the configured origin', async () => {
  const port = await freePort()
  const child = spawn(process.execPath, ['src/main.js'], { cwd: root, env: { PATH: process.env.PATH, ...good(), CONNECTOR_PORT: String(port) } })
  try {
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('no start')), 5000)
      child.stdout.on('data', d => { if (String(d).includes('listening')) { clearTimeout(t); resolve() } })
      child.on('exit', c => reject(new Error(`exit ${c}`)))
    })
    const res = await fetch(`http://127.0.0.1:${port}/connector/.well-known/oauth-protected-resource`)
    assert.equal((await res.json()).resource, 'https://gym.example.test/connector/mcp')
  } finally { child.kill() }
})
