/* The model catalog, and the capability rules that decide which of its entries an entry point
 * may offer.
 *
 * One place, because the alternative is what this repository already warns about elsewhere: a
 * provider's model list read three different ways — the admin card, the phone's setup screen and
 * a fallback table that drifts — and no way to tell which one is right. Every consumer here asks
 * the same two questions ("what does this endpoint serve?", "which of those can do X?") and gets
 * the same answer, filtered on metadata the endpoint declared rather than on what a name looks
 * like.
 *
 * The rules are deliberately fail-closed. A model that does not say it accepts an image does not
 * appear in a picker whose entry point uploads one, because guessing from a vendor prefix is how
 * a person ends up choosing a model that answers a plan request with "I cannot see images" — or,
 * worse for this app, a model that accepts the request and returns prose the validator then
 * rejects as unusable. `undefined` is not a promise.
 *
 * Bounds are part of the contract, not decoration: this response is written by a third party and
 * is parsed into memory. Item count, id length, and the accepted metadata shape are all capped so
 * a hostile or broken catalog cannot spend the process's memory, and anything that does not match
 * the accepted shape is dropped rather than coerced. */

/* Bounds. A real catalog is a few hundred entries; 2000 is far above any plausible list and far
 * below anything that hurts. */
export const MAX_CATALOG_ITEMS = 2000;
export const MAX_MODEL_ID = 160;
export const MAX_MODALITIES = 8;

/* The endpoint types this app can actually speak. A model that advertises only, say, a
 * `jina-rerank` endpoint is not something the Coach can send a chat job to, however good it is. */
export const CHAT_ENDPOINT_TYPES = Object.freeze(['openai', 'anthropic', 'gemini', 'openai-response']);
// Specialists that are text-in/text-out shaped but are not general chat models. Kept as a deny
// list on top of the endpoint check because a provider may route one of these through an
// `openai`-typed endpoint.
const NON_CHAT_ENDPOINT_TYPES = Object.freeze(['image-generation', 'openai-video', 'jina-rerank', 'embeddings']);

export const CAPABILITIES = Object.freeze({
  chat: Object.freeze({ endpointTypes: CHAT_ENDPOINT_TYPES, query: 'chat' }),
  embedding: Object.freeze({ endpointTypes: Object.freeze(['embeddings']), query: 'embedding' }),
  image: Object.freeze({ endpointTypes: Object.freeze(['image-generation']), query: 'image' }),
  video: Object.freeze({ endpointTypes: Object.freeze(['openai-video']), query: null }),
  rerank: Object.freeze({ endpointTypes: Object.freeze(['jina-rerank']), query: null })
});
export const CAPABILITY_IDS = Object.freeze(Object.keys(CAPABILITIES));

/** The `?capability=` value to ask the endpoint for, or null to take the whole list and filter. */
export const capabilityQuery = capability => (CAPABILITIES[capability] && CAPABILITIES[capability].query) || null;

const str = v => (typeof v === 'string' ? v : null);
const strList = v => (Array.isArray(v) ? v.filter(x => typeof x === 'string' && x).slice(0, MAX_MODALITIES) : []);

/**
 * One catalog record, or null if it is not a record this app will offer.
 *
 * Accepts the OpenAI `/v1/models` shape (`{ id }`) and the richer shape an aggregator serves
 * (`{ id, name, context_length/length, architecture: { input_modalities }, supported_endpoint_types }`).
 * Anything unreadable becomes null and is dropped by the caller; a record with an id but no
 * metadata keeps its id and simply fails every capability test, which is the fail-closed answer.
 */
export function normalizeModel(raw) {
  if (typeof raw === 'string') return raw ? { id: raw.slice(0, MAX_MODEL_ID) } : null;
  if (!raw || typeof raw !== 'object') return null;
  const id = str(raw.id) || str(raw.name);
  if (!id) return null;
  const arch = raw.architecture && typeof raw.architecture === 'object' ? raw.architecture : {};
  const context = [raw.context_length, raw.context_window, raw.length, arch.context_length]
    .find(v => Number.isFinite(v) && v > 0) || null;
  // Reasoning: either an explicit flag or a declared effort ladder. A model that lists efforts is
  // one that reasons, whatever the flag says.
  const rawEfforts = raw.reasoning_efforts || raw.reasoning_effort_levels || (raw.reasoning && raw.reasoning.efforts);
  const efforts = strList(rawEfforts);
  const reasoning = !!(raw.reasoning === true || efforts.length || (raw.reasoning && raw.reasoning.supported === true));
  return {
    id: id.slice(0, MAX_MODEL_ID),
    name: str(raw.name) ? raw.name.slice(0, MAX_MODEL_ID) : null,
    context,
    inputModalities: strList(arch.input_modalities || raw.input_modalities),
    endpointTypes: strList(raw.supported_endpoint_types || raw.endpoint_types),
    reasoning,
    reasoningEfforts: efforts
  };
}

