/* "Sign in with OpenRouter": OpenRouter's official OAuth PKCE flow
 * (https://openrouter.ai/docs/guides/overview/auth/oauth). The person approves openGym on
 * openrouter.ai and comes back with a one-time code; that code plus the verifier made here buys an
 * API key of their own, billed to their OpenRouter credits. No client secret exists, nothing goes
 * through an openGym server, and the code is worthless without the verifier.
 *
 * Runtime-neutral (web crypto + an injected fetch): the browser's admin card and the phone use it. */
export const OPENROUTER_AUTH = 'https://openrouter.ai/auth';
export const OPENROUTER_KEYS = 'https://openrouter.ai/api/v1/auth/keys';
// The phone's way back: an https page on opengym.ch hands the code on to opengym://openrouter,
// which the system browser session catches (website/openrouter/index.html).
export const PHONE_CALLBACK = 'https://opengym.ch/openrouter/';
export const APP_RETURN = 'opengym://openrouter';

const b64u = bytes => {
  let bin = '';
  new Uint8Array(bytes).forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const random = (n, c = globalThis.crypto) => c.getRandomValues(new Uint8Array(n));

/** A fresh verifier (43 characters, RFC 7636), its S256 challenge, and a state for CSRF. */
export async function makePkce(c = globalThis.crypto) {
  const verifier = b64u(random(32, c));
  const challenge = b64u(await c.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  return { verifier, challenge, state: b64u(random(16, c)) };
}

/** The address to send the person to. Without a callback it is OpenRouter's headless mode: the
 *  code is shown on screen for the person to paste back, and the challenge is required. */
export function authUrl({ callbackUrl, challenge, state, keyLabel = 'openGym Coach' }) {
  const q = new URLSearchParams();
  if (callbackUrl) q.set('callback_url', callbackUrl);
  q.set('code_challenge', challenge);
  q.set('code_challenge_method', 'S256');
  if (keyLabel) q.set('key_label', keyLabel);
  if (state && callbackUrl) q.set('state', state);
  return `${OPENROUTER_AUTH}?${q.toString()}`;
}

/** What came back on the callback: { code } when it is the answer to our own request, else
 *  { error: 'state' | 'denied' | 'nocode' }. The state is checked when the redirect carries one;
 *  OpenRouter leaves it off a denial. */
export function readCallback(address, expectedState) {
  let q;
  try { q = new URL(address).searchParams; } catch { return { error: 'nocode' }; }
  const code = q.get('code');
  const state = q.get('state');
  if (q.get('error')) return { error: 'denied' };
  if (!code) return { error: 'nocode' };
  if (expectedState && state !== expectedState) return { error: 'state' };
  return { code };
}

/** A pasted code from headless mode: the bare code, or the whole callback address. */
export function pastedCode(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (/^https?:|^opengym:/i.test(s)) { const r = readCallback(s, null); return r.code || null; }
  return /^[A-Za-z0-9._~-]{8,512}$/.test(s) ? s : null;
}

/** Trades the code for the key. { ok, key } or { ok:false, error } in words a person can act on. */
export async function exchangeCode({ code, verifier, fetch: fetchImpl = globalThis.fetch }) {
  let res;
  try {
    res = await fetchImpl(OPENROUTER_KEYS, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' })
    });
  } catch (e) {
    return { ok: false, error: `could not reach openrouter.ai: ${String(e && e.message || e).slice(0, 120)}` };
  }
  let data = null;
  try { data = JSON.parse(await res.text()); } catch { /* not JSON */ }
  if (res.ok && data && typeof data.key === 'string' && data.key) return { ok: true, key: data.key };
  if (res.status === 403) return { ok: false, error: 'the sign-in code was refused or has expired (codes last 10 minutes); start again' };
  const msg = data && data.error && (data.error.message || data.error);
  return { ok: false, error: `${res.status || 'no answer'} ${typeof msg === 'string' ? msg.slice(0, 160) : 'from openrouter.ai'}` };
}
