/* Google Gemini (Generative Language API). The key travels as a header, never as `?key=` —
 * a query string ends up in proxy logs, error messages and browser history. */
import { httpAdapter } from './http.js';
import { SYSTEM_PROMPT } from '../system-prompt.js';
import { addSource } from './openai.js';

const versionOf = m => { const v = /^gemini-(\d+)(?:\.(\d+))?/.exec(m); return v ? Number(v[1]) * 100 + Number(v[2] || 0) : 0; };

/* Keywords Gemini's `responseSchema` does not define.
 *
 * responseSchema is an OpenAPI 3.0 subset, not JSON Schema: a keyword outside it is not ignored,
 * it is a 400 — `Unknown name "maxItems" at 'generation_config.response_schema.properties.
 * routines'` — and the job fails, because unlike the OpenAI shape this adapter has no
 * json_object fallback to retreat to (http.js only retries a provider that says it can do
 * without). The schemas in ../schemas.js are plain JSON Schema and carry maxItems on purpose
 * (they cap a small model's repetition under grammar sampling), so the copy sent to Gemini drops
 * what its subset cannot parse. Everything it does understand — type, properties, required,
 * items, enum, description — stays, so the answer is still constrained while it is decoded.
 *
 * Kept out of the request rather than out of schemas.js: the same schema is what Ollama,
 * llama.cpp, vLLM and OpenAI get, and there maxItems is the difference between a plan and a
 * twelve-minute runaway.
 */
const UNSUPPORTED = new Set([
  '$schema', '$id', '$ref', 'additionalProperties', 'maxItems', 'minItems', 'uniqueItems',
  'pattern', 'minProperties', 'maxProperties', 'const', 'default', 'examples', 'deprecated'
]);

// "This subtree cannot be expressed in Gemini's subset", as opposed to a JSON null.
const MISS = Symbol('gemini-unsupported');

function walk(node) {
  if (Array.isArray(node)) {
    const out = [];
    for (const item of node) {
      const clean = walk(item);
      if (clean === MISS) return MISS;
      out.push(clean);
    }
    return out;
  }
  if (node == null || typeof node !== 'object') return node;
  // anyOf/oneOf and $ref have no responseSchema equivalent, and neither does a union type:
  // dropping them would change what the schema means, so the schema is declined instead.
  if ('anyOf' in node || 'oneOf' in node || '$ref' in node) return MISS;
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (UNSUPPORTED.has(key)) continue;
    if (key === 'type' && typeof value !== 'string') return MISS;
    const clean = walk(value);
    if (clean === MISS) return MISS;
    out[key] = clean;
  }
  return out;
}

/** The copy of `node` Gemini can enforce, or null when it cannot enforce it at all — a union
 *  type (`before`/`after` in REVIEW_SCHEMA), anyOf/oneOf or $ref. Null means "send no
 *  responseSchema", which is the json-mime-plus-validator path this adapter used before. */
export function geminiSchema(node) {
  const out = walk(node);
  return out === MISS ? null : out;
}

export const geminiSpec = {
  id: 'gemini',
  path: model => `/v1beta/models/${encodeURIComponent(model)}:generateContent`,
  modelsPath: '/v1beta/models?pageSize=200',
  headers: key => ({ 'x-goog-api-key': key }),
  // A schema is sent only when it survives geminiSchema(): the create/ask/debrief shapes do, the
  // review shape does not (its before/after are type unions), and that one keeps the JSON mime
  // type and the validator instead of a guaranteed 400.
  // Web research is Grounding with Google Search. Older models refuse a JSON mime type next to a
  // tool, so a grounded request asks for JSON in the prompt alone and the parser and validator judge it.
  body: ({ prompt, system, schema, maxTokens, web }) => {
    const responseSchema = schema && !web ? geminiSchema(schema) : null;
    return {
      systemInstruction: { parts: [{ text: system ? SYSTEM_PROMPT + '\n\n' + system : SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      ...(web ? { tools: [{ google_search: {} }] } : {}),
      generationConfig: {
        ...(web ? {} : { responseMimeType: 'application/json' }),
        ...(responseSchema ? { responseSchema } : {}),
        maxOutputTokens: maxTokens
      }
    };
  },
  errorMessage: data => data && data.error && data.error.message,
  readText: data => {
    const cand = (data.candidates || [])[0];
    if (!cand) {
      const block = data.promptFeedback && data.promptFeedback.blockReason;
      return { error: block ? `the request was blocked: ${block}` : 'the answer had no candidates' };
    }
    if (cand.finishReason === 'MAX_TOKENS') return { text: '', truncated: true };
    if (cand.finishReason && cand.finishReason !== 'STOP') return { error: `the model stopped early: ${cand.finishReason}` };
    const text = ((cand.content && cand.content.parts) || []).filter(p => !p.thought).map(p => p.text || '').join('');
    // Grounding with Google Search: the pages the answer was grounded on.
    const sources = [];
    ((cand.groundingMetadata && cand.groundingMetadata.groundingChunks) || []).forEach(c => addSource(sources, c && c.web && c.web.uri, c && c.web && c.web.title));
    return { text, truncated: false, ...(sources.length ? { sources } : {}) };
  },
  // Streamed (#1035): streamGenerateContent over SSE, each event one partial response.
  stream: {
    path: model => `/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
    body: b => b,
    fold: events => foldGenerateStream(events)
  },
  // After a refused model (#758): the newest plain Flash the key lists, since that is the one a
  // free key can call; then the newest non-preview Gemini; then whatever text model is there.
  preferModel: models => {
    const newest = list => list.slice().sort((a, b) => versionOf(b) - versionOf(a))[0];
    return newest(models.filter(m => /^gemini-[\d.]+-flash$/.test(m)))
      || newest(models.filter(m => /^gemini-/.test(m) && !/preview|exp/.test(m)))
      || models[0];
  },
  readModels: data => (data.models || [])
    .filter(m => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes('generateContent'))
    .map(m => String(m.name || '').replace(/^models\//, ''))
};

export default httpAdapter(geminiSpec);

/** streamGenerateContent events as one generateContent answer: the parts' text joined, the last
 *  finish reason, grounding and prompt feedback from whichever event carried them. */
export function foldGenerateStream(events) {
  let text = '', finishReason = null, grounding = null, feedback = null, any = false;
  for (const { data: ev } of events) {
    if (!ev || typeof ev !== 'object') continue;
    if (ev.promptFeedback) feedback = ev.promptFeedback;
    const cand = (ev.candidates || [])[0];
    if (!cand) continue;
    any = true;
    ((cand.content && cand.content.parts) || []).forEach(p => { if (p && !p.thought && typeof p.text === 'string') text += p.text; });
    if (cand.finishReason) finishReason = cand.finishReason;
    if (cand.groundingMetadata) grounding = cand.groundingMetadata;
  }
  if (!any) return feedback ? { promptFeedback: feedback } : null;
  return { candidates: [{ content: { parts: [{ text }] }, ...(finishReason ? { finishReason } : {}), ...(grounding ? { groundingMetadata: grounding } : {}) }] };
}
