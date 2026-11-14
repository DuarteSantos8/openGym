/* User-initiated Open Food Facts previews. No profile persistence or background work.
 * The outbound contract and limits live in docs/superpowers/plans/EP-05-tasks.md. */
export class FoodLookupError extends Error {
  constructor(status, code, message, retryAfter) {
    super(message);
    this.status = status;
    this.code = code;
    if (retryAfter) this.retryAfter = retryAfter;
  }
}
const upstreamError = () => new FoodLookupError(502, 'food-lookup-upstream', 'Food lookup could not read the provider response');
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
