import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Until the first GREEN this turns the missing implementation into an explicit assertion.
const food = await import('../food-lookup.js').catch(e => {
  if (e.code === 'ERR_MODULE_NOT_FOUND' && e.url?.endsWith('/food-lookup.js')) return {};
  throw e;
});
const call = (name, ...args) => {
  assert.equal(typeof food[name], 'function', `${name} must be implemented`);
  return food[name](...args);
};
const barcode = '3017620422003';
const at = Date.parse('2026-11-14T10:00:00Z');
const nutrient = (value, unit = 'g') => ({ value, unit, source: 'packaging' });
const product = (nutrients = {}, per = '100g', extra = {}) => ({
  status: 'success', result: { id: 'product_found' }, code: barcode, errors: [], warnings: [],
  product: { code: barcode, product_name: 'Test food', brands: 'Test brand', quantity: '100 g',
    nutrition: { aggregated_set: { per, preparation: 'as_sold', nutrients } }, ...extra }
});
const normalize = p => call('normalizeProduct', p, barcode, at);

test('GTIN accepts all four lengths and preserves leading zeros', () => {
  for (const s of ['96385074', '036000291452', barcode, '10012345000017', '00036000291452']) {
    assert.equal(call('validateBarcode', s), true, s);
  }
  const p = product(); p.code = p.product.code = '036000291452';
  assert.equal(call('normalizeProduct', p, '00036000291452', at).externalId, '00036000291452');
});

test('GTIN rejects wrong checksums, lengths, types, Unicode digits and URL fragments', () => {
  for (const s of [null, undefined, 36000291452, {}, ['96385074'], '', '96385075',
    '036000291453', '3017620422004', '10012345000018', '1234567', '123456789',
    '12345678901', '123456789012345', ' 96385074', '96385074\n', '00000000\n', '000000000000\r', '９６３８５０７４',
    '../96385074', 'https://example.com', '96385074?uid=x']) {
    assert.equal(call('validateBarcode', s), false, String(s));
  }
});

test('normalization returns only bounded preview fields with attribution and fetch time', () => {
  const r = normalize(product({ 'energy-kcal': nutrient(250, 'kcal'), proteins: nutrient(5),
    carbohydrates: nutrient(30), fat: nutrient(10) }, '100g', { image_url: 'https://evil.test/x',
    ingredients_text: 'secret', serving_size: '1 portion (25 g)' }));
  assert.deepEqual(r, {
    source: 'open-food-facts', externalId: barcode, label: 'Test food', brand: 'Test brand',
    quantityText: '100 g', per100: { basis: 'g', energyKcal: 250, proteinG: 5, carbohydrateG: 30, fatG: 10 },
    serving: { label: '25 g', grams: 25 }, fetchedAt: '2026-11-14T10:00:00.000Z',
    attribution: { text: 'Contains information from Open Food Facts, available under the Open Database License (ODbL).',
      url: 'https://world.openfoodfacts.org/product/3017620422003', license: 'ODbL-1.0',
      licenseUrl: 'https://opendatacommons.org/licenses/odbl/1-0/' }
  });
});

for (const value of [null, undefined, -1, '5', '', true, NaN, Infinity, 1e20]) {
  test(`omits invalid nutrient ${String(value)} without converting it to zero`, () => {
    const r = normalize(product({ proteins: nutrient(value), fat: nutrient(value),
      carbohydrates: nutrient(value), 'energy-kcal': nutrient(value, 'kcal') }));
    assert.deepEqual(r.per100, { basis: 'g' });
  });
}

test('missing nutrients remain absent; explicit numeric zero remains known', () => {
  assert.deepEqual(normalize(product()).per100, { basis: 'g' });
  assert.deepEqual(normalize(product({ proteins: nutrient(0) })).per100, { basis: 'g', proteinG: 0 });
});

test('kJ alone converts with stated provenance, but valid kcal takes priority', () => {
  const n = { 'energy-kj': nutrient(418.4, 'kJ') };
  assert.deepEqual(normalize(product(n)).per100, { basis: 'g', energyKcal: 100, energyConversion: 'kJ/4.184' });
  n['energy-kcal'] = nutrient(99, 'kcal');
  assert.deepEqual(normalize(product(n)).per100, { basis: 'g', energyKcal: 99 });
  assert.deepEqual(normalize(product({ energy: nutrient(418.4, 'kJ') })).per100,
    { basis: 'g', energyKcal: 100, energyConversion: 'kJ/4.184' });
});

