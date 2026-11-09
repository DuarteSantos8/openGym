// The coach asks undici for a fetch with long timeouts (api/coach/node-fetch.js). On Workers that
// would open raw sockets; the platform's own fetch is the supported way out, so wrangler.toml
// swaps undici for this.
export const fetch = (url, { dispatcher, ...init } = {}) => globalThis.fetch(url, init);
export class Agent {}
