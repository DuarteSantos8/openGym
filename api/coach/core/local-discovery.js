/* Finding a model server on the home network (Ollama, LM Studio, llama.cpp) without typing an
 * address. A fixed list of candidates is asked for its model list, briefly and in parallel; what
 * answers like an OpenAI-compatible server is offered. The list never comes from a request body,
 * so this cannot be pointed at an arbitrary host. */
export const LOCAL_PORTS = Object.freeze([
  { port: 11434, kind: 'Ollama' },
  { port: 1234, kind: 'LM Studio' },
  { port: 8080, kind: 'llama.cpp' }
]);

/** Candidate base URLs for these hosts, every known port, deduplicated, at most `max`. */
export function candidatesFor(hosts, max = 24) {
  const out = [];
  for (const h of hosts) {
    const host = String(h || '').trim().replace(/^\[|\]$/g, '');
    if (!host || !/^[A-Za-z0-9.:-]+$/.test(host)) continue;
    const shown = host.includes(':') ? `[${host}]` : host;
    for (const { port, kind } of LOCAL_PORTS) {
      const base = `http://${shown}:${port}/v1`;
      if (!out.some(c => c.base === base)) out.push({ base, kind });
    }
  }
  return out.slice(0, max);
}

/** Asks every candidate for its models; resolves with the ones that answered, in list order. */
export async function discoverLocal(candidates, { fetch: fetchImpl = globalThis.fetch, timeoutMs = 1500 } = {}) {
  const probe = async c => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(c.base + '/models', { method: 'GET', headers: {}, signal: ctl.signal });
      if (!res.ok) return null;
      const data = JSON.parse(await res.text());
      const models = ((data && (data.data || data.models)) || []).map(m => (typeof m === 'string' ? m : m && (m.id || m.name))).filter(x => typeof x === 'string' && x);
      return Array.isArray(data && (data.data || data.models)) ? { ...c, models: models.slice(0, 50) } : null;
    } catch { return null; } finally { clearTimeout(timer); }
  };
  return (await Promise.all(candidates.map(probe))).filter(Boolean);
}
