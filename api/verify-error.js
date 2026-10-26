// @simplewebauthn reports an RP_ID or origin mismatch as an opaque "Unexpected ..." string, and
// whoever reads it in the browser has no way to connect that to their .env. A misconfigured
// RP_ID/ORIGIN is the single most common self-hosting failure (see docs/SELF_HOSTING.md), so
// name both values back. Neither is a secret: one is the address bar, the other its hostname.
const MISCONFIGURED = /unexpected (rp id|authentication response origin|registration response origin)/i;

export function verifyError(e, { rpId, origin } = {}) {
  const msg = String((e && e.message) || 'verification failed');
  if (!MISCONFIGURED.test(msg)) return 'verification failed: ' + msg;
  return `${msg}. This server is configured with RP_ID=${rpId} and ORIGIN=${origin}, and both `
    + 'must match the address you opened. See docs/SELF_HOSTING.md.';
}

// Whether a verify error is that misconfiguration, so the route can say so with a `code` the app
// turns into a sentence in the user's language.
export const isMisconfigured = e => MISCONFIGURED.test(String((e && e.message) || ''));

// The log line for a write refused by the origin check. tcmac lost a morning to a bare
// "origin=... expected=..." (Discord, 10-21): the usual cause is not an attack but an api service
// whose ORIGIN is not the address in the browser, so the line says which setting fixes it. Over
// plain http to a LAN address the browser sends no Sec-Fetch-Site (only trustworthy origins get
// one), and Origin is all there is to compare; when it is present the browser itself said the
// page is another site, and no ORIGIN fixes that. The Origin header is the caller's to choose,
// so it is printed escaped and cut short, never as a second line.
export function originHint(key, origin, expected, site) {
  const shown = origin == null ? '(none)' : JSON.stringify(String(origin).slice(0, 200));
  const head = `refused cross-origin ${key}: origin=${shown} expected=${expected}`;
  if (site) return `${head} (the browser says sec-fetch-site=${JSON.stringify(String(site).slice(0, 20))}: open the app at its own address, where the web service proxies /api, not from another site)`;
  let u = null;
  try { u = new URL(String(origin)); } catch { /* not an address, nothing to suggest */ }
  if (!u || !/^https?:$/.test(u.protocol) || u.origin !== String(origin).replace(/\/+$/, '')) return head;
  return `${head}. If ${u.origin} is where you open openGym, set ORIGIN=${u.origin} and RP_ID=${u.hostname} on the api service and restart it (docs/SELF_HOSTING.md)`;
}
