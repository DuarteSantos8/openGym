/* Adapted from alexpcosta/opengym's ChatGPT device-login integration (678bf5b).
 * Codex owns the OAuth exchange and refresh cache. Only its device URL/code may reach the
 * browser; raw output, account credentials and provider errors never cross this boundary. */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as cfg from './config.js';
import { canDropPrivileges, unprivilegedIds, run } from './adapters/spawn.js';

const FILE_STORE = 'cli_auth_credentials_store="file"';
const DEVICE_URL = 'https://auth.openai.com/codex/device';
const pending = a => a && ['starting', 'pending'].includes(a.state);
const error = (message, status = 409) => Object.assign(new Error(message), { status });

export function parseDeviceInstructions(output) {
  const text = String(output).replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
  // Exact provider-owned endpoint, not an arbitrary link copied from child output.
  const url = /https:\/\/auth\.openai\.com\/codex\/device(?=[\s\x1b]|$)/.test(text);
  const code = text.match(/(?:^|\s)([A-Z0-9]{4,5}-[A-Z0-9]{4,5})(?=\s|$)/)?.[1];
  return url && code ? { verificationUrl: DEVICE_URL, userCode: code } : null;
}

export function createCodexLogin({ spawnProcess = spawn, runProcess = run, timeoutMs = 10 * 60000, killAfterMs = 2000 } = {}) {
  let attempt = null;
  let disconnecting = false;
  const env = () => ({ PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', HOME: cfg.CREDENTIAL_HOME, CODEX_HOME: cfg.CREDENTIAL_HOME, TMPDIR: '/tmp' });
  const clearCache = () => {
    try { fs.unlinkSync(cfg.codexAuthFile()); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  };
  const view = uid => {
    if (attempt && attempt.uid !== uid) throw error('another administrator owns this sign-in');
    if (!attempt) return { state: 'idle' };
    return { id: attempt.id, state: attempt.state, ...(pending(attempt) ? attempt.instructions : {}), ...(attempt.error ? { error: attempt.error } : {}) };
  };
  const terminate = async a => {
    if (!a.child || a.closed) return;
    await new Promise(resolve => {
      let timer;
      const finish = () => { clearTimeout(timer); resolve(); };
      a.child.once('close', finish);
      timer = setTimeout(() => {
        // The lock stays held until close; never start a second writer while this one lives.
        a.child.kill('SIGKILL');
      }, killAfterMs);
      a.child.kill('SIGTERM');
    });
  };
  const abort = async (state, message) => {
    const a = attempt;
    if (!pending(a)) return;
    a.state = 'stopping';
    clearTimeout(a.timer);
    await terminate(a);
    clearCache();
    a.state = state;
    a.error = message;
    a.output = '';
    a.instructions = null;
  };
  return {
    status: view,
    active: () => pending(attempt) || attempt?.state === 'stopping' || disconnecting,
    async cancel(uid, id) {
      if (!attempt) return { state: 'idle' };
      if (attempt.uid !== uid || attempt.id !== id) throw error('sign-in does not belong to this request');
      await abort('cancelled', null);
      return view(uid);
    },
    async stop() { await abort('cancelled', null); },
    start(uid) {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(String(uid || ''))) throw error('invalid profile', 400);
      if (disconnecting || attempt?.state === 'stopping') throw error('sign-in is stopping; try again shortly');
      if (pending(attempt)) return view(uid);
      const c = cfg.load();
      if (!c.enabled || cfg.COACH_DISABLED || c.provider !== 'codex' || c.authMode !== 'instance') throw error('enable Codex in instance mode before signing in', 400);
      if (cfg.authFor(c)) throw error('remove the saved Codex credential before signing in');
      if (!canDropPrivileges().ok) throw error('the Coach runtime cannot drop privileges', 503);
      // A crash may leave an unclaimed cache. It must never silently grant access to a profile.
      clearCache();
      fs.mkdirSync(cfg.CREDENTIAL_HOME, { recursive: true, mode: 0o700 });
      const ids = unprivilegedIds();
      if (ids) fs.chownSync(cfg.CREDENTIAL_HOME, ids.uid, ids.gid);
      fs.chmodSync(cfg.CREDENTIAL_HOME, 0o700);
      const a = { id: crypto.randomUUID(), uid, state: 'starting', output: '', instructions: null, closed: false };
      attempt = a;
      const fail = message => {
        clearTimeout(a.timer); a.state = 'failed'; a.error = message; a.output = ''; a.instructions = null;
        try { clearCache(); } catch { a.error = 'The server could not clear the sign-in cache. Check its permissions.'; }
      };
      try {
        a.child = spawnProcess('codex', ['login', '--device-auth', '-c', FILE_STORE], {
          cwd: cfg.CREDENTIAL_HOME, env: env(), stdio: ['ignore', 'pipe', 'pipe'], ...(ids || {})
        });
        const append = chunk => {
          if (!pending(a)) return;
          a.output = (a.output + chunk.toString()).slice(-8192);
          a.instructions = parseDeviceInstructions(a.output);
          if (a.instructions) a.state = 'pending';
        };
        a.child.stdout.on('data', append);
        a.child.stderr.on('data', append);
        a.child.on('error', () => { if (pending(a)) fail('Codex could not start. Build the API coach target and try again.'); });
        a.child.on('close', code => {
          a.closed = true;
          if (!pending(a)) return;
          clearTimeout(a.timer);
          const current = cfg.load();
          if (code !== 0 || !cfg.hasCodexAuth() || current.provider !== 'codex' || current.authMode !== 'instance' || !current.enabled || cfg.authFor(current)) {
            fail('ChatGPT sign-in did not complete. Check device-code login in ChatGPT security settings, then try again.');
            return;
          }
          try {
            // No token in coach.json: metadata plus a binding to the initiating profile only.
            cfg.save({ auth: { ...current.auth, codex: { type: 'chatgpt-cli', ownerUid: uid, connectedAt: new Date().toISOString() } }, boundUid: { ...current.boundUid, codex: uid } });
            a.state = 'connected'; a.output = ''; a.instructions = null;
          } catch { fail('The server could not save the ChatGPT connection. Try again.'); }
        });
        a.timer = setTimeout(() => { abort('expired', 'ChatGPT sign-in timed out. Start a new sign-in.').catch(() => { a.state = 'failed'; a.error = 'The server could not clear the sign-in cache.'; }); }, timeoutMs);
        a.timer.unref?.();
      } catch { fail('Codex could not start. Build the API coach target and try again.'); }
      return view(uid);
    },
    async disconnect() {
      if (disconnecting) throw error('sign-out is already running');
      disconnecting = true;
      try {
        await abort('cancelled', null);
        if (cfg.hasCodexAuth()) await runProcess('codex', ['logout', '-c', FILE_STORE], { env: env(), cwd: cfg.CREDENTIAL_HOME, timeoutMs: 20000 });
        clearCache();
        cfg.saveAuth('codex', null);
        attempt = null;
      } finally { disconnecting = false; }
    }
  };
}

export const codexLogin = createCodexLogin();
