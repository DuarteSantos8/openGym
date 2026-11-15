# EP-05a implementation contract and tasks

Approved scope: `briefs/EP-05a.md` and `briefs/WAVE-2-common.md`; server lookup only.
Read the inherited common documents. Node v22.23.5, Linux, assigned branch
`room/ep-05a-codex-implementation-wfhg`. No new dependency, UI, persistence or deployment.

## Confirmed upstream contract (read 2026-11-14)

- [API introduction](https://openfoodfacts.github.io/openfoodfacts-server/api/):
  v3 recommended, v2 deprecated; product reads limited to **15/minute/IP**.
  Custom app/version User-Agent required; read calls need no account credential.
  The API usage form is an operator follow-up before enabling. Tests use injected
  transport; manual confirmation only, maximum three public product reads in this task.
- [v3 reference](https://openfoodfacts.github.io/openfoodfacts-server/api/ref-v3/)
  and its [source](https://github.com/openfoodfacts/openfoodfacts-server/blob/main/docs/api/ref/api-v3.yaml):
  pin `https://world.openfoodfacts.org/api/v3.6/product/{barcode}`; fixed query
  `fields=code,product_name,brands,quantity,serving_size,nutrition`.
  Status is a string with `result.id`, not v2's numeric `status`.
- [Change log](https://openfoodfacts.github.io/openfoodfacts-server/api/ref-api-and-product-schema-change-log/):
  v3.5 changed nutrition, v3.6 changed tags. The reference introduction still says
  v3.4; use the pinned schema and the actual v3.6 response, not that stale heading.
- [Nutrition schema](https://github.com/openfoodfacts/openfoodfacts-server/blob/main/docs/api/ref/schemas/product_nutrition_v3.yaml)
  and [properties](https://github.com/openfoodfacts/openfoodfacts-server/blob/main/docs/api/ref/schemas/product_nutrition_properties.yaml):
  `nutrition.aggregated_set` has normalized `nutrients`, explicit `per: 100g|100ml`,
  and `preparation`. Read only `as_sold`, never infer density from quantity or serving.
  Each nutrient has numeric `value`, `unit`, optional `modifier` and source.
- [Licence guide](https://openfoodfacts.github.io/openfoodfacts-server/api/tutorials/license-be-on-the-legal-side/),
  [terms source](https://github.com/openfoodfacts/openfoodfacts-web/blob/main/lang/en/texts/terms-of-use.html),
  [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/): attribution to Open Food
  Facts and licence link are required; product-specific attribution links to the product.
  Database ODbL; individual contents Database Contents License. No images requested or returned.
  The terms page and wiki returned bot protections; read the official terms source instead.
  Future stored snapshots must retain source, product link, licence and fetch time. Public
  derivative databases carry ODbL share-alike/access obligations; private use does not
  itself require publishing a diary. Do not treat AGPL code as licensing the OFF data,
  and do not expand this into a republished combined catalogue without licence review.
  No term identified forbids this bounded attributed read-only lookup.

## Exact interfaces for EP-05b

`GET /api/food-lookup?barcode=<string>`: existing cookie/bearer session required.
Only one query key and one barcode allowed. GTIN 8/12/13/14 ASCII digits plus valid
mod-10 check digit. Keep the input string (including zeros) as `externalId`.
Operator `FOOD_LOOKUP=1|true|yes|on` (case insensitive) and the latest stored
`modules.nutrition === true` both required. No frontend flag or query can authorize.

200 returns the product directly:

```js
{
  source: 'open-food-facts', externalId: '3017620422003', label: 'Nutella',
  brand: 'Ferrero, Nutella', quantityText: '400 g e', // optional
  per100: { basis: 'g', energyKcal: 539, proteinG: 6.3, carbohydrateG: 57.5, fatG: 30.9 },
  serving: { label: '15 g', grams: 15 }, // optional; alternatively millilitres
  fetchedAt: '<ISO UTC>',
  attribution: {
    text: 'Contains information from Open Food Facts, available under the Open Database License (ODbL).',
    url: 'https://world.openfoodfacts.org/product/3017620422003',
    license: 'ODbL-1.0', licenseUrl: 'https://opendatacommons.org/licenses/odbl/1-0/'
  }
}
```

`validateBarcode(value)` returns boolean. `normalizeProduct(payload, barcode, nowMs)`
returns that product, null for an explicit product-not-found response, or throws a
stable FoodLookupError. No image URLs or upstream diagnostic text passes through.
Labels/brand/quantity are plain text, Unicode controls/format characters removed,
HTML delimiters removed, whitespace normalized and capped at 160/120/80 characters.
An empty label falls back to the validated barcode. `serving_size` is accepted only
as an entire numeric g/ml value (or that value in a single trailing parenthesis);
return a canonical numeric label, not unbounded upstream free text. No household-unit
guessing. Missing/invalid basis or preparation is 502 rather than fabricated units.
Numeric strings, null, negatives, non-finite values, wrong units, modifiers and
estimated sources are omitted. Numeric zero stays zero. Macro maxima: 100 g per
100 g, 200 g per 100 ml; energy maxima 900/1800 kcal respectively. Prefer explicitly
stated kcal; otherwise valid kJ / **4.184**, rounded to 6 decimal places, with
`per100.energyConversion: 'kJ/4.184'`. No `value_computed` fallback.

Signed-in `GET /api/config` adds `foodLookup: {status: 'disabled'|'configured-unverified'}`.
Signed-out config omits it. This is server setup discovery only, no probe, timestamp,
or connectivity claim. User module gate is independent and checked each lookup.
Standalone phones have no server and no lookup. EP-05b must show the attribution,
ask for an explicit lookup action, use errors below, and save only after confirmation.

Errors are `{error: <fixed safe message>, code: <stable code>}`:
401 `food-lookup-auth-required`; 403 `food-lookup-disabled` or `nutrition-disabled`;
400 `food-lookup-invalid-barcode`; 404 `food-lookup-not-found`;
429 `food-lookup-rate-limited` with integer `Retry-After`;
502 `food-lookup-upstream`; 504 `food-lookup-timeout`.

## Security and bounded behavior

- `createFoodLookup({enabled, contact, transport, now, ...bounds})` owns per-process
  cache/rates; `lookup({uid, nutrition, barcode})` gates before transport/cache access.
  Only internal wiring/tests inject transport/bounds; no request controls them.
- Outbound: GET to the fixed origin/path/query above, `Accept: application/json`,
  `User-Agent: openGym/<api/package.json version>` plus optional validated operator
  `FOOD_LOOKUP_CONTACT` in parentheses. No uid, profile, cookie, auth, client headers,
  tracking identifier, body or configurable target. Server IP and request time are
  necessarily visible to OFF. No automatic retries, prefetch, schedule or disk cache.
- Use Node HTTPS with `agent: false`, `guardedLookup` from `api/net-guard.js` at
  connection time, forcing all DNS answers then choosing only from that validated set.
  Reject private/mixed/empty/invalid DNS, including addresses explicitly allowed for
  unrelated integrations by `ALLOWED_PRIVATE_IPS`. Fixed HTTPS host checked again
  by the transport; no redirect following.
- Connect deadline 2 s (DNS/TCP/TLS included), total deadline 5 s including headers
  and stalled body. Stream at most 64 KiB before JSON parsing, abort and destroy
  bodies on error/timeout. No content-length trust and no compressed response support.
- Reuse `createWindow`: 5 calls/user/60 s (including cache hits), 7 outbound calls per
  instance/61 s. This conservative window allows at most 14 across a boundary in
  60 s, below the documented 15/IP/minute. Shared NAT/multiple replicas need operator
  coordination; no distributed limit is claimed. Bounded user map of 1000 keys.
- Cache at most 128 normalized results, insertion-order eviction; positive TTL 15 min,
  not-found TTL 60 s. Errors never cached. Gates checked again for cache hits. Cache
  contains public product data only and dies with the process. No availability probe.

## Confirmed files and milestones

1. Commit this plan before source changes.
2. RED/GREEN normalization: `api/test/food-lookup.test.js`, `api/food-lookup.js`.
   Cases: all GTIN lengths/check digits/zeros, invalid numbers and strings, kJ,
   explicit g/ml, hostile text, serving, malformed/mismatched/not-found shapes.
3. RED/GREEN adapter in those files plus test fixtures: fixed outbound request,
   private/mixed/rebinding DNS, redirect/non-200/truncation/stream cap, connect/total
   timeout including stalled body, cache hit/expiry/size, user and instance rates,
   concurrent attempts and no outbound with either switch off.
4. RED/GREEN actual HTTP: `api/test/food-lookup-http.test.js` and test-only preload
   `api/test/food-lookup-transport.mjs`, `api/server.js` limited route/config wiring.
   Throwaway DATA_DIR, synthetic signed sessions, injected HTTPS request, no real
   external network. Cover 401/403 each/400/404/429/502/504/200, profile reread,
   cookie/bearer, exact outbound headers and no state writes.
5. `api/openapi.yaml`, generated `website/api.html`; `.env.example`,
   `docs/SELF_HOSTING.md`, `docs/INTEGRATIONS.md`, `helm/values.yaml` (already lists
   integrations env). Compose uses env_file so needs no change; Kubernetes no explicit
   integrations switch to mirror. Evidence/fixtures/logs under `docs/superpowers/evidence/EP-05/`.
6. Targeted tests at each GREEN. Final suites serial: frontend `npm test -- --maxWorkers=2`,
   build, locale/source checks; API `node --test --test-concurrency=2 test/*.test.js`;
   MCP `npm test -- --maxWorkers=2` as an extra regression check; all three generators.
   Browser QA not applicable: no UI or frontend change. Actual HTTP is the user path.
7. Self-review diff, parent-managed independent Codex review, pull --rebase origin
   next/integration before each branch-only push; draft PR using repository template.

## Execution ledger

- Final Node 22 checks: frontend 7,917/7,917 (661 files), API 911/911 (9 suites),
  MCP 140/140 (6 files), production build, locale/source checks and all three
  generators pass. Full commands, exits, first-run failure and logs are in
  `../evidence/EP-05/README.md`. No runtime edit after `176b1698`.
- Minimal additional test path: `api/test/server-config-session.test.js` expected
  the complete signed-in config object without the new capability. First full API
  run failed exactly that assertion (910/911). Updated expected disabled key and
  pinned FOOD_LOOKUP off; kept exact signed-out privacy assertion. Full rerun 911/911.
- Self-review complete: scope, privacy, fixed outbound fields, DNS override isolation,
  stream deadlines, cache/rates, strict numeric/basis semantics, image packaging and
  generated docs checked. No remaining blocking runtime finding identified.
  Parent source pass and 16 offline probe groups reported green on `176b1698`;
  fresh independent Codex review remains pending, not approved by this report.

- Parent approved adding `food-lookup.js` to `api/Dockerfile`'s explicit COPY list.
  Existing `api/test/dockerfile-copy.test.js` reused: 1 pass/1 fail before the COPY
  addition, then GREEN with route tests. No duplicate manifest test, no Docker available.
- Normalization RED `632adddd` (0/20), GREEN `fbd291b6` (20/20).
  Adapter RED `16f49bff` (0/24), GREEN `0b93c184` (44/44 including normalization).
- Extra DNS regression RED `dd8bbaa3` exposed NAT64 inheriting a global IPv4 push
  override. GREEN `13b3b325` (44/44) rechecks embedded IPv4 for mapped/NAT64/6to4.
- Route RED `1f28611e`: 0/12 actual HTTP tests (missing route). GREEN `176b1698` targeted run
  passes 62/62 including normalization, adapter, HTTP, Docker COPY and OpenAPI checks.
- First two manual public requests both HTTP 200: 3017620422003 and 5449000000996.
  Both upstream aggregations explicitly report **100g**, even the 330 ml drink; do not
  guess a volume basis. Fixtures are selected fields only, without images, under
  `../evidence/EP-05/fixtures/`. Automated tests never request the live service.
- Third/final manual request used the actual adapter and guarded HTTPS transport:
  successful in 498 ms for 3017620422003. Total public product requests **3/3**.
- These commit ids reflect the required rebase onto integration `2efd92da` before
  the first push. Two inherited orchestrator docs commits (`be267053`, `9e35f366`)
  precede task plan `57cc27c1`; parent will integrate only task commits and exclude
  duplicate orchestration docs. This implementer never edited `progress.md`.

- Plan inspection complete. First manual public request used (3017620422003): HTTP 200,
  v3.6 `status: success`, `result.id: product_found`, as_sold/100g aggregation.
  Trimmed image-free fixture will preserve just the selected product fields/nutrients.
- Ruling: brief overrides outline Task 4 and skill delegation/workspace conventions;
  no UI, subagents or progress.md edits. This file and evidence carry the ledger.
- Pre-flight: normalization output feeds cache and HTTP unchanged; config is independent
  of module consent and never performs a lookup. No cross-task interface conflict.
