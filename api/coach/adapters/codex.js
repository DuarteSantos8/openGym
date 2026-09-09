/* OpenAI's Codex CLI as a Coach provider.
 *
 * `codex exec` is the non-interactive mode; the bare `-` argument makes it read the
 * prompt from stdin, matching the adapter interface. Everything else here exists to
 * stop the CLI reaching for state a sandboxed job does not have.
 */
import { run } from './spawn.js';

const CLI = 'codex';

/**
 * The exact argv every Codex job runs with.
 *
 * Exported so the three hardening flags are asserted by value rather than trusted: each one
 * removes an input the job would otherwise inherit from the host, and dropping one would
 * change what a job can see without changing anything a test looks at.
 */
export function argvFor(model) {
  const argv = [
    'exec', '-',              // non-interactive; '-' reads the prompt from stdin
    '--skip-git-repo-check',  // the job dir is a bare mkdtemp, not a repo -- without this it refuses to run
    '--ephemeral',            // do not write session files; the job dir dies with the job anyway
    '--ignore-user-config'    // $CODEX_HOME/config.toml would be an admin-invisible input to every job
  ];
  if (model) argv.push('--model', model);
  return argv;
}

export default {
  id: 'codex',
  spawns: true,
  cli: CLI,

  async check(cfg, env) {
    const r = await run(CLI, ['--version'], { env, timeoutMs: 20000 });
    if (r.spawnError) return { ok: false, error: `the ${CLI} CLI is not installed in this image` };
    if (r.timedOut) return { ok: false, error: `the ${CLI} CLI did not respond` };
    if (r.code !== 0) return { ok: false, error: (r.stderr || '').trim().slice(0, 300) || `${CLI} --version exited ${r.code}` };
    return { ok: true, version: (r.stdout || '').trim() };
  },

  async invoke({ prompt, jobDir, env, model, timeoutMs }) {
    const argv = argvFor(model);
    // $CODEX_HOME itself is still set (config.jobEnv), because that is where the CLI keeps its
    // refreshable login cache and a job whose HOME is a temp dir would otherwise find no login
    // at all. --ignore-user-config narrows that to credentials only: the cache is read, the
    // config file beside it is not, so an admin cannot be handed job behaviour they never saw.
    // Sandbox mode is left at the CLI's default (read-only). The job only needs the model
    // to write an answer to stdout, and this process is already an unprivileged user in a
    // container -- widening it here would trade that away for nothing.
    const r = await run(CLI, argv, { stdin: prompt, cwd: jobDir, env, timeoutMs });
    return { ...r, text: (r.stdout || '').trim() };
  }
};
