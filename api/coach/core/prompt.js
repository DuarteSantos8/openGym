/* Prompt assembly. The editable source is api/coach/prompts/*.md; `prompts.js` next to this
 * file is generated from it (scripts/build-coach-assets.mjs) so the same text is importable by
 * the server under bare node and by the phone under Vite, with neither reading a file. */
import { PROMPTS } from './prompts.js';

export const taskOf = (kind, payload) =>
  kind === 'review' ? 'review' : kind === 'debrief' ? 'debrief' : payload && payload.refine ? 'refine' : 'create';

/**
 * The prompt in two parts: `system` is the rules — byte-identical for every job of the same
 * task, deliberately free of anything user- or day-specific — and `user` is the payload (and,
 * on the one repair round, the previous answer with its errors). The split is what lets a
 * local llama.cpp/Ollama server reuse its KV prefix cache across jobs: only the payload is
 * re-processed, which on a CPU box is most of the wall time. Cloud providers get the same
 * split as system/user messages (and Anthropic caches the system block explicitly).
 */
export function buildPromptParts(kind, payload, repair) {
  const task = taskOf(kind, payload);
  // A revision answers in the plan's own format, and refine.md only says "the same schema as
  // before". Without create.md's Output section in front of it a model that does not enforce
  // the JSON schema (OpenAI's json_schema without `strict`, or a server that dropped it) had no
  // plan format to follow at all, and a request like "swap the leverage machine" came back as
  // a review-style change list the plan validator can only reject (#471).
  const rules = task === 'refine' ? PROMPTS.create + '\n\n---\n\n' + PROMPTS.refine : PROMPTS[task];
  const system = PROMPTS.common + '\n\n---\n\n' + rules;
  // Compact JSON, not pretty-printed: the indentation was ~30% of the payload's tokens and
  // a model reads either just as well.
  let user = '## Payload\n\n```json\n' + JSON.stringify(payload) + '\n```\n';
  if (repair) {
    user += '\n\n---\n\n' + PROMPTS.repair
      .replace('{{PREVIOUS}}', String(repair.previous || '').slice(0, 4000))
      .replace('{{ERRORS}}', repair.errors.map(e => '- ' + e).join('\n'));
  }
  return { system, user, task };
}

/** The two parts as one string — what the runtime-backed adapters (CLI) still consume. */
export function buildPrompt(kind, payload, repair) {
  const p = buildPromptParts(kind, payload, repair);
  return p.system + '\n\n---\n\n' + p.user;
}
