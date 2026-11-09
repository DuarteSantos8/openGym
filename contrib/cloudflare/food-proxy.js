// /api/food/*: the food diary's lookups (frontend lib/food.js), made here instead of in the
// browser. Open Food Facts is free and slow at times; going through the Worker gives:
//   - an edge cache, so a product or a search asked once is answered from Cloudflare after that
//     (and does not count against Open Food Facts' limit of about 10 searches a minute)
//   - a timeout and a second try on each upstream, and two search backends
//     (search.openfoodfacts.org first, fast but no CORS, so only usable from here; the classic
//     cgi/search.pl after it)
//   - the User-Agent Open Food Facts asks apps to send, which a browser cannot set
//
//   GET /api/food/product/<barcode>  -> { product } or 404
//   GET /api/food/search?q=<text>    -> { products }  (Dutch products first, then all countries)
//
// ponytail: open to anyone who can reach the site; the edge cache keeps the cost down. Put it
// behind the session check if it is ever abused.
const UA = 'openGym-selfhosted/1.0 (https://gym.petervaleria.com)';
const OFF = 'https://world.openfoodfacts.org';
const FIELDS = 'code,product_name,product_name_nl,product_name_en,brands,nutriments,serving_quantity';
const DAY = 86400;

const json = (body, status = 200, maxAge = 0) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': maxAge ? `public, max-age=${maxAge}` : 'no-store' },
});

/** fetch with a timeout and one more try on a network error, a timeout, a 429 or a 5xx. */
export async function getJson(url, fetchFn = fetch, ms = 8000) {
  let last;
  for (let i = 0; i < 2; i++) {
    try {
      const res = await fetchFn(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(ms) });
      if (res.ok) return await res.json();
      if (res.status === 404) return null;
      last = new Error(`upstream ${res.status}`);
      if (res.status !== 429 && res.status < 500) break;
    } catch (e) { last = e; }
    if (i === 0) await new Promise(r => setTimeout(r, 400));
  }
  throw last;
}

export async function product(code, fetchFn) {
  const body = await getJson(`${OFF}/api/v2/product/${code}.json?fields=${FIELDS}`, fetchFn);
  return body && body.status === 1 && body.product ? { ...body.product, code } : null;
}

export async function search(q, fetchFn) {
  const fast = async nl => {
    const u = new URLSearchParams({ q: nl ? `${q} countries_tags:"en:netherlands"` : q, langs: 'nl,en', page_size: '25', fields: FIELDS });
    return (await getJson(`https://search.openfoodfacts.org/search?${u}`, fetchFn, 6000))?.hits || [];
  };
  const classic = async nl => {
    const u = new URLSearchParams({ search_terms: q, json: '1', page_size: '25', fields: FIELDS, lc: 'nl' });
    if (nl) u.set('countries_tags_en', 'netherlands');
    return (await getJson(`${OFF}/cgi/search.pl?${u}`, fetchFn, 10000))?.products || [];
  };
  for (const backend of [fast, classic]) {
    try {
      const nl = await backend(true);
      return nl.length ? nl : await backend(false);
    } catch (e) { console.error('food search backend failed:', e?.message); }
  }
  throw new Error('every search backend failed');
}

/** The /api/food/* answer, from the edge cache when it has one. */
export async function handleFood(request, ctx, { fetchFn = fetch, cache = globalThis.caches?.default } = {}) {
  if (request.method !== 'GET') return json({ error: 'method' }, 405);
  const url = new URL(request.url);
  const hit = cache && await cache.match(request);
  if (hit) return hit;
  let res;
  try {
    const code = url.pathname.match(/^\/api\/food\/product\/(\d{6,14})$/)?.[1];
    if (code) {
      const p = await product(code, fetchFn);
      res = p ? json({ product: p }, 200, 7 * DAY) : json({ error: 'not found' }, 404, DAY);
    } else if (url.pathname === '/api/food/search') {
      // Same characters lib/food.js strips: the fast search reads a query language.
      const q = String(url.searchParams.get('q') || '').replace(/[":()[\]{}]/g, ' ').trim().slice(0, 80);
      res = q.length < 2 ? json({ products: [] }) : json({ products: await search(q, fetchFn) }, 200, DAY);
    } else return json({ error: 'not found' }, 404);
  } catch (e) {
    return json({ error: 'upstream' }, 502);
  }
  if (cache && res.status !== 502) ctx?.waitUntil?.(cache.put(request, res.clone()));
  return res;
}
