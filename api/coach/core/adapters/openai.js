/* OpenAI — and, through compatible.js, everything that speaks its Chat Completions shape.
 *
 * Chat Completions rather than the newer Responses API on purpose: it is the one request shape
 * Ollama, LM Studio, vLLM, OpenRouter and OpenAI itself all serve, so one implementation covers
 * two providers. `compatible` reuses this spec with a different base URL and an optional key.
 */
import { httpAdapter } from './http.js';
import { SYSTEM_PROMPT } from '../system-prompt.js';

export function chatCompletionsSpec(id, { maxTokensField = 'max_completion_tokens', temperature = null } = {}) {
  return {
    id,
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
    // A server that rejects schema/JSON mode gets the same request once more with plain JSON
    // mode, then without any; the parser copes with a fenced answer and the validator is the
    // gate either way.
    withoutJsonMode: body => (body.response_format && body.response_format.type === 'json_schema'
      ? { ...body, response_format: { type: 'json_object' } }
      : (() => { const { response_format: _rf, ...rest } = body; return rest; })()),
    errorMessage: data => data && data.error && (typeof data.error === 'string' ? data.error : data.error.message),
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
export const isChatModel = id => /^(gpt-|o\d|chatgpt-)/.test(id) && !NOT_CHAT.test(id);

export const openaiSpec = chatCompletionsSpec('openai');
export default httpAdapter(openaiSpec);
