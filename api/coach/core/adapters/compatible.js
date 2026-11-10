/* Any OpenAI-compatible endpoint: Ollama, LM Studio, vLLM, OpenRouter, a gateway of your own.
 * Same wire shape as openai.js; the base URL comes from configuration and the key is optional.
 * `max_tokens` rather than `max_completion_tokens` because that is the field every one of
 * those servers understands, except OpenAI's own reasoning models and Azure OpenAI, which want
 * the newer one (#869, openai.js wantsCompletionTokens). */
import { httpAdapter } from './http.js';
import { chatCompletionsSpec, wantsCompletionTokens, isReasoningModel } from './openai.js';

// temperature 0: a plan diff wants determinism, and greedy decoding is also what grammar-
// constrained sampling on a local server handles fastest. A gateway that mounts the API under a
// path without a version (Open WebUI's /openai) is reached by the 404 fallback in http.js (#508).
// A gateway that refuses with a 400 that names nothing gets the compatibility ladder (#804).
export const compatibleSpec = chatCompletionsSpec('compatible', {
  maxTokensField: at => (wantsCompletionTokens(at) ? 'max_completion_tokens' : 'max_tokens'),
  // A reasoning model takes only its default temperature: not sent, rather than refused first.
  temperature: ({ model }) => (isReasoningModel(model) ? null : 0),
  versionlessFallback: true,
  compatLadder: true
});
export default httpAdapter(compatibleSpec);
