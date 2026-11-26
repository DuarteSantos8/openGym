/* User-initiated Open Food Facts previews. No profile persistence or background work.
 * The outbound contract and limits live in docs/superpowers/plans/EP-05-tasks.md. */
import https from 'node:https';
import net from 'node:net';
import { readFileSync } from 'node:fs';
import { createWindow } from './rate-limit.js';
import { guardedLookup, ipv6Groups, isAllowedPrivateAddr, isPrivateAddr } from './net-guard.js';

const VERSION = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;
const ORIGIN = 'https://world.openfoodfacts.org';
const FIELDS = 'code,product_name,brands,quantity,serving_size,nutrition';
const MAX_BYTES = 64 * 1024;
export class FoodLookupError extends Error {
  constructor(status, code, message, retryAfter) {
    super(message);
    this.status = status;
    this.code = code;
    if (retryAfter) this.retryAfter = retryAfter;
  }
}
const upstreamError = () => new FoodLookupError(502, 'food-lookup-upstream', 'Food lookup could not read the provider response');
const timeoutError = () => new FoodLookupError(504, 'food-lookup-timeout', 'Food lookup timed out');
const notFoundError = () => new FoodLookupError(404, 'food-lookup-not-found', 'Product not found');
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);

export function validateBarcode(value) {
  if (typeof value !== 'string' || !/^(?:[0-9]{8}|[0-9]{12,14})$/.test(value)) return false;
  let sum = 0;
  for (let i = value.length - 1, weight = 1; i >= 0; i--, weight = 4 - weight) sum += Number(value[i]) * weight;
  return sum % 10 === 0;
}

function text(value, max) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\p{Cc}\p{Cf}<>]/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, max).trim();
}

function servingOf(value) {
  if (typeof value !== 'string' || value.length > 160) return;
  // A prefix is permitted only when the numeric quantity is enclosed in parentheses.
  const exact = /^([0-9]+(?:[.,][0-9]+)?)\s*(g|ml)$/i.exec(value.trim());
  const parenthetical = /^[^()]*\(([0-9]+(?:[.,][0-9]+)?)\s*(g|ml)\)$/i.exec(value.trim());
  const m = exact || parenthetical;
  if (!m) return;
  const amount = Number(m[1].replace(',', '.')), unit = m[2].toLowerCase();
  if (!(amount > 0 && amount <= 10000)) return;
  return { label: `${amount} ${unit}`, [unit === 'g' ? 'grams' : 'millilitres']: amount };
}

function valueOf(n, unit, max) {
  if (!object(n) || n.unit !== unit || n.modifier != null || n.source === 'estimate') return;
  return typeof n.value === 'number' && Number.isFinite(n.value) && n.value >= 0 && n.value <= max ? n.value : undefined;
}

