# ADR 0007: EP14 local inference uses upstream's OpenAI-compatible provider

- Status: accepted (2026-11-15)
- Context: EP14-T01 in `NEXT-STEPS.md` called for a local coach adapter: Ollama on `127.0.0.1` behind the existing coach interface, off by default, with no cloud fallback. Spike 0004 found local inference feasible on the owner's RTX 4070 (8 GB).

## Finding

Upstream openGym 1.4.5 already does this. Building a second adapter would duplicate it and add merge friction with upstream.

| Requirement | Where upstream covers it |
|---|---|
| Local model server | `api/coach/core/providers.js`: the "OpenAI-compatible endpoint" provider (Ollama, LM Studio, vLLM, llama.cpp), `baseUrl` per provider, key optional |
| Finding it without typing an address | `api/coach/core/local-discovery.js`: fixed candidate list (Ollama 11434, LM Studio 1234, llama.cpp 8080); the list never comes from a request body |
| Plain HTTP only on the home network | `providers.js` private-host check (loopback, RFC 1918, link-local, Tailscale 100.64/10, `.local`, single-label names) |
| Off by default | The coach itself is opt-in, and so is each data category it may see (the EP13 nutrition category included, default off) |
| No cloud fallback | The fallbacks in `core/adapters/http.js` retry the **same** provider with another model or request format; nothing switches provider |
| Tested | `api/test/adapters-http.test.js`, `contracts-http.test.js`, `e2e-apikey.test.js` (compatible endpoints on a local server), `local-discovery.test.js` |

## Decision

No new adapter. To run the coach locally:

1. Install Ollama and pull a model that fits 8 GB, e.g. a 7–8B instruct model at Q4.
2. Settings → Coach → provider "OpenAI-compatible endpoint" → "Find on this network", or enter `http://127.0.0.1:11434/v1`.
3. Leave every other provider unset, so there is nothing to fall back to.

## Consequences

- EP14-T01 is closed with no code change.
- **Still to do by hand:** one real run against a local model on the owner's machine (not installed here; installing software was out of scope). Record the model, latency, and whether the plan validated, in `docs/next/devices.md`.
- **Node-RED / LangGraph** (rest of EP14): upstream already ships `contrib/node-red` (signed webhook receiver, CI-tested). LangGraph stays out until a workflow needs more than webhooks.