/** Every usable record in a catalog response, bounded, in the order the endpoint gave them. */
export function normalizeCatalog(data) {
  const list = data && (data.data || data.models);
  if (!Array.isArray(list)) return null;
  return list.slice(0, MAX_CATALOG_ITEMS).map(normalizeModel).filter(Boolean);
}

/**
 * Can this record serve `capability`? Only declared metadata counts.
 *
 * `modality` narrows a chat model further: an entry point that uploads an image must not be
 * offered a chat model that never said it accepts one.
 */
export function supportsCapability(model, capability, { modality = null } = {}) {
  const rule = CAPABILITIES[capability];
  if (!rule || !model) return false;
  const declared = model.endpointTypes || [];
  // A catalog that declares no endpoint types at all is one this app cannot judge. For chat,
  // that is the plain OpenAI `/v1/models` shape — the endpoint serving that list under that path
  // is by construction serving chat, so the absence is answered by the caller (see the adapter),
  // not guessed at here.
  if (!declared.length) return false;
  if (!declared.some(t => rule.endpointTypes.includes(t))) return false;
  if (capability === 'chat' && declared.some(t => NON_CHAT_ENDPOINT_TYPES.includes(t))) return false;
  if (modality) {
    const mods = model.inputModalities || [];
    if (!mods.includes(modality)) return false;
  }
  return true;
}

/** The ids of every record in `models` that can serve `capability`. */
export function filterCatalog(models, capability, opts) {
  return (models || []).filter(m => supportsCapability(m, capability, opts)).map(m => m.id);
}

/**
 * The verified cold-start catalog.
 *
 * Used only when live discovery fails, and labelled as a fallback wherever it is shown. It is
 * small on purpose: this is what makes a fresh installation able to run one job during an
 * outage, not a substitute for asking the endpoint. Every entry carries the metadata the
 * capability filters read, so a filtered picker built from the seed behaves exactly like one
 * built from the live list instead of silently degrading to an unfiltered one.
 *
 * `source` is recorded per entry so the PR and the tests can point at where a number came from.
 */
export const VERIFIED_SEED = Object.freeze([
  Object.freeze({
    id: 'openai/gpt-5.5', name: 'GPT-5.5', context: 400000,
    inputModalities: Object.freeze(['text', 'image']),
    endpointTypes: Object.freeze(['openai', 'openai-response']),
    reasoning: true, reasoningEfforts: Object.freeze(['low', 'medium', 'high', 'xhigh']),
    source: 'campaign-verified seed'
  }),
  Object.freeze({
    id: 'anthropic/claude-opus-4.8', name: 'Claude Opus 4.8', context: 200000,
    inputModalities: Object.freeze(['text', 'image']),
    endpointTypes: Object.freeze(['anthropic']),
    reasoning: true, reasoningEfforts: Object.freeze(['low', 'medium', 'high']),
    source: 'campaign-verified seed'
  }),
  Object.freeze({
    id: 'google/gemini-3.5-flash', name: 'Gemini 3.5 Flash', context: 1000000,
    inputModalities: Object.freeze(['text', 'image']),
    endpointTypes: Object.freeze(['gemini']),
    reasoning: true, reasoningEfforts: Object.freeze(['low', 'medium', 'high']),
    source: 'campaign-verified seed'
  }),
  Object.freeze({
    id: 'deepseek/deepseek-v4-pro', name: 'DeepSeek V4 Pro', context: 128000,
    inputModalities: Object.freeze(['text']),
    endpointTypes: Object.freeze(['openai']),
    reasoning: true, reasoningEfforts: Object.freeze(['low', 'medium', 'high']),
    source: 'campaign-verified seed'
  }),
  // The gateway's own router. No reasoning ladder declared — it picks a model per request, so
  // there is nothing stable to pin an effort to, and claiming one would be a guess.
  Object.freeze({
    id: 'orcarouter/auto', name: 'OrcaRouter Auto', context: 200000,
    inputModalities: Object.freeze(['text']),
    endpointTypes: Object.freeze(['openai']),
    reasoning: false, reasoningEfforts: Object.freeze([]),
    source: 'campaign-verified seed'
  })
]);

/** The seed as ids, filtered the same way a live list is — never unfiltered. */
export const seedFor = (capability, opts) => filterCatalog(VERIFIED_SEED, capability, opts);

/** Seed entries by id, so a stored model's metadata can be checked after a catalog outage. */
export const seedModel = id => VERIFIED_SEED.find(m => m.id === id) || null;
