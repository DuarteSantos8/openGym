/* Running a provider CLI as a child process, with the blast radius kept small.
 *
 * Three things matter here and none of them are about convenience:
 *   · no shell, ever — argv is an array, and the user's free text never reaches it anyway
 *     (it travels inside the payload file, as JSON data)
 *   · the environment is built from nothing rather than inherited, so the child cannot read
 *     RP_ID, ADMIN_UIDS, VAPID keys or anything else this process holds
 *   · the child runs as an unprivileged user (created in the Dockerfile) whose uid cannot
 *     read ./data, so a CLI that decided to go looking finds nothing to find
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

// Resolved once: the container creates a `coach` user, but a bare `node server.js` on a
// developer's laptop has no such user and must still work.
let coachIds = null;
let resolved = false;
export function unprivilegedIds() {
  if (resolved) return coachIds;
  resolved = true;
  coachIds = null;
  try {
    const passwd = fs.readFileSync('/etc/passwd', 'utf8');
    const line = passwd.split('\n').find(l => l.startsWith('coach:'));
    if (line && process.getuid && process.getuid() === 0) {
      const [, , uid, gid] = line.split(':');
      coachIds = { uid: +uid, gid: +gid };
    }
  } catch { /* not linux, or no passwd file — see canDropPrivileges */ }
  return coachIds;
}

/**
 * Whether a job may run at all, privilege-wise.
 *
 * The drop is the control that keeps a provider runtime out of ./data, and it used to switch
 * itself off silently: `unprivilegedIds()` only returns ids when the server is root, so adding
 * an ordinary `USER node` line to the Dockerfile — a hardening change, made for unrelated
 * reasons — would have left the runtime inheriting the server's uid with nothing to say so.
 * A control that disappears during someone else's refactor is one you find out about late.
 *
 * So on Linux it fails closed: no drop, no job. Elsewhere (a developer's macOS laptop, where
 * there is no `coach` user and no container boundary either) it stays permissive, because the
 * alternative is that the test suite and local development simply stop working.
 *
 * "Elsewhere" does not include CI, which is Linux, runs as an ordinary user and has no `coach`
 * user — so the honest answer there is `false`, and every test that needs to reach the code
 * behind the drop has to say so explicitly. That is what the seam below is for: the suite sets
 * the verdict it wants to test against, including the refusal itself, instead of inheriting
 * whatever the host it happens to run on would have said.
 */
let forced = null;
/** Test-only. Pass a verdict to pin it, or null to go back to asking the host. */
export function forcePrivilegeVerdict(v) { forced = v; }
export function canDropPrivileges() {
  if (forced) return forced;
  if (process.platform !== 'linux') return { ok: true, dropped: false, why: 'not linux — development host' };
  if (unprivilegedIds()) return { ok: true, dropped: true, why: null };
  if (process.getuid && process.getuid() !== 0) {
    return { ok: false, dropped: false, why: 'the server is not running as root, so Coach jobs cannot drop to the unprivileged user' };
  }
  return { ok: false, dropped: false, why: 'no `coach` user exists in this image' };
}

/**
 * Run `cmd argv`, feed `stdin`, resolve { code, stdout, stderr, timedOut }.
 * Never rejects on a non-zero exit: the caller classifies failures, and a CLI that prints a
 * useful error and exits 1 is more informative than a thrown Error with none of it.
 */
export function run(cmd, argv, { stdin = '', env = {}, cwd, timeoutMs = 300000, asCoach = true } = {}) {
  return new Promise(resolve => {
    const ids = asCoach ? unprivilegedIds() : null;
    let child;
    try {
      child = spawn(cmd, argv, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], ...(ids || {}) });
    } catch (e) {
      resolve({ code: -1, stdout: '', stderr: e.message, spawnError: true });
      return;
    }
    let stdout = '', stderr = '', timedOut = false, done = false;
    // Output is bounded: a CLI stuck in a loop must not take the server's memory with it.
    const CAP = 4 * 1024 * 1024;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.stdout.on('data', d => { if (stdout.length < CAP) stdout += d; });
    child.stderr.on('data', d => { if (stderr.length < CAP) stderr += d; });
    const finish = (code, err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr: stderr || (err ? err.message : ''), timedOut, spawnError: !!err });
    };
    child.on('error', e => finish(-1, e));
    child.on('close', code => finish(code));
    try { child.stdin.end(stdin); } catch { /* child already gone; 'close' handles it */ }
  });
}