export function normalizeProduct(payload, barcode, now = Date.now()) {
  if (!validateBarcode(barcode) || !object(payload)) throw upstreamError();
  if (payload.status === 'failure' && payload.result?.id === 'product_not_found') return null;
  if (!['success', 'success_with_warnings'].includes(payload.status) || payload.result?.id !== 'product_found'
    || !object(payload.product)) throw upstreamError();
  const p = payload.product;
  // OFF can normalize leading zeros. Compare identity without changing the caller's string.
  if (typeof p.code !== 'string' || !validateBarcode(p.code) || p.code.padStart(14, '0') !== barcode.padStart(14, '0')) throw upstreamError();
  const set = p.nutrition?.aggregated_set;
  if (!object(set) || !['100g', '100ml'].includes(set.per) || set.preparation !== 'as_sold') throw upstreamError();
  const basis = set.per === '100g' ? 'g' : 'ml';
  const scale = basis === 'g' ? 1 : 2;
  const n = object(set.nutrients) ? set.nutrients : {};
  const per100 = { basis };
  const kcal = valueOf(n['energy-kcal'], 'kcal', 900 * scale);
  const kj = valueOf(n['energy-kj'], 'kJ', 900 * scale * 4.184) ?? valueOf(n.energy, 'kJ', 900 * scale * 4.184);
  if (kcal !== undefined) per100.energyKcal = kcal;
  else if (kj !== undefined) {
    per100.energyKcal = Math.round(kj / 4.184 * 1e6) / 1e6;
    per100.energyConversion = 'kJ/4.184';
  }
  for (const [field, upstream] of [['proteinG', 'proteins'], ['carbohydrateG', 'carbohydrates'], ['fatG', 'fat']]) {
    const v = valueOf(n[upstream], 'g', 100 * scale);
    if (v !== undefined) per100[field] = v;
  }
  const brand = text(p.brands, 120), quantityText = text(p.quantity, 80), serving = servingOf(p.serving_size);
  return {
    source: 'open-food-facts', externalId: barcode, label: text(p.product_name, 160) || barcode,
    ...(brand ? { brand } : {}), ...(quantityText ? { quantityText } : {}), per100,
    ...(serving ? { serving } : {}), fetchedAt: new Date(now).toISOString(),
    attribution: {
      text: 'Contains information from Open Food Facts, available under the Open Database License (ODbL).',
      url: `https://world.openfoodfacts.org/product/${barcode}`,
      license: 'ODbL-1.0', licenseUrl: 'https://opendatacommons.org/licenses/odbl/1-0/'
    }
  };
}

// Guard the DNS lookup used by the actual socket, not a separate preflight. Request all
// addresses even if Node asks for only one: mixed public/private answers fail closed.
function blockedAddress(address) {
  if (!net.isIP(address) || isPrivateAddr(address) || isAllowedPrivateAddr(address)) return true;
  // The shared guard also applies the push override recursively to embedded IPv4.
  // Recheck that address here so NAT64/6to4 cannot inherit a private push exception.
  const g = ipv6Groups(address);
  if (!g) return false;
  const v4 = (hi, lo) => blockedAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  if (g.slice(0, 5).every(x => x === 0) && [0, 0xffff].includes(g[5])) return v4(g[6], g[7]);
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every(x => x === 0)) return v4(g[6], g[7]);
  if (g[0] === 0x2002) return v4(g[1], g[2]);
  return false;
}

export function foodLookupDns(hostname, options, cb) {
  if (hostname !== 'world.openfoodfacts.org') return cb(upstreamError());
  guardedLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return cb(upstreamError());
    // ALLOWED_PRIVATE_IPS is a push/webhook override and must never open this adapter.
    if (!Array.isArray(addresses) || !addresses.length || addresses.some(a =>
      blockedAddress(a.address))) return cb(upstreamError());
    const selected = addresses.filter(a => !options.family || options.family === a.family);
    if (!selected.length) return cb(upstreamError());
    if (options.all) cb(null, selected);
    else cb(null, selected[0].address, selected[0].family);
  });
}

export function createFoodTransport({ request = https.request } = {}) {
  return (url, { headers, signal, connectTimeoutMs }) => new Promise((resolve, reject) => {
    const u = new URL(url);
    if (u.origin !== ORIGIN || u.username || u.password || u.hash) return reject(upstreamError());
    let req, timer;
    const clear = () => clearTimeout(timer);
    try {
      req = request(u, { method: 'GET', headers, signal, agent: false, lookup: foodLookupDns });
      // Covers DNS, TCP and TLS from the moment the request starts. No pooled sockets.
      timer = setTimeout(() => req.destroy(timeoutError()), connectTimeoutMs);
      req.on('socket', socket => socket.once('secureConnect', clear));
      req.once('error', err => { clear(); reject(err); });
      req.once('response', res => {
        clear();
        resolve({ statusCode: res.statusCode, headers: res.headers, body: res });
      });
      req.end();
    } catch (err) { clear(); req?.destroy(); reject(err); }
  });
}

