/* Google Gemini (Generative Language API). The key travels as a header, never as `?key=` —
 * a query string ends up in proxy logs, error messages and browser history. */
import { httpAdapter } from './http.js';
import { SYSTEM_PROMPT } from '../system-prompt.js';

export const geminiSpec = {
  id: 'gemini',
  path: model => `/v1beta/models/${encodeURIComponent(model)}:generateContent`,
  modelsPath: '/v1beta/models?pageSize=200',
  headers: key => ({ 'x-goog-api-key': key }),
  // No responseSchema on purpose: Gemini's OpenAPI subset rejects the type unions our schemas
  // use for before/after, and json mime plus the validator already holds the line.
  body: ({ prompt, system, maxTokens }) => ({
    systemInstruction: { parts: [{ text: system ? SYSTEM_PROMPT + '\n\n' + system : SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: 'application/json', maxOutputTokens: maxTokens }
  }),
  errorMessage: data => data && data.error && data.error.message,
  readText: data => {
    const cand = (data.candidates || [])[0];
    if (!cand) {
      const block = data.promptFeedback && data.promptFeedback.blockReason;
      return { error: block ? `the request was blocked: ${block}` : 'the answer had no candidates' };
    }
    if (cand.finishReason === 'MAX_TOKENS') return { text: '', truncated: true };
    if (cand.finishReason && cand.finishReason !== 'STOP') return { error: `the model stopped early: ${cand.finishReason}` };
    const text = ((cand.content && cand.content.parts) || []).map(p => p.text || '').join('');
    return { text, truncated: false };
  },
  readModels: data => (data.models || [])
    .filter(m => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes('generateContent'))
    .map(m => String(m.name || '').replace(/^models\//, ''))
};

export default httpAdapter(geminiSpec);
