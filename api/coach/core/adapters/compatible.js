/* Any OpenAI-compatible endpoint: Ollama, LM Studio, vLLM, OpenRouter, a gateway of your own.
 * Same wire shape as openai.js; the base URL comes from configuration and the key is optional.
 * `max_tokens` rather than `max_completion_tokens` because that is the field every one of
 * those servers understands. */
import { httpAdapter } from './http.js';
import { chatCompletionsSpec } from './openai.js';
import { responsesSpec } from './responses.js';

// temperature 0: a plan diff wants determinism, and greedy decoding is also what grammar-
// constrained sampling on a local server handles fastest.
const spec = chatCompletionsSpec('compatible', { maxTokensField: 'max_tokens', temperature: 0 });
// Gateways may serve a model ONLY over the Responses API (opencode Go's
// `muse-spark-*-contributor` 400s the Chat shape with "does not support this protocol").
// The adapter retries through it once, inside one invoke — List models is untouched.
spec.responsesFallback = responsesSpec('compatible');
export const compatibleSpec = spec;
export default httpAdapter(compatibleSpec);
