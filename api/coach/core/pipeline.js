/* From a payload to a validated proposal, or a classified failure.
 *
 * This is the loop the server's job runner used to own inline. It lives here so the phone —
 * which has no server when it brings its own API key — runs literally the same code: the same
 * prompt, the same transport classification, the same parser, the same validator, and the
 * same single repair round. Two copies of this loop would be two places for "what the model
 * is allowed to say" to disagree, and the validator is the security boundary of the feature.
 *
 * Nothing here touches a file, a clock or an environment. The caller supplies the adapter, the
 * config it needs, and whatever the adapter's `invoke` wants passed through (`jobDir`, `env`,
 * a `fetch`), and gets back a plain object.
 */
import { CONTRACT } from './payload.js';
import { buildPrompt, buildPromptParts } from './prompt.js';
import { SCHEMAS } from './schemas.js';
import { extractJSON, contractOK } from './parse.js';
import { validatePlan, validateReview, validateDebrief } from './validate.js';

/**
 * One attempt: prompt → provider → parse → validate.
 *
 * @returns {{ ok:true, nochange?:boolean, reading?:string, result?:object }
 *        | { ok:false, errorClass:string, detail?:string, repairable?:boolean, errors?:string[], raw?:string }}
 */
export async function attemptOnce({ adapter, cfg, kind, payload, model, timeoutMs, invokeOpts = {} }, repair) {
  // HTTP providers get the rules/payload split (prefix caching, schema-constrained decoding);
  // the runtime-backed CLIs still get one flat prompt — they have no message roles to split over.
  const parts = buildPromptParts(kind, payload, repair);
  const split = adapter.spawns === false;
  const r = await adapter.invoke({
    cfg,
    prompt: split ? parts.user : parts.system + '\n\n---\n\n' + parts.user,
    ...(split ? { system: parts.system, schema: SCHEMAS[parts.task] || null } : {}),
    model: model || null, timeoutMs, ...invokeOpts
  });

  if (r.timedOut) return { ok: false, errorClass: 'timeout' };
  if (r.spawnError) return { ok: false, errorClass: 'missing', detail: r.stderr?.slice(0, 300) };
  if (r.code !== 0) {
    const err = (r.stderr || r.text || '').toLowerCase();
    const authish = /auth|unauthor|api key|credential|token|401|403|login/.test(err);
    return { ok: false, errorClass: authish ? 'auth' : 'provider', detail: (r.stderr || r.text || '').slice(0, 300) };
  }

  const parsed = extractJSON(r.text);
  if (parsed.error) return { ok: false, repairable: !repair, errors: [parsed.error], raw: r.text, errorClass: 'unusable' };
  if (!contractOK(parsed.value)) {
    return { ok: false, repairable: !repair, errors: [`coach_contract must be ${CONTRACT}`], raw: r.text, errorClass: 'unusable' };
  }

  // Everything above is transport: did the provider answer, is there a JSON object in what it
  // said, does it claim the contract this build speaks. None of it has judged whether the
  // contents are safe to act on. That judgement is validate.js's, and the validator — not the
  // prompt — is the security boundary.
  //
  // Its errors join the parse failures above on the same one repair round: a model that named
  // an exercise that does not exist is told which one, and usually gets it right the second
  // time. A model that cannot be told is a failed job, not a retry loop.
  // The user's own exercises are in the library slice the model was given (flagged `custom`),
  // so they are a legitimate thing for it to name back — the validator has to agree.
  const customIds = (payload.library || []).filter(e => e && e.custom).map(e => e.id);
  const checked = kind === 'review'
    ? validateReview(parsed.value, payload.plan, { customIds })
    : kind === 'debrief'
      ? validateDebrief(parsed.value)
      : validatePlan(parsed.value, {
      customIds,
      workingWeights: payload.history?.workingWeights,
      daysPerWeek: payload.coachProfile?.daysPerWeek
    });

  if (!checked.ok) return { ok: false, repairable: !repair, errors: checked.errors, raw: r.text, errorClass: 'unusable' };
  if (checked.nochange) return { ok: true, nochange: true, reading: checked.reading };
  return { ok: true, result: checked.proposal || { bundle: checked.bundle, summary: checked.bundle.summary } };
}

/** The whole loop: one attempt, then one repair round if the answer was fixable (FR-48). */
export async function runPipeline(opts) {
  let attempt = await attemptOnce(opts, null);
  if (!attempt.ok && attempt.repairable) {
    // One repair round, then done. Two failures is a provider problem, not a prompting
    // problem, and a retry loop against a paid API is a bad way to find out.
    attempt = await attemptOnce(opts, { previous: attempt.raw, errors: attempt.errors });
  }
  return attempt;
}
