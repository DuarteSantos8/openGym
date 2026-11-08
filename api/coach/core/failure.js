/* What went wrong at the provider, in a word an owner can act on.
 *
 * Every failed provider call used to reach the job runner as one class, `provider`, and the chat
 * answered every `provider` with one line. So a spent quota, a revoked key, an endpoint that will
 * not serve the request shape and a provider that was simply down all read "The Coach couldn't
 * run." — the owner had no way to tell which of four different fixes was the one, and the person
 * who hit it had nothing to try.
 *
 * The status is the answer when there is one, and the provider's own words are the answer when
 * there is not. Both are still in hand at this point (api/coach/core/adapters/http.js puts the
 * status at the front of `stderr` for exactly this reason), so the sorting happens once, here:
 *
 *   401 403                     → auth        the credential was refused
 *   402 429                     → quota       out of quota, or rate limited
 *   400 422 + schema words      → schema      it will not serve the request shape we send
 *   5xx 529                     → outage      down, and still down after the adapter's retries
 *   connection dropped          → cutoff      it was answering (or thinking) and the line went (#1035)
 *   no status + network words   → unreachable nothing answered at all (DNS, refused, TLS, proxy)
 *   timed out                   → timeout     an answer never came inside the job's budget
 *   anything else               → provider    it said no, and its words are in `detail`
 *
 * A 400 is checked for auth and quota words before schema words on purpose: Google answers a
 * bad key with a 400 (API_KEY_INVALID) and Anthropic answers an empty balance with one too, and
 * neither is a schema problem however much the body talks about the request.
 *
 * Two rules this file exists to keep:
 *   - what a lifter reads is one short line that names the next step; the provider's own words
 *     never reach a chat (FR-12/42), they go to the admin card and the server log;
 *   - nothing that reaches a log may carry the credential. A provider that echoes the key it
 *     refused ("Incorrect API key provided: sk-…") is common enough that `redact` is not
 *     optional: `detail` lands in coach.json and on the container's stderr.
 */

/* The status is the first thing in an HTTP adapter's `stderr`; a CLI runtime has none. */
const STATUS = /^(\d{3})\b/;

export function statusOf(text) {
  const m = STATUS.exec(String(text == null ? '' : text).trim());
  return m ? Number(m[1]) : null;
}

const AUTH_STATUS = new Set([401, 403]);
const QUOTA_STATUS = new Set([402, 429]);
const BAD_REQUEST = new Set([400, 422]);

/* A credential problem, in the words providers actually use. `token` is deliberately not one of
 * them: "the input token count exceeds the maximum" is a budget error, not a rejected key, and a
 * word match on `token` used to call it one. The delimiters are spelled out rather than `\b`
 * because the commonest shape of all is a variable name: `ANTHROPIC_API_KEY is not set` only
 * matches "api key" if the underscore in front of it counts as a boundary. */
const AUTH_WORDS = /(?:^|[^a-z0-9])(?:api[-_ ]?key|credential|unauthori[sz]ed|unauthenticated|permission|forbidden|invalid key|login|sign in)(?:[^a-z0-9]|$)/i;
/* Out of quota, as opposed to merely going too fast. Both are 429s; this only chooses which of
 * the two lines the person reads. */
const QUOTA_EXHAUSTED = /\b(insufficient_quota|exceeded your current quota|credit balance|out of credit|billing|payment required|spend limit)\b/i;
const QUOTA_WORDS = /\b(quota|resource_exhausted|rate limit|too many requests|billing)\b/i;
/* The shapes a schema-constrained request is refused with. `response_format` and `json_schema`
 * are ours; `additionalProperties` and `schema` are the validator's; `grammar` is a local
 * server's. http.js already retried the two softer forms by the time we get here. */
const SCHEMA_WORDS = /\b(response_format|json_schema|json_object|json mode|structured output|schema|additionalproperties|grammar|constrained decoding)\b/i;
/* A fetch that never got an answer. The adapter's own line always starts "could not reach",
 * which is what most of these are in practice; the errno names cover the rest. */
const NETWORK_WORDS = /\b(could not reach|fetch failed|econnrefused|econnreset|econnaborted|enotfound|eai_again|etimedout|ehostunreach|enetunreach|epipe|socket hang up|getaddrinfo|network|tls|certificate)\b/i;
// The adapter's own lines for a connection that dropped after the request went out (http.js).
const CUTOFF_WORDS = /\bdropped (?:while waiting for the answer|after \d+ characters|mid-answer)/i;
const TIMEOUT_WORDS = /\b(timed out|timeout|did not answer in time)\b/i;

