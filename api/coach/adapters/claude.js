/* Claude Agent SDK adapter.
 *
 * Deliberately the SDK rather than a hand-rolled `claude --print`: it brings its own matching
 * runtime, takes the owner's credential only through the child environment, and exposes the
 * switches that keep the model in a text-in / JSON-out lane.
 *
 * Four of those switches are why this adapter can be trusted next to somebody's ./data, and
 * each is a documented option rather than a hopeful one:
 *
 *   tools: []          — "Disable all built-in tools" (SDK Options). No Read, no Bash, no Grep;
 *                        the model has no filesystem tool at all, however it is prompted.
 *   settingSources: [] — no user/project/local settings file is loaded, so nothing on the host
 *                        can widen the line above after the fact.
 *   skills: []         — same reasoning, for skills.
 *   strictMcpConfig    — no MCP server can arrive from ambient config.
 *
 * They are exported as LOCKDOWN and asserted by value in adapters.test.js, so re-enabling one
 * is a red build rather than a quiet capability grant.
 *
 * The import is lazy on purpose. The default image ships without the SDK (see api/Dockerfile),
 * and an absent runtime has to be an ordinary reportable state — check() says so, isConnected()
 * goes false, and no Coach UI is mounted — rather than a boot crash for every instance that
 * never asked for the feature.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { unprivilegedIds } from './spawn.js';
import { SYSTEM_PROMPT } from '../core/system-prompt.js';

const PKG = '@anthropic-ai/claude-agent-sdk';
const require_ = createRequire(import.meta.url);
// Read rather than hardcoded: the fork's copy still identified itself as 1.2.3 two releases
// later, which is the failure mode of every version string typed by hand.
const CLIENT_APP = `opengym-coach/${(() => {
  try { return require_('../../package.json').version; } catch { return '0' }
})()}`;
const OUTPUT_CAP = 4 * 1024 * 1024;

/** The options that make this adapter safe. Exported so a test can assert them by value. */
export const LOCKDOWN = Object.freeze({
  tools: [],
  settingSources: [],
  skills: [],
  strictMcpConfig: true,
  persistSession: false,
  permissionMode: 'dontAsk',
  maxTurns: 1
});

let cached;
/** Resolve the SDK, or null when this image was built without it. Never throws. */
async function sdk() {
  if (cached !== undefined) return cached;
  try { cached = await import(PKG); } catch { cached = null; }
  return cached;
}

/* The package does not expose ./package.json through its exports map, so ask the resolver where
   the entry point landed and read the manifest sitting next to it. Best-effort by design: the
   admin card shows the version when it can be had, and "installed" is a fine answer when not. */
function installedVersion() {
  try {
    const entry = fileURLToPath(import.meta.resolve(PKG));
    return JSON.parse(fs.readFileSync(path.join(path.dirname(entry), 'package.json'), 'utf8')).version || null;
  } catch { return null; }
}

/* The SDK owns the protocol; the Coach still owns the process boundary. Its runtime is launched
   as the same unprivileged `coach` user as every other provider, so dropping privileges is not
   something an adapter can forget to do. */
function spawnAsCoach({ command, args, cwd, env, signal }) {
  const ids = unprivilegedIds();
  return spawn(command, args, { cwd, env, signal, stdio: ['pipe', 'pipe', 'pipe'], ...(ids || {}) });
}

export default {
  id: 'claude',
  spawns: true,
  runtime: 'Claude Agent SDK',

  /* Importing the package is the check: it is exactly what a job will do, and it is the one
     difference between the two build targets. The credential is deliberately not probed here —
     that is testRun()'s job, which does a real round trip rather than inspecting a token this
     module never reads. */
  async check() {
    const m = await sdk();
    if (!m) return { ok: false, error: `the Claude runtime is not installed in this image (${PKG})` };
    const v = installedVersion();
    return { ok: true, version: v ? `Claude Agent SDK ${v}` : 'Claude Agent SDK' };
  },

  async invoke({ prompt, jobDir, env, model, timeoutMs }) {
    const m = await sdk();
    if (!m) return { code: -1, text: '', stderr: `${PKG} is not installed`, timedOut: false, spawnError: true };

    let text = '', stderr = '', failure = '', timedOut = false;
    const abortController = new AbortController();
    const timer = setTimeout(() => { timedOut = true; abortController.abort(); }, timeoutMs);

    try {
      for await (const message of m.query({
        prompt,
        options: {
          ...LOCKDOWN,
          abortController,
          cwd: jobDir,
          // `env` REPLACES the child environment rather than extending it — which is exactly the
          // contract config.jobEnv() was written to. It builds from nothing, so RP_ID, ADMIN_UIDS
          // and the VAPID keys cannot reach the model process by inheritance.
          env: { ...env, CLAUDE_AGENT_SDK_CLIENT_APP: CLIENT_APP },
          model: model || undefined,
          systemPrompt: SYSTEM_PROMPT,
          stderr: data => { if (stderr.length < OUTPUT_CAP) stderr += data; },
          spawnClaudeCodeProcess: spawnAsCoach
        }
      })) {
        if (message.type !== 'result') continue;
        if (message.subtype === 'success') text = message.result;
        // A non-success result carries its reason in `subtype` (error_during_execution,
        // error_max_turns, …) and `stop_reason`. There is no error list on it — do not invent one.
        else failure = `the Agent SDK stopped: ${message.subtype}${message.stop_reason ? ` (${message.stop_reason})` : ''}`;
      }
    } catch (e) {
      if (timedOut) return { code: -1, text: '', stderr: 'the Agent SDK timed out', timedOut: true, spawnError: false };
      return { code: -1, text: '', stderr: stderr || (e instanceof Error ? e.message : String(e)), timedOut: false, spawnError: true };
    } finally {
      clearTimeout(timer);
    }

    if (timedOut) return { code: -1, text: '', stderr: 'the Agent SDK timed out', timedOut: true, spawnError: false };
    if (failure) return { code: 1, text: '', stderr: failure, timedOut: false, spawnError: false };
    if (!text) return { code: 1, text: '', stderr: stderr || 'the Agent SDK returned no result', timedOut: false, spawnError: false };
    return { code: 0, text, stderr, timedOut: false, spawnError: false };
  }
};
