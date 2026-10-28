/* OpenAI — and, through compatible.js, everything that speaks its Chat Completions shape.
 *
 * Chat Completions rather than the newer Responses API on purpose: it is the one request shape
 * Ollama, LM Studio, vLLM, OpenRouter and OpenAI itself all serve, so one implementation covers
 * two providers. `compatible` reuses this spec with a different base URL and an optional key.
 */
import { httpAdapter } from './http.js';
import { SYSTEM_PROMPT } from '../system-prompt.js';

export function chatCompletionsSpec(id, { maxTokensField = 'max_completion_tokens', temperature = null, versionlessFallback = false } = {}) {
  return {
    id,
    versionlessFallback,
    path: () => '/v1/chat/completions',
    modelsPath: '/v1/models',
    headers: key => (key ? { authorization: 'Bearer ' + key } : {}),
    // The rules ride in the system message, byte-identical for every job of a task, so a
    // llama.cpp/Ollama endpoint can reuse its KV prefix cache and only ever re-processes the
    // payload. A schema, when given, turns JSON mode into grammar-constrained decoding —
    // the answer cannot leave the shape, which is most of what the repair round used to fix.
    body: ({ model, prompt, system, schema, maxTokens }) => ({
      model,
      messages: [
        { role: 'system', content: system ? SYSTEM_PROMPT + '\n\n' + system : SYSTEM_PROMPT },
        { role: 'user', content: prompt }
      ],
      ...(temperature != null ? { temperature } : {}),
      response_format: schema
        ? { type: 'json_schema', json_schema: { name: 'coach_answer', schema } }
        : { type: 'json_object' },
      [maxTokensField]: maxTokens
    }),
    // The 400 that says the schema is not strict enough gets a strict-schema copy of the same
    // request once (see strictSchema below); a server that rejects even that, or rejects
    // schema/JSON mode outright, still gets the plain-JSON fallbacks below.
    withStrictSchema: body => (body.response_format && body.response_format.type === 'json_schema'
      ? { ...body, response_format: { ...body.response_format, json_schema: { ...body.response_format.json_schema, schema: strictSchema(body.response_format.json_schema.schema) } } }
      : body),
    // A server that rejects schema/JSON mode gets the same request once more with plain JSON
    // mode, then without any; the parser copes with a fenced answer and the validator is the
    // gate either way.
    withoutJsonMode: body => (body.response_format && body.response_format.type === 'json_schema'
      ? { ...body, response_format: { type: 'json_object' } }
      : (() => { const { response_format: _rf, ...rest } = body; return rest; })()),
    errorMessage: data => {
      const e = data && data.error;
      if (!e || typeof e === 'string') return e || null;
      // OpenRouter wraps the upstream provider's own error: its message is a generic "Provider
      // returned error" and the provider's words are in metadata.raw, usually as JSON. Those words
      // are what an owner needs to see, and what the JSON-mode fallback in http.js matches on.
      const raw = e.metadata && e.metadata.raw;
      let inner = null;
      if (typeof raw === 'string' && raw) {
        try {
          const j = JSON.parse(raw);
          inner = (j && j.error && (typeof j.error === 'string' ? j.error : j.error.message)) || null;
        } catch { inner = raw; }
      }
      return inner && inner !== e.message ? `${e.message}: ${inner}` : e.message;
    },
    readText: data => {
      const choice = (data.choices || [])[0];
      if (!choice) return { error: 'the answer had no choices' };
      const content = choice.message && choice.message.content;
      const text = typeof content === 'string' ? content : Array.isArray(content) ? content.map(p => p.text || '').join('') : '';
      return { text, truncated: choice.finish_reason === 'length' };
    },
    readModels: data => {
      const ids = (data.data || data.models || []).map(m => (typeof m === 'string' ? m : m.id || m.name)).filter(Boolean);
      // OpenAI's own list is everything the account can call — speech, embeddings, image
      // models, realtime and Responses-only variants — and a person picking "the first one that
      // looks right" out of eighty names lands on one Chat Completions refuses with a 400 or
      // 404 the app can only show as "couldn't run". Keep what this request shape can use.
      // A compatible endpoint (Ollama, LM Studio, OpenRouter) serves what it serves, unfiltered.
      if (id !== 'openai') return ids;
      // A proxy or stand-in that answers under OpenAI's own base URL may serve names the
      // filter does not know; an empty picker would be worse than a long one.
      const chat = ids.filter(isChatModel);
      return chat.length ? chat : ids;
    }
  };
}

const NOT_CHAT = /realtime|audio|tts|transcri|whisper|embedding|image|dall-e|moderation|search|instruct|codex|computer-use|deep-research|-pro(?:-|$)|davinci|babbage|curie|ada/i;
/* A strict-schema copy of the flat schemas: every node that can be an object gains
 * `additionalProperties: false`. That is exactly what a hosted validator that enforces strict
 * JSON Schema asks for — OpenRouter maps chat-completions response_format to its internal
 * output_config.format.schema and answers the flat shape with
 *   400 "output_config.format.schema: For 'object' type, 'additionalProperties' must be
 *   explicitly set to false"
 * — and exactly what schemas.js leaves out on purpose, because llama.cpp's grammar converter
 * has a history of choking on additionalProperties (ollama#8444, #8063). So the strict copy is
 * made only for the wire, only when an endpoint has already proven it wants one; nothing else
 * moves. `required` stays per-schema and the shape stays flat: a validator that demands more
 * (every property required, single types) still says no, and the request falls through to
 * plain JSON mode, where validate.js judges the answer either way.
 */
export function strictSchema(node) {
  if (Array.isArray(node)) return node.map(strictSchema);
  if (node == null || typeof node !== 'object') return node;
  const out = {};
  for (const key of Object.keys(node)) out[key] = strictSchema(node[key]);
  const type = out.type;
  if ((type === 'object' || (Array.isArray(type) && type.includes('object'))) && !('additionalProperties' in out)) {
    out.additionalProperties = false;
  }
  return out;
}

export const isChatModel = id => /^(gpt-|o\d|chatgpt-)/.test(id) && !NOT_CHAT.test(id);

export const openaiSpec = chatCompletionsSpec('openai');
export default httpAdapter(openaiSpec);