/**
 * The class a failed provider call belongs to.
 *
 * @param {{ text?:string, timedOut?:boolean, spawnError?:boolean }} r  what the adapter returned
 * @returns {'auth'|'quota'|'schema'|'outage'|'cutoff'|'unreachable'|'timeout'|'missing'|'provider'}
 */
export function classifyFailure({ text, timedOut, spawnError } = {}) {
  // No credential or no endpoint: nothing was called, so nothing about a provider is being said.
  if (spawnError) return 'missing';
  const raw = String(text == null ? '' : text);
  const status = statusOf(raw);
  if (timedOut || (status === null && TIMEOUT_WORDS.test(raw))) return 'timeout';
  if (status !== null) {
    // A 403 that says "quota" is a quota, not a credential: Azure and several gateways answer
    // an exhausted plan that way.
    if (AUTH_STATUS.has(status)) return QUOTA_WORDS.test(raw) ? 'quota' : 'auth';
    if (QUOTA_STATUS.has(status)) return 'quota';
    if (status >= 500) return 'outage';
    if (BAD_REQUEST.has(status)) {
      if (AUTH_WORDS.test(raw)) return 'auth';
      if (QUOTA_EXHAUSTED.test(raw)) return 'quota';
      if (SCHEMA_WORDS.test(raw)) return 'schema';
    }
    return 'provider';
  }
  // No status at all: a runtime CLI's own stderr, or a fetch that threw before any answer. A
  // connection that went quiet and was dropped is not an endpoint that is not there (#1035).
  if (CUTOFF_WORDS.test(raw)) return 'cutoff';
  if (NETWORK_WORDS.test(raw)) return 'unreachable';
  if (AUTH_WORDS.test(raw)) return 'auth';
  if (QUOTA_WORDS.test(raw)) return 'quota';
  return 'provider';
}

/* The line a person reads. Short, plain, and it names who can do something about it: in
 * instance mode the reader did not choose the key, the endpoint or the plan. No em dashes. */
export const USER_MESSAGE = Object.freeze({
  auth: "The Coach couldn't sign in to its AI provider. The instance owner needs to check the API key.",
  quota: "The Coach has run out of AI quota. The instance owner needs to check the provider plan or key.",
  schema: "The Coach's AI provider rejected the request format. The instance owner needs to try another model.",
  outage: "The Coach's AI provider is having an outage. Try again in a little while.",
  unreachable: "The Coach couldn't reach its AI provider. The instance owner needs to check the endpoint and the network.",
  cutoff: 'The connection to the AI provider dropped while the Coach was thinking. Try again, ideally on Wi-Fi.',
  timeout: 'The Coach took too long and gave up.',
  missing: "The Coach isn't installed properly on this instance.",
  provider: "The Coach couldn't run. The instance owner needs to check its setup."
});

/* A 429 is two different problems wearing one status. "Rate limit reached for gpt-4" fixes
 * itself in a minute; "You exceeded your current quota" does not, and only the owner can. */
const RATE_LIMITED = 'The Coach is being rate limited by its AI provider. Try again in a few minutes.';

/**
 * The user-facing line for a failure class, or null when the class is not a provider failure
 * (a missing profile, a revoked consent: those have their own words in the app).
 *
 * @param {string} errorClass
 * @param {string} [detail]  the provider's own (already redacted) words, when there are any
 */
export function userMessageFor(errorClass, detail) {
  if (errorClass === 'quota' && !QUOTA_EXHAUSTED.test(String(detail || ''))) return RATE_LIMITED;
  return USER_MESSAGE[errorClass] || null;
}

/* Credential-shaped strings, and what each becomes. Order matters: the specific key formats
 * first, so "sk-abc…" is masked even when nothing introduces it, then the header forms, whose
 * value may itself be "Bearer <token>" and is replaced whole rather than half-masked. */
const SECRETS = [
  [/\b(sk|pk|rk|ak)-[A-Za-z0-9_-]{8,}/g, '$1-…'],
  [/\bAIza[0-9A-Za-z_-]{10,}/g, 'AIza…'],
  [/\b(api[-_ ]?key|x-api-key|x-goog-api-key|authorization|access[-_ ]?token|secret|password)\b\s*[:=]\s*(?:(?:bearer|basic|token)\s+)?(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi, '$1: …']
];

/**
 * The provider's words, safe to write down: credentials masked, whitespace flattened to one
 * line, capped. Never the other way round (a redaction after the cap could miss a key that the
 * cap cut in half, and a masked key reads better than a truncated one).
 */
export function redact(text, max = 300) {
  let s = String(text == null ? '' : text);
  for (const [re, to] of SECRETS) s = s.replace(re, to);
  return s.replace(/\s+/g, ' ').trim().slice(0, max);
}
