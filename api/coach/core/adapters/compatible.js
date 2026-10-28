/* Any OpenAI-compatible endpoint: Ollama, LM Studio, vLLM, OpenRouter, a gateway of your own.
 * Same wire shape as openai.js; the base URL comes from configuration and the key is optional.
 * Start with the legacy fields local servers understand; an explicit refusal opts the request
 * into a reasoning model's newer token field or default temperature. */
import { httpAdapter } from './http.js';
import { chatCompletionsSpec } from './openai.js';

// temperature 0: a plan diff wants determinism, and greedy decoding is also what grammar-
// constrained sampling on a local server handles fastest. A gateway that mounts the API under a
// path without a version (Open WebUI's /openai) is reached by the 404 fallback in http.js (#508).
export const compatibleSpec = {
  ...chatCompletionsSpec('compatible', { maxTokensField: 'max_tokens', temperature: 0, versionlessFallback: true }),
  // Deployment aliases need not name their model family, so let the endpoint say what it supports.
  withSupportedParameters: (body, msg) => {
    if ('max_tokens' in body && /\bmax_tokens\b/i.test(msg) && /\bmax_completion_tokens\b/i.test(msg)
      && /unsupported|not supported|does not support/i.test(msg)) {
      const { max_tokens, ...rest } = body;
      return { ...rest, max_completion_tokens: max_tokens };
    }
    if ('temperature' in body && /unsupported (?:parameter|value):?\s*['"`]?temperature\b|\btemperature\b[^.\n]*(?:not supported|does not support)/i.test(msg)) {
      const { temperature: _temperature, ...rest } = body;
      return rest;
    }
    return body;
  }
};
export default httpAdapter(compatibleSpec);
