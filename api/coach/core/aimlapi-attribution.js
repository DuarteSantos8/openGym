/* AI/ML API attributes a request to an integration by header, and a request without them is
 * served normally and counts for nobody — the failure is silent, which is why the host check
 * below is exact and why the tests cover the near-misses rather than only the hit.
 *
 * The gate is the destination host, not the provider id: `providerOptions.aimlapi.baseUrl` can
 * move this provider somewhere else, and any other provider's base URL can be pointed here.
 * A suffix test would hand the partner id to `api.aimlapi.com.example.net`, so it is equality.
 *
 * `HTTP-Referer` and `X-Title` are the OpenRouter convention most gateways already read; they
 * name openGym, not us.
 */
export const AIMLAPI_HOST = 'api.aimlapi.com';

const SOURCE = 'agent/opengym';
const REFERER = 'https://github.com/DuarteSantos8/openGym';
const TITLE = 'openGym';
/* Minted by AI/ML API, not chosen here. An unknown id is accepted upstream and dropped, so a
 * wrong value is indistinguishable from one that works; the test pins the format for that
 * reason, and tolerates an empty value so the constant can be cleared without a red build. */
export const AIMLAPI_PARTNER_ID = 'part_NUOhgEjKh3WMn1xpZx1E2foQ';

/** Whether `url` addresses the AI/ML API gateway itself. */
export function isAimlapiUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return false;
  try {
    return new URL(raw).hostname.toLowerCase() === AIMLAPI_HOST;
  } catch {
    return false;
  }
}

/** Attribution headers for the gateway; an empty object for every other endpoint. */
export function aimlapiHeaders(url) {
  if (!isAimlapiUrl(url)) return {};
  const headers = {
    'http-referer': REFERER,
    'x-title': TITLE,
    'x-aimlapi-source': SOURCE
  };
  if (AIMLAPI_PARTNER_ID) headers['x-aimlapi-partner-id'] = AIMLAPI_PARTNER_ID;
  return headers;
}
