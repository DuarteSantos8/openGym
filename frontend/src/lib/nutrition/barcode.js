import { NtApi } from './api.js'
import { offProduct } from './off.js'
import { useNutrition } from './store.js'

// A scanned or typed barcode, to the food it names. NutriTrace's order (Foods.svelte handleScan):
// your own foods first (a saved barcode needs no lookup), then Open Food Facts.

/** The code as a product code: 8 to 14 digits once spaces are gone, or null (a QR card, a word).
 *  A UPC-A (12 digits) becomes the EAN-13 Open Food Facts files it under, as NutriTrace does. */
export function normalizeBarcode(raw) {
  let code = String(raw ?? '').replace(/\s+/g, '')
  if (!/^\d{8,14}$/.test(code)) return null
  if (isUpcE(code)) code = upcEToUpcA(code)
  return /^\d{12}$/.test(code) ? '0' + code : code
}

// GS1 check digit: weights 3,1,3,1... from the right over the digits before it.
function checkOk(code) {
  const d = [...code].map(Number)
  const sum = d.slice(0, -1).reduceRight((s, n, i, a) => s + n * ((a.length - 1 - i) % 2 === 0 ? 3 : 1), 0)
  return (10 - (sum % 10)) % 10 === d.at(-1)
}

/** UPC-E (8 digits, number system 0 or 1) written out as the 12-digit UPC-A it compresses. */
export function upcEToUpcA(code) {
  const [ns, a, b, c, d, e, f] = code
  const tail = code[7]
  const body = { 0: a + b + f + '0000' + c + d + e, 1: a + b + f + '0000' + c + d + e, 2: a + b + f + '0000' + c + d + e, 3: a + b + c + '00000' + d + e, 4: a + b + c + d + '00000' + e }[f] ?? a + b + c + d + e + '0000' + f
  return ns + body + tail
}

// An 8-digit code is read as a UPC-E when it has number system 0 or 1 and a valid UPC-A check digit
// once expanded. GS1 does not issue EAN-8 codes starting 0 or 1 in practice, so a code that fits
// both is the UPC-E; one that fails the UPC-A check stays an EAN-8.
function isUpcE(code) {
  return /^[01]\d{7}$/.test(code) && checkOk(upcEToUpcA(code))
}

// A UPC saved as "0036000291452" matches a scan of "36000291452", and the other way round.
const stripZeros = code => String(code || '').trim().replace(/^0+/, '')

/** One of your foods with this barcode, or undefined. */
export function ownFoodWith(foods, code) {
  const want = stripZeros(code)
  return foods.find(f => f.barcode && stripZeros(f.barcode) === want)
}

/**
 * What a barcode is. Resolves to
 *   { kind: 'own', food }       one of your foods (logs without a lookup)
 *   { kind: 'online', food }    an Open Food Facts product, unsaved
 *   { kind: 'no-nutrition' }    Open Food Facts knows it but has no energy value to log
 *   { kind: 'miss' }            nobody knows this code
 * and throws an NtError when the lookup itself failed (offline, the proxy refused, ...), which is
 * not a miss: the caller says so and offers a retry.
 * @param {string} code a normalizeBarcode result
 */
export async function findByBarcode(code, { lang = 'en', signal } = {}) {
  const store = useNutrition.getState()
  if (store.foods.status !== 'ready') await store.loadFoods()
  const own = ownFoodWith(useNutrition.getState().foods.list, code)
  if (own) return { kind: 'own', food: own }
  let data
  try {
    data = await NtApi.lookupProduct(code, { lang, signal })
  } catch (e) {
    if (e?.status === 404) return { kind: 'miss' }
    throw e
  }
  const food = offProduct(data, code, lang)
  if (food === undefined) return { kind: 'miss' }
  if (food === null) return { kind: 'no-nutrition' }
  return { kind: 'online', food }
}
