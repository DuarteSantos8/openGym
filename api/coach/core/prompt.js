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
  const system = PROMPTS.common + '\n\n---\n\n' + PROMPTS[task];
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
