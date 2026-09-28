/* OrcaRouter — an OpenAI-compatible gateway that routes to many vendors' models.
 *
 * Same wire shape as openai.js, which is why it is a spec rather than a new transport. Three
 * things are its own:
 *
 *   - the base URL. It is `https://api.orcarouter.ai/v1` by default, resolved through
 *     core/origins.js so a self-hosted deployment can move it with ORCA_BASE_URL or
 *     ORCA_API_BASE_URL without touching the auth origin, which is a different host on purpose.
 *   - the model list. It is an aggregator's catalog — hundreds of `vendor/model` names, with
 *     embeddings, image, video and rerank entries mixed in — so the list is filtered by declared
 *     capability (see core/catalog.js) instead of being handed to a picker whole. A person
 *     choosing "the first one that looks right" out of that list lands on something this request
 *     shape cannot use, and the failure only shows up as a job that could not run.
 *   - `max_tokens` rather than `max_completion_tokens`. The gateway fronts many vendors and
 *     normalizes the common Chat Completions field; compatible.js takes the same position for
 *     the same reason, and temperature 0 because a plan diff wants determinism.
 *
 * What is NOT here: any credential logic. The key arrives in `env` under ORCAROUTER_API_KEY
 * whether it was pasted or minted by the PKCE flow, and this file cannot tell which — that is
 * the property core/credentials.js exists to hold. */

import { httpAdapter } from './http.js';
import { chatCompletionsSpec } from './openai.js';

export const orcarouterSpec = {
  ...chatCompletionsSpec('orcarouter', { maxTokensField: 'max_tokens', temperature: 0 }),
  // Declaring a catalog switches the model list from "read ids out of the response" to the
  // shared discovery path: ask for `?capability=chat`, normalize, filter on declared endpoint
  // types, and keep a verified seed for an outage.
  catalog: { capability: 'chat' }
};

export default httpAdapter(orcarouterSpec);
