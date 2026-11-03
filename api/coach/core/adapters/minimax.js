/* MiniMax Chat Completions API. */
import { httpAdapter } from './http.js';
import { chatCompletionsSpec } from './openai.js';

export const minimaxSpec = chatCompletionsSpec('minimax', { maxTokensField: 'max_tokens' });
export default httpAdapter(minimaxSpec);