test('explicit g/ml basis determines bounds, never package quantity', () => {
  const n = { proteins: nutrient(110), fat: nutrient(201), 'energy-kcal': nutrient(1000, 'kcal') };
  assert.deepEqual(normalize(product(n, '100g', { quantity: '250 ml' })).per100, { basis: 'g' });
  assert.deepEqual(normalize(product(n, '100ml', { quantity: '250 g' })).per100,
    { basis: 'ml', energyKcal: 1000, proteinG: 110 });
});

test('wrong units, qualifiers, estimates and computed-only nutrients remain unknown', () => {
  assert.deepEqual(normalize(product({ proteins: nutrient(5, 'mg'),
    carbohydrates: { ...nutrient(4), modifier: '<' }, fat: { ...nutrient(3), source: 'estimate' },
    'energy-kcal': { unit: 'kcal', value_computed: 50 } })).per100, { basis: 'g' });
});

test('hostile label fields become bounded control-free text and never objects', () => {
  const r = normalize(product({}, '100g', { product_name: '<b>\u0000 A\n\u202eB </b>' + 'x'.repeat(300),
    brands: 'z'.repeat(200), quantity: 'q'.repeat(200), serving_size: '<img onerror=x> (10 g)' }));
  assert.equal(r.label.length, 160); assert.equal(r.brand.length, 120); assert.equal(r.quantityText.length, 80);
  assert.doesNotMatch(r.label, /[<>\p{Cc}\p{Cf}]/u);
  assert.deepEqual(r.serving, { label: '10 g', grams: 10 });
  const empty = normalize(product({}, '100g', { product_name: {}, brands: null, quantity: [] }));
  assert.equal(empty.label, barcode); assert.equal(empty.brand, undefined); assert.equal(empty.quantityText, undefined);
});

test('servings parse only explicit positive g or ml without density or household guesses', () => {
  assert.deepEqual(normalize(product({}, '100ml', { serving_size: '250 ml' })).serving,
    { label: '250 ml', millilitres: 250 });
  for (const serving_size of ['1 cup', '1 oz', '0 g', '-1 g', '999999 g', '10 g or 20 g', '1e3 g', {}, null]) {
    assert.equal(normalize(product({}, '100g', { serving_size })).serving, undefined);
  }
});

test('unparseable shapes, absent basis, prepared values and wrong product fail safely', () => {
  for (const p of [null, [], {}, { status: 'success' }, product({}, 'serving'),
    product({}, null), product({}, '100g', { nutrition: {} }),
    product({}, '100g', { code: '96385074' }),
    product({}, '100g', { nutrition: { aggregated_set: { per: '100g', preparation: 'prepared' } } })]) {
    assert.throws(() => normalize(p), e => e.status === 502 && e.code === 'food-lookup-upstream');
  }
});

test('only the explicit v3 unknown-product shape is not found', () => {
  assert.equal(normalize({ status: 'failure', result: { id: 'product_not_found' }, code: barcode }), null);
  assert.throws(() => normalize({ status: 'failure', result: { id: 'internal_error', name: 'SECRET' } }),
    e => e.code === 'food-lookup-upstream' && !e.message.includes('SECRET'));
});

test('saved live v3.6 fixtures normalize with the same interface as synthetic responses', () => {
  for (const [code, expected] of [
    ['3017620422003', { basis: 'g', energyKcal: 539, proteinG: 6.3, carbohydrateG: 57.5, fatG: 30.9 }],
    ['5449000000996', { basis: 'g', energyKcal: 44, proteinG: 0, carbohydrateG: 10.9, fatG: 0 }]
  ]) {
    const payload = JSON.parse(readFileSync(new URL(`../../docs/superpowers/evidence/EP-05/fixtures/off-${code}.json`, import.meta.url)));
    const r = call('normalizeProduct', payload, code, at);
    assert.deepEqual(r.per100, expected);
    assert.equal(r.externalId, code);
    if (code === '5449000000996') assert.deepEqual(r.serving, { label: '330 ml', millilitres: 330 });
  }
});