export function createFoodLookup({ enabled = false, contact = '', transport = createFoodTransport(),
  now = Date.now, connectTimeoutMs = 2000, totalTimeoutMs = 5000,
  cacheMax = 128, cacheTtlMs = 15 * 60000, notFoundTtlMs = 60000,
  userMax = 5, instanceMax = 7 } = {}) {
  const users = createWindow({ max: userMax, windowMs: 60000, maxKeys: 1000, now });
  const instance = createWindow({ max: instanceMax, windowMs: 61000, maxKeys: 1, now });
  const cache = new Map();
  // Operator-owned contact only; no profile email or personal contact baked into source.
  const safeContact = typeof contact === 'string' && contact.length <= 120
    && /^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(contact) ? contact : '';
  const headers = { Accept: 'application/json', 'User-Agent': `openGym/${VERSION}${safeContact ? ` (${safeContact})` : ''}` };
  const limited = wait => { if (wait) throw new FoodLookupError(429, 'food-lookup-rate-limited', 'Food lookup limit reached', wait); };

  async function fetchProduct(barcode) {
    const controller = new AbortController();
    let body, expired = false, timer;
    const deadline = new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        expired = true;
        controller.abort();
        body?.destroy();
        reject(timeoutError());
      }, totalTimeoutMs);
    });
    const work = async () => {
      const response = await transport(`${ORIGIN}/api/v3.6/product/${barcode}?fields=${FIELDS}`, {
        headers: { ...headers }, signal: controller.signal, connectTimeoutMs
      });
      body = response.body;
      // A late injected/failed transport must not leave an orphan stream after the deadline.
      if (expired) { body?.destroy(); throw timeoutError(); }
      if (![200, 404].includes(response.statusCode)
        || (response.headers?.['content-encoding'] && response.headers['content-encoding'] !== 'identity')) throw upstreamError();
      let bytes = 0;
      const chunks = [];
      for await (const chunk of body) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buf.length;
        if (bytes > MAX_BYTES) throw upstreamError();
        chunks.push(buf);
      }
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const result = normalizeProduct(payload, barcode, now());
      if (response.statusCode === 404 && result !== null) throw upstreamError();
      return result;
    };
    try { return await Promise.race([work(), deadline]); }
    catch (err) {
      if (expired || err?.code === 'food-lookup-timeout') throw timeoutError();
      throw upstreamError();
    } finally {
      clearTimeout(timer);
      controller.abort();
      body?.destroy();
    }
  }

  return {
    publicConfig: () => ({ status: enabled === true ? 'configured-unverified' : 'disabled' }),
    async lookup({ uid, nutrition, barcode }) {
      if (typeof uid !== 'string' || !uid) throw new FoodLookupError(401, 'food-lookup-auth-required', 'Not signed in');
      if (enabled !== true) throw new FoodLookupError(403, 'food-lookup-disabled', 'Food lookup is not enabled on this server');
      if (nutrition !== true) throw new FoodLookupError(403, 'nutrition-disabled', 'Nutrition is not enabled for this profile');
      if (!validateBarcode(barcode)) throw new FoodLookupError(400, 'food-lookup-invalid-barcode', 'A valid GTIN barcode is required');
      limited(users.take(uid));
      const cached = cache.get(barcode);
      if (cached && cached.until > now()) {
        if (cached.product === null) throw notFoundError();
        return structuredClone(cached.product);
      }
      cache.delete(barcode);
      limited(instance.take('instance'));
      const product = await fetchProduct(barcode);
      for (const [key, entry] of cache) if (entry.until <= now()) cache.delete(key);
      // Concurrent replies for one barcode still occupy only one slot.
      cache.delete(barcode);
      if (cache.size >= cacheMax) cache.delete(cache.keys().next().value);
      cache.set(barcode, { product, until: now() + (product === null ? notFoundTtlMs : cacheTtlMs) });
      if (product === null) throw notFoundError();
      return structuredClone(product);
    }
  };
}
