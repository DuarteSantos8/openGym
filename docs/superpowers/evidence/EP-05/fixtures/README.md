# Open Food Facts v3.6 contract fixtures

Retrieved manually on 2026-11-14 with `User-Agent: openGym/1.4.4`,
`Accept: application/json`, 3 s connect / 8 s total timeout, no redirect following,
and 64 KiB response cap. Fixed URL:
`https://world.openfoodfacts.org/api/v3.6/product/<barcode>?fields=code,product_name,brands,quantity,serving_size,nutrition`.

| Request | Barcode | HTTP | Provider response Date |
| --- | --- | --- | --- |
| 1 | 3017620422003 | 200 | Sat, 14 Nov 2026 09:17:36 GMT |
| 2 | 5449000000996 | 200 | Sat, 14 Nov 2026 09:27:39 GMT |

Saved files retain code/status/result id and the requested name/brand/quantity/serving,
plus aggregation basis/preparation and the six consumed nutrient keys. Input sets,
other nutrients, names in diagnostics and other fields were discarded. No images or
image URLs were requested or saved. Tests read these local fixtures, never the service.

Both report `per: 100g`, `preparation: as_sold`. The second product is packaged in ml
and has a parsed ml serving; this does **not** authorize converting its per-100g
nutrients to per-100ml. `live-normalized.json` demonstrates normalization with a fixed
synthetic clock, not an asserted upstream retrieval timestamp.

Request 3 was a manual call through the actual `createFoodLookup` adapter for
3017620422003: successful in 498 ms with the production guarded HTTPS transport.
`../live-adapter.json` records the actual fetch time and normalized response.
**Total public product requests: 3. No further live requests authorized in this task.**

Contains information from [Open Food Facts](https://world.openfoodfacts.org), made
available under [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
Individual contents use the [Database Contents License](https://opendatacommons.org/licenses/dbcl/1-0/).
Product links: [3017620422003](https://world.openfoodfacts.org/product/3017620422003),
[5449000000996](https://world.openfoodfacts.org/product/5449000000996).
