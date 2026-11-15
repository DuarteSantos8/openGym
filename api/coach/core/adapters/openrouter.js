/* OpenRouter: one key (or one sign-in, core/openrouter-oauth.js) for Claude, GPT, Gemini and many
 * more, over the Chat Completions shape. Web research is OpenRouter's own web plugin, which works
 * with every model it routes to and returns url_citation annotations. */
import { httpAdapter } from './http.js';
import { chatCompletionsSpec } from './openai.js';

// OpenRouter's own field: `reasoning: { effort }`, which it normalises for whichever model it
// routes to, so the canonical level goes through unclamped (#1240).
export const openrouterSpec = chatCompletionsSpec('openrouter', { maxTokensField: 'max_tokens', effort: { field: 'reasoning' } });
const chatBody = openrouterSpec.body;
openrouterSpec.body = args => ({
  ...chatBody(args),
  ...(args.web ? { plugins: [{ id: 'web', max_results: 5 }] } : {})
});
// App attribution, as OpenRouter asks apps to send it. No user data in either.
const chatHeaders = openrouterSpec.headers;
openrouterSpec.headers = key => ({ ...chatHeaders(key), 'http-referer': 'https://opengym.ch', 'x-title': 'openGym' });
// The listing carries USD prices per token, which the model picker shows as a hint.
openrouterSpec.readPrices = data => {
  const out = {};
  for (const m of (data && data.data) || []) {
    const p = m && m.pricing;
    if (m && typeof m.id === 'string' && p) out[m.id] = { prompt: Number(p.prompt), completion: Number(p.completion) };
  }
  return out;
};
export default httpAdapter(openrouterSpec);
