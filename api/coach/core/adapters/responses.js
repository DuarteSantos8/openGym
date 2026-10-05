/* OpenAI Responses API shape — for models a gateway serves ONLY here.
 *
 * opencode Go's `muse-spark-*-contributor` answers POST /v1/chat/completions with
 * `400 Model does not support this protocol`: the model lives at /v1/responses and the
 * Chat shape never reaches it. Same spec contract as openai.js (path, body, readText,
 * errorMessage, withoutJsonMode) so the compatible adapter can retry through it inside
 * one invoke — the caller never knows which shape won. Kept separate from openai.js
 * because the request and answer shapes share nothing but the model id.
 */
import { SYSTEM_PROMPT } from '../system-prompt.js';

export function responsesSpec(id) {
  return {
    id,
    path: () => '/v1/responses',
    modelsPath: '/v1/models',
    headers: key => (key ? { authorization: 'Bearer ' + key } : {}),
    body: ({ model, prompt, system, schema, maxTokens }) => ({
      model,
      input: [
        { role: 'system', content: system ? SYSTEM_PROMPT + '\n\n' + system : SYSTEM_PROMPT },
        { role: 'user', content: prompt }
      ],
      text: schema
        ? { format: { type: 'json_schema', name: 'coach_answer', schema } }
        : { format: { type: 'json_object' } },
      max_output_tokens: maxTokens
    }),
    // A server that rejects the format flag gets the same request once more as plain text.
    withoutJsonMode: body => (body.text && body.text.format && body.text.format.type !== 'text'
      ? { ...body, text: { format: { type: 'text' } } }
      : (() => { const { text: _t, ...rest } = body; return rest; })()),
    errorMessage: data => data && data.error && (typeof data.error === 'string' ? data.error : data.error.message),
    readText: data => {
      if (!data || typeof data !== 'object') return { error: 'empty answer' };
      // A failed response carries the reason here rather than in the output list.
      if (data.status === 'failed' || data.error) {
        const msg = (data.error && (typeof data.error === 'string' ? data.error : data.error.message)) || 'the request failed';
        return { error: `the model failed: ${String(msg).slice(0, 200)}` };
      }
      // Some gateways echo a convenience field; the wire shape is data.output.
      if (typeof data.output_text === 'string' && data.output_text) {
        return { text: data.output_text, truncated: isIncomplete(data) };
      }
      const out = Array.isArray(data.output) ? data.output : [];
      const shape = out.map(i => (i && i.type) || '?').join(',');
      const texts = [];
      for (const item of out) {
        if (!item || typeof item !== 'object') continue;
        for (const part of item.content || []) {
          if (part && part.type === 'output_text' && typeof part.text === 'string') texts.push(part.text);
          if (part && part.type === 'refusal' && part.refusal) return { error: `the model refused: ${String(part.refusal).slice(0, 200)}` };
        }
      }
      // A reasoning model can finish thinking and write no message at all — most often the
      // output budget went to reasoning. Name the shape so the admin log says what happened
      // instead of just "no text".
      if (!texts.length && shape) return { error: `the answer had no message (responses:${data.status || '?'}:[${shape}])` };
      if (!texts.length) return { error: 'the answer had no text' };
      return { text: texts.join(''), truncated: isIncomplete(data) };
    },
    // Listing stays on the Chat adapter; this shape only answers jobs. Unfiltered so a
    // future caller offering it directly serves whatever the endpoint serves.
    readModels: data => (data.data || data.models || []).map(m => (typeof m === 'string' ? m : m.id || m.name)).filter(Boolean)
  };
}

const isIncomplete = data => data.status === 'incomplete' &&
  (!data.incomplete_details || !data.incomplete_details.reason || data.incomplete_details.reason === 'max_output_tokens');
