# EP-05b: confirm a food lookup into the diary

Status: producer source reviews passed; exact interfaces confirmed below. Implementation starts
only in the parent's assigned worktree containing both producers and the analytics corrections.
Final full-suite acceptance is consolidated into the parent's combined gate, not yet passed.
Status: dependent design prepared by parent; **do not start implementation until the parent
names reviewed EP-04 and EP-05a commits and confirms their exact interfaces below**.

Read `WAVE-2-common.md`, `EP-04.md`, `EP-05a.md`, `docs/product/DATA_CONTRACTS.md` and the
producer implementation plans/evidence. This is EP-05 Task 4, not a second nutrition module.
The user authorized Codex-only work and the cloud prerequisite exception. No new dependency,
camera permission, background request, service credential, or external food library.

## Outcome

From the enabled diary, a signed-in user on a configured server can type a barcode, choose
Lookup, inspect the product and its missing data, choose an amount, and explicitly save a
snapshot as an ordinary diary entry. The manual entry path works offline and with lookup off.
Opening the diary, rendering a barcode, choosing a day, or editing an existing meal must never
look up a product. Reopening an entry never refreshes its nutrients from the catalogue.

## Reviewed producer interfaces

The implementer verifies these against the assigned checkout before committing its task plan:

- EP-04 runtime `0ac5cbc8` after rebase onto470defb7. Its29 non-locale source/test files are
  byte-identical to independently reviewed runtime `fe22da11`/test head `a1639383`; each of
  19 locale packs differs only by three already-integrated Stats strings. Parent independently
  verified both statements. Source and correction spec/quality reviews passed; full gate pending.
- EP-05a final `c976b963`, runtime `176b1698`, independently reviewed spec/quality PASS.
  Already in integration470defb7. Route/capability/error contract is listed below.
## Interfaces to confirm before dispatch

The parent fills these from the reviewed producers, and the implementer verifies them against
the checkout before committing its task plan:

- EP-04 commit, create/edit action and validation interface: pending review.
- EP-05a commit, lookup route, capability key, response and error codes: pending review.
- Persisted source metadata: use EP-04's creation-only provenance seam. Any additional saved
  snapshot fields must be named, documented in DATA_CONTRACTS and covered by round-trip tests.
- Use the existing `api()` wrapper (`frontend/src/lib/api.js`) for the authenticated request;
  it already supports paired mobile servers, subpaths, timeouts and typed response failures.
- Reuse `useStore.config` for capability information; configuration means configured/unverified,
  never a claim that the external service is reachable.

### Exact producer interfaces and consumer rulings

These are confirmed against the reviewed producers. Preserve their established behavior.

- Diary `createEntry(input, context)` accepts input `label`, `day`, `meal`, `amount`,
  `unit: 'g'|'mL'|'serving'`, `servingLabel`, `servingSize`, `servingUnit: 'g'|'mL'`, and optional
  entry-total `energyKcal`, `proteinG`, `carbohydrateG`, `fatG`. Context supplies immutable
  `source`, `externalId`, `contentFingerprint`, optional `now`/`timeZone`. Save through
  `update(s => addEntry(s, record))`. Numeric bounds are 0..1,000,000 and three decimals;
  serving size must be positive. `servingAmount()` converts explicit serving counts only.
- Reuse `lib/nutrition/format.js` for locale-aware three-decimal display. Workout weight
  precision must not change food amounts or round a known small nutrient silently to zero.
- Saved fields use `amountMl` and serving unit `mL`; API basis is lowercase `ml`. Map explicitly.
  `editEntry()` preserves unknown fields and provenance. The global EntrySheet captures its
  account owner and rechecks module/owner on render and save; preserve these guards.
- EP-05a direct preview: `source: 'open-food-facts'`, `externalId`, `label`, optional `brand`
  and `quantityText`, `per100: {basis: 'g'|'ml', energyKcal?, proteinG?, carbohydrateG?, fatG?,
  energyConversion?: 'kJ/4.184'}`, optional `serving: {label, grams}` or `{label, millilitres}`,
  `fetchedAt`, `attribution: {text, url, license: 'ODbL-1.0', licenseUrl}`.
- `/api/config.foodLookup.status` is `disabled` or `configured-unverified`, absent while
  signed out/older server. GET `/api/food-lookup?barcode=...` accepts one ASCII GTIN with
  valid check digit and length8/12/13/14. Keep leading zeros.
- Error body codes: 401 `food-lookup-auth-required`; 403 `food-lookup-disabled` or
  `nutrition-disabled`; 400 `food-lookup-invalid-barcode`; 404 `food-lookup-not-found`;
  429 `food-lookup-rate-limited`; 502 `food-lookup-upstream`; 504 `food-lookup-timeout`.
  The existing `api()` wrapper exposes HTTP codes under `error.data.code`, transport codes
  under `error.code`, and overwrites caller abort signals with its own timeout controller.
  Use request generations/owner checks for stale responses without rewriting shared transport.
- Reuse existing `lib/sha256.js` for fingerprinting; it supports insecure local HTTP through
  an existing pure-JS fallback. No new crypto dependency. Hash canonical bounded source values,
  excluding `fetchedAt` and user edits. Preserve the original hash on local corrections.
