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
import { classifyFailure, redact } from './failure.js';
import { validatePlan, validateReview, validateDebrief, validateAsk, validateAdapt } from './validate.js';
import { isChangeList, changesOntoPlan } from './refine-changes.js';

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

  if (r.timedOut) {
    return {
      ok: false, errorClass: 'timeout',
      detail: timeoutMs ? `no answer within ${Math.round(timeoutMs / 1000)}s` : 'no answer within the job budget'
    };
  }
  if (r.spawnError) return { ok: false, errorClass: 'missing', detail: redact(r.stderr) };
  if (r.code !== 0) {
    // Why this is the provider's own words and not ours: the class is only as good as the status
    // it is read from, and core/failure.js sorts auth, quota, schema, outage, unreachable and
    // everything else out of the status and the message together. The detail rides along to the
    // job log and the admin card, redacted — a provider that echoes the key it refused must not
    // put it there.
    const text = r.stderr || r.text || '';
    return { ok: false, errorClass: classifyFailure({ text }), detail: redact(text) };
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
  const equipment = payload.coachProfile?.equipment || [];
  const offered = new Set((payload.library || []).map(e => e && e.id));
  const noDumbbells = payload.noDumbbells === true;
  const machines = Array.isArray(payload.machines) ? payload.machines.filter(k => typeof k === 'string') : null;
  // A revision answered as a review-style change list (#471) is laid onto the plan it revises
  // when every change can be placed exactly, and then judged as the plan it now is.
  const answer = kind === 'create' && isChangeList(parsed.value)
    ? changesOntoPlan(payload.refine?.previous, parsed.value) || parsed.value
    : parsed.value;
  const checked = kind === 'review'
    ? validateReview(parsed.value, payload.plan, { customIds, equipment, offered, noDumbbells, machines })
    : kind === 'debrief'
      ? validateDebrief(parsed.value)
      : kind === 'ask'
      ? validateAsk(parsed.value, payload, { customIds, equipment, offered, noDumbbells, machines })
      : kind === 'adapt'
      ? validateAdapt(parsed.value, payload.today, { customIds, equipment, offered, noDumbbells, machines })
      : validatePlan(answer, {
      customIds, equipment, offered, noDumbbells, machines,
      workingWeights: payload.history?.workingWeights,
      daysPerWeek: payload.coachProfile?.daysPerWeek
    });

  if (!checked.ok) return { ok: false, repairable: !repair, errors: checked.errors, raw: r.text, errorClass: 'unusable' };
  if (checked.nochange) return { ok: true, nochange: true, reading: checked.reading };
  const result = checked.proposal || { bundle: checked.bundle, summary: checked.bundle.summary };
  // The pages a web-researched answer read, shown under it as links (coach-146).
  const sources = kind === 'ask' && Array.isArray(r.sources) && r.sources.length ? { sources: r.sources.slice(0, 8) } : {};
  // An answer that turned into a plan or a change-set is pending as that kind, with its own card.
  return { ok: true, result: { ...result, ...sources }, ...(checked.kind && checked.kind !== kind ? { kind: checked.kind } : {}) };
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
