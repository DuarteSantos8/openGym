/* MiniMax Chat Completions API. */
import { httpAdapter } from './http.js';
import { chatCompletionsSpec } from './openai.js';

// `reasoning_effort` unclamped: MiniMax's M-series reasoning models take the whole ladder, the
// same levels as the Claude Agent SDK (#1240).
export const minimaxSpec = chatCompletionsSpec('minimax', { maxTokensField: 'max_tokens', effort: { field: 'reasoning_effort' } });
export default httpAdapter(minimaxSpec);