- Authorize one explicit atomic `sourceSnapshot` field containing the validated bounded
  preview (including original nutrients/basis, fetchedAt and attribution), distinct from editable
  entry totals. Extend the creation context/prefill seam minimally, document this field in
  DATA_CONTRACTS and add contract/backup fixtures. Deep-copy the snapshot at creation; later
  preview mutation must not affect stored entries. Existing-entry edits and recent-food reuse
  must preserve the snapshot and provenance. Do not store raw upstream payloads.
- Validate stored source metadata before rendering. Construct product and license links from
  the fixed supported source/validated barcode; never trust arbitrary imported URL schemes.
  Show source attribution when reopening offline, not only in the original lookup preview.
- Server opt-in reads synced `modules.nutrition === true`. A newly enabled local switch may
  not have reached the server yet. Keep its 403 authoritative and explain retry after normal
  sync; do not introduce a consent-bypass flag or passive request to work around this.
- Live product request budget is exhausted (3/3). Every EP-05b test/browser response must use
  synthetic fixtures at the transport boundary. The two live samples both explicitly say100g,
  including a330mL drink; package quantity must never determine nutrient basis.

## Bounded behavior

1. Lookup is hidden with Nutrition off. Standalone phones, signed-out users, older servers and
   disabled operators have a clear unavailable state and retain manual entry. User opt-in and
   server authorization remain authoritative. Do not store live availability in `S`.
2. Before the first explicit lookup, show that the barcode goes through this server to Open
   Food Facts. Do not send the meal, diary, profile, account identity or image to the provider.
   No direct browser fetch to Open Food Facts. No autocomplete/network-on-keystroke behavior.
3. Show bounded label, brand/quantity if supplied, basis, known nutrients, unknown values,
   fetched time and required attribution. Avoid medical, diet or allergen-safety claims.
   Do not render provider HTML, URLs, images or raw error text.
4. Allow grams for a g-based product and millilitres for an ml-based product. A provider serving
   can be offered only when its conversion to that same basis is explicit. Never assume mL=g.
   Compute nutrient totals with the producer's serving helpers; retain unknowns as omitted and
   zero as known. Validate amount and calculated bounds before save.
5. Choosing a product or amount is a preview, not persistence. Save creates exactly one manual
   eating event with UUID v4, immutable source/external ID/content fingerprint and original
   snapshot metadata. Repeated meals are distinct events; block a duplicate submit in flight.
6. The content fingerprint hashes bounded canonical product data, excluding fetch time and
   local corrections. It describes the source, not meal identity. Edits to the saved entry
   preserve its provenance; subsequent catalogue changes never rewrite it.
7. Clear obsolete results when the barcode changes. A late response after another lookup,
   module disable, account change or navigation must not replace the current preview or save
   anything. No automatic retry; a retry is another explicit user action.
8. Stable local messages distinguish invalid barcode, unknown product, login/module/operator
   refusal, rate limit, provider failure, timeout and offline. None blocks manual logging.

## Implementation and evidence

- Commit `docs/superpowers/plans/EP-05b-tasks.md` with confirmed file map, exact interfaces,
  data fields and fixture arithmetic before source changes.
- Pure conversion/fingerprint helpers under `frontend/src/lib/nutrition/`, tests beside them.
  UI under `components/nutrition/`, thin wiring in `views/Nutrition.jsx`; extend store actions
  only if the existing seam demonstrably cannot express creation safely.
- RED then GREEN for g/ml scaling, explicit serving conversion, unknown/zero/invalid values,
  unchanged provenance on edit, distinct meal identity and single-submit behavior.
- Component tests prove zero lookup calls before a click, configured/disabled/standalone
  states, stale-result handling, every stable error category and explicit save only.
- Persist through the real store and backup reader; reopen saved snapshot offline, delete,
  undo and re-import without catalogue access. Use producer sync hooks, not a second merger.
- Browser flow at 320/390/1280 px, dark/light, keyboard and reduced motion: open with no
  outbound lookup, manually request synthetic product, preview/save, offline reopen and edit,
  failed lookup with manual fallback. Mock provider responses only at the transport boundary;
  label mocked checks honestly. Do not consume extra live provider requests by default.
- All new strings go in every locale, with genuine translations. Run source-string/locale
  checks, focused regressions and production build. Parent owns the single final full
  frontend run (one worker) on the reviewed combined candidate, plus API/MCP and generated
  checks. Do not duplicate those full runs in this task; handoff stays conditional until that
  exact runtime passes. This overrides the common brief's duplicate full-suite requirement.
  checks, focused regressions, full frontend once at final handoff and production build.
  API/MCP suites only if their code/shared imports change. Parent runs combined final gates.
- Evidence under `docs/superpowers/evidence/EP-05b/`; report lazy chunk and entry delta. No
  licensed exercise media in AI-visible captures. Stop owned servers and tabs after checks.

## Authorized scope and completion

Nutrition helper/component/view files and tests, relevant locale keys, contract documentation
and fixtures for explicitly named source-snapshot fields, task plan and evidence. Do not alter
API behavior or shared sync rules unless a demonstrated interface defect is returned to its
producer and reviewed. No unrelated navigation changes.

Completion requires an independent review, explicit save in the browser, truthful missing
values and basis, no passive outbound request, durable offline snapshot/provenance, and green
required checks. Push only the assigned branch and open a draft PR; do not merge or deploy.
