/* A fetch for the server that waits as long as a job may.
 *
 * Node's global fetch is undici with its defaults, and one of those defaults is a hard
 * 300-second headers timeout — the connection is torn down and the adapter sees a generic
 * "fetch failed", however long the job's own timeout was. A cloud API answers well inside
 * that; a local model on a small box legitimately does not, and COACH_JOB_TIMEOUT_MS exists
 * precisely for it. So the job runner hands the HTTP adapters this fetch instead, with the
 * transport timeouts derived from the job timeout rather than from undici's idea of patience.
 *
 * Node-only by design: the phone's transport is capacitor-fetch.js, and the core adapters
 * take whichever fetch they are given. */
// undici's own fetch alongside its Agent, so the dispatcher option is honoured by the same
// undici version on every Node the image or a dev box happens to run.
import { fetch as undiciFetch, Agent } from 'undici';

const GRACE_MS = 15000;

let agent = null;
/** The dispatcher, built once for the job timeout in force. */
export function dispatcherFor(timeoutMs) {
  const budget = Math.max(60000, +timeoutMs || 0) + GRACE_MS;
  if (!agent || agent._coachBudget !== budget) {
    agent = new Agent({ headersTimeout: budget, bodyTimeout: budget, connectTimeout: 30000 });
    agent._coachBudget = budget;
  }
  return agent;
}

/** fetch(url, init) that will wait `timeoutMs` for the provider; AbortController still wins. */
export function fetchFor(timeoutMs) {
  const dispatcher = dispatcherFor(timeoutMs);
  return (url, init = {}) => undiciFetch(url, { ...init, dispatcher });
}
