import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { tempData } from './helpers.mjs';

tempData();
process.env.COACH_CREDENTIAL_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-auth-test-'));
const cfg = await import('../coach/config.js');
const { forcePrivilegeVerdict } = await import('../coach/adapters/spawn.js');
const { createCodexLogin, parseDeviceInstructions } = await import('../coach/codex-login.js');
const { coachRoutes } = await import('../coach/routes.js');
const { testRun } = await import('../coach/jobs.js');
afterEach(() => { fs.rmSync(cfg.codexAuthFile(), { force: true }); cfg.save({ provider: 'fixture', auth: {}, boundUid: {} }); forcePrivilegeVerdict(null); });

function setup(opts = {}) {
  cfg.save({ enabled: true, provider: 'codex', authMode: 'instance', auth: {}, boundUid: {} });
  forcePrivilegeVerdict({ ok: true, dropped: false });
  const child = new EventEmitter();
  child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
  child.kill = signal => { child.signals.push(signal); queueMicrotask(() => child.emit('close', null)); };
  child.signals = [];
  let calls = [];
  const controller = createCodexLogin({ spawnProcess: (...args) => { calls.push(args); return child; }, runProcess: async () => ({ code: 0 }), ...opts });
  const complete = () => { fs.writeFileSync(cfg.codexAuthFile(), 'private-refreshable-credential'); child.emit('close', 0); };
  return { controller, child, calls, complete };
}

test('only an exact OpenAI verification URL and bounded device code leave the parser', () => {
  const sample = '\x1b[1mhttps://auth.openai.com/codex/device\x1b[0m\nABCD-EFGHI\nsecret eyJfake.fake.fake';
  assert.deepEqual(parseDeviceInstructions(sample), { verificationUrl: 'https://auth.openai.com/codex/device', userCode: 'ABCD-EFGHI' });
  assert.equal(parseDeviceInstructions('https://evil.example ABCD-EFGHI'), null);
  assert.equal(parseDeviceInstructions('https://auth.openai.com/codex/device.evil ABCD-EFGHI'), null);
  assert.equal(parseDeviceInstructions('https://auth.openai.com/codex/device?evil ABCD-EFGHI'), null);
});

test('device login uses isolated environment, one process, owner-only polling and cancellation', async () => {
  const { controller:c, calls, child } = setup();
  const a = c.start('owner');
  assert.equal(c.start('owner').id, a.id);
  assert.equal(calls.length, 1);
  assert.throws(() => c.start('other'), /administrator/);
  assert.throws(() => c.status('other'), /administrator/);
  await assert.rejects(c.cancel('other', a.id), /belong/);
  await assert.rejects(c.cancel('owner', 'stale-attempt'), /belong/);
  assert.deepEqual(calls[0][1], ['login', '--device-auth', '-c', 'cli_auth_credentials_store="file"']);
  assert.deepEqual(Object.keys(calls[0][2].env).sort(), ['CODEX_HOME','HOME','PATH','TMPDIR']);
  child.stdout.emit('data', 'https://auth.openai.com/codex/de');
  child.stdout.emit('data', 'vice\nABCD-EFGHI\npassword-secret');
  assert.equal(c.status('owner').userCode, 'ABCD-EFGHI');
  assert.doesNotMatch(JSON.stringify(c.status('owner')), /password-secret/);
  assert.equal((await c.cancel('owner',a.id)).state, 'cancelled');
  assert.equal(child.signals[0], 'SIGTERM');
});

test('success records metadata only, binds the initiating profile, survives config reload and never shares subscription', async () => {
  const { controller:c, complete } = setup();
  c.start('owner'); complete();
  assert.equal(c.status('owner').state, 'connected');
  cfg.reset();
  assert.equal(cfg.isConnected(), true);
  assert.equal(cfg.credentialFor('owner').type, 'chatgpt-cli');
  assert.equal(cfg.credentialFor('other').ok, false);
  assert.equal(cfg.credentialFor(null).ok, false);
  assert.equal(cfg.boundUidFor(), 'owner');
  assert.equal(cfg.authFor().data, undefined);
  assert.doesNotMatch(JSON.stringify(cfg.authFor()), /private-refreshable/);
  assert.equal(cfg.jobEnv('/tmp/job',cfg.credentialFor('owner')).CODEX_HOME,cfg.CREDENTIAL_HOME);
  assert.equal(cfg.jobEnv('/tmp/job',{ ok:true,type:'apikey',auth:{token:'key'} }).CODEX_HOME,'/tmp/job');
  assert.equal(cfg.jobEnv('/tmp/job',{ ok:true,type:'apikey',auth:{token:'key'} }).CODEX_API_KEY,'key');
  assert.equal((await testRun('other')).ok,false);
  await c.disconnect();
  assert.equal(cfg.hasCodexAuth(), false);
  assert.equal(cfg.authFor(), null);
});

test('failure and timeout never return raw provider output, and clear an unclaimed cache', async () => {
  let s = setup(); s.controller.start('owner');
  s.child.stderr.emit('data','oauth-token-or-provider-secret'); s.child.emit('close',1);
  assert.equal(s.controller.status('owner').state,'failed');
  assert.doesNotMatch(JSON.stringify(s.controller.status('owner')), /oauth-token-or-provider-secret/);
  s = setup({ timeoutMs: 15 }); s.controller.start('owner');
  fs.writeFileSync(cfg.codexAuthFile(),'unclaimed');
  await new Promise(r=>setTimeout(r,40));
  assert.equal(s.controller.status('owner').state,'expired');
  assert.equal(cfg.hasCodexAuth(),false);
});

test('missing runtime, disabled feature and privilege failure are explicit; API keys cannot be replaced implicitly', async () => {
  let s=setup(); forcePrivilegeVerdict({ok:false}); assert.throws(()=>s.controller.start('owner'),/privileges/);
  forcePrivilegeVerdict({ok:true}); cfg.save({enabled:false}); assert.throws(()=>s.controller.start('owner'),/enable/);
  s=setup(); cfg.saveAuth('codex',{type:'apikey',data:cfg.encrypt({token:'existing-key'})});
  assert.throws(()=>s.controller.start('owner'),/remove/);
  assert.equal(s.calls.length,0);
  s=setup(); s.controller.start('owner'); s.child.emit('error',new Error('private-path-or-secret'));
  assert.equal(s.controller.status('owner').state,'failed');
  assert.doesNotMatch(JSON.stringify(s.controller.status('owner')),/private-path-or-secret/);
});

test('provider changes during login cannot attach credentials to a new configuration', () => {
  const {controller:c,complete}=setup(); c.start('owner'); cfg.save({provider:'fixture'}); complete();
  assert.equal(c.status('owner').state,'failed'); assert.equal(cfg.hasCodexAuth(),false); assert.equal(cfg.authFor(cfg.load(),'codex'),null);
});

test('all new HTTP endpoints refuse unauthenticated and non-admin callers before touching the runtime', async () => {
  for(const status of [401,403]) {
    let output;
    const routes=coachRoutes({json:(_r,s,b)=>{output={status:s,body:b}},readBody:async()=>{throw Error('must not read body')},readSession:()=>null,requireAdmin:(_q,r)=>{output={status};return null}});
    for(const key of ['POST /api/admin/coach/auth/chatgpt/device','GET /api/admin/coach/auth/chatgpt/status','POST /api/admin/coach/auth/chatgpt/cancel']) {
      await routes[key]({},{}); assert.equal(output.status,status);
    }
  }
});
