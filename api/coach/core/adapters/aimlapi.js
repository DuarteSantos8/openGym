/* AI/ML API: one key in front of several hundred chat models from different vendors, speaking
 * the Chat Completions shape. Same spec as openai.js with a different base URL, so this file
 * is the spec plus the one thing that is ours: the attribution headers, which ride only when
 * the request is actually going to the gateway.
 *
 * `max_tokens` rather than `max_completion_tokens`: the gateway normalises for the models
 * behind it and accepts the field every OpenAI-compatible client sends.
 *
 * Model ids keep their vendor prefix (`openai/gpt-6-luna`, `anthropic/claude-sonnet-5.5`), and
 * the picker fills itself from `/v1/models`, so no name is pinned in this repository.
 */
import { httpAdapter } from './http.js';
import { chatCompletionsSpec } from './openai.js';
import { aimlapiHeaders } from '../aimlapi-attribution.js';

const base = chatCompletionsSpec('aimlapi', { maxTokensField: 'max_tokens' });

/* The catalogue runs to several hundred rows and most of them are not chat: image, video,
 * speech, embeddings and OCR all live in the same list, and nothing in the id says which is
 * which -- only `type` does. Unfiltered, the picker offers names that Chat Completions answers
 * with a 400 the app can only show as "couldn't run", which is the same reason openai.js
 * filters its own list.
 * A row with no recognised type is kept: a new endpoint family should not empty the picker. */
const CHAT_TYPES = new Set(['openai/chat-completions', 'anthropic/messages']);

export const aimlapiSpec = {
  ...base,
  headers: (key, url) => ({ ...base.headers(key), ...aimlapiHeaders(url) }),
  readModels: data => {
    const rows = data.data || data.models || [];
    const byId = new Map();
    for (const row of rows) {
      const id = typeof row === 'string' ? row : row && (row.id || row.name);
      if (!id) continue;
      const type = typeof row === 'object' && row ? row.type : undefined;
      // One model is listed once per endpoint family it serves, so a chat row anywhere wins.
      const chat = typeof type === 'string' ? CHAT_TYPES.has(type) : true;
      byId.set(id, byId.get(id) || chat);
    }
    const chat = [...byId].filter(([, isChat]) => isChat).map(([id]) => id);
    return chat.length ? chat : [...byId.keys()];
  }
};

export default httpAdapter(aimlapiSpec);
