# EP-05b independent frozen source review

Reviewed 2026-11-14 by independent Codex, without subagents.
Checkout: /code/openGym-fork/.worktrees/review-ep05b
Base: 7d9423bd
Frozen head: 385449e22d16cc76fee547d0df862ea1f0974b62

**Spec compliance: REQUEST CHANGES.** The stale-preview Save race violates the explicit invalidation requirement (I1). The other reviewed source behavior follows the approved contracts, subject to the evidence limits below.

**Task quality: REQUEST CHANGES.** I1 needs a synchronous validity check at persistence and a regression covering return-to-original transitions. M1 is a minor whitespace failure. No Critical finding. Counts: 1 Important, 1 Minor.

This verdict applies only to the frozen head. Parent has accepted I1 and sent it to the original implementer for round1 RED/GREEN and same-batch module/account/config regressions. The planned correction and EOF cleanup are not present in this checkout and are not approved by this report. Final whole-branch acceptance remains with the parent.

## Findings

### I1 — Important: Save can persist an invalidated preview before React commits the clear

Location: frontend/src/components/nutrition/FoodLookup.jsx:82, with the write at :87.
Related invalidation: :45 and :49; preview creation: :74.

Trigger:
1. Perform an explicit synthetic lookup and obtain the Save button.
2. In one synchronous batch, change Nutrition true -> false -> true, account one -> two -> one, or capability configured-unverified -> disabled -> configured-unverified.
3. Click the previously rendered Save button before React commits the queued preview clear.

Actual result: each of the three cases saves one nutrition entry; expected zero. I reproduced all three using the actual frozen FoodLookup component, actual Zustand store/update path, actual api wrapper, React act and happy-dom under Node v22.23.5. Fetch was replaced with a synthetic response, with zero actual network calls.

Cause: clear() increments generation.current synchronously but clears preview through React state. The old Save closure still has preview/input, and allowed() sees that the current owner/module/capability has returned to the original values. Save never compares the preview's generation with the current generation, so it persists a preview already invalidated by the lifecycle transition.

Impact: an obsolete product confirmation can write into the now-current diary despite the explicit rule that module/account/config changes invalidate preview and save. This reproduction does not establish a write into the different account while that account remains selected; it establishes the return-to-original race. The async response guard at :67 is present and is a separate mechanism.

Correction: attach the request generation to the accepted preview and require equality with generation.current immediately before creation/persistence, or maintain an authoritative preview ref cleared synchronously by every invalidation. Preserve the current owner/module/capability and duplicate-submit checks. Add RED/GREEN tests that perform each away/back transition and click the old Save in the same act callback, without awaiting a rerender between the changes and click. Retain normal-save and repeated-meal behavior.

Independent probe output (exit 0; printed observations, not a passing acceptance assertion):

```text
{"node":"v22.23.5","reason":"module off/on","entries":1,"expected":0}
{"node":"v22.23.5","reason":"account away/back","entries":1,"expected":0}
{"node":"v22.23.5","reason":"config disabled/configured","entries":1,"expected":0}
Synthetic fetch calls: 3; actual network: 0
```

### M1 — Minor: committed evidence logs fail the whitespace check

Locations:
- docs/superpowers/evidence/EP-05b/domain-green.log:9
- docs/superpowers/evidence/EP-05b/domain-red.log:41
- docs/superpowers/evidence/EP-05b/submit-red.log:28
- docs/superpowers/evidence/EP-05b/ui-green-attempt.log:9
- docs/superpowers/evidence/EP-05b/ui-green.log:9
- docs/superpowers/evidence/EP-05b/ui-red.log:33

Trigger/evidence: git diff --check 7d9423bd..385449e2 exits 2 and reports “new blank line at EOF” for these six files.

Impact: the submitted diff does not pass the required whitespace check; no runtime impact.
Correction: remove only the surplus EOF blank lines, retain substantive captured output and a final newline, then rerun the same check against the final review range. Parent reports cleanup is planned for final delivery.

## Spec compliance assessment

| Requirement | Source and test assessment |
| --- | --- |
| No lookup on open, typing, date, edit or reopen | FoodLookup.jsx:66 is the only new request site, called by explicit form submission. Input changes only invalidate state. EntrySheet/SourceSnapshot contain no transport. FoodLookup.test.jsx covers initial render, typing, late day/unmount results and offline reopen/reuse; no automatic retry was found. |
| Existing authenticated transport and opt-in | Uses api(), useStore.config, isOn and current user; no transport, API runtime or sync algorithm changes. Capability wording correctly says configured/unverified. Server nutrition refusal remains authoritative and explains waiting for normal sync. Standalone/signed-out/old-server/operator-disabled paths keep manual logging separate. |
| Strict barcode and basis | ASCII GTIN length/check digit preserves leading zeros. Response externalId must equal the submitted string. food-source.js accepts only g/ml basis and maps ml to canonical mL/amountMl. Package quantity never supplies basis or density. A serving is offered/scaled only for the matching explicit basis. |
| Unknown, zero and bounded arithmetic | Source numeric fields are finite, typed and bounded to the producer limits. Omitted fields stay absent; known zero is retained. Conversion uses servingAmount(), validates calculated totals up to 1,000,000 and rounds to the producer's three decimals. The existing formatNutrition helper remains in use; workout precision is unchanged. |
| Preview versus explicit single save | Preview/amount selection have no persistence. Save calls createEntry then the real update/addEntry path. UUID v4 allocation distinguishes repeated meals, and refs block duplicate saves/submits. This is subject to I1: a stale preview can still be confirmed within the invalidation batch. |
| Original provenance and snapshot | createEntry validates identity/hash consistency and creates a bounded deep copy. Canonical hash excludes fetchedAt, meal identity and local edits. editEntry's editable allowlist preserves provenance and sourceSnapshot. Recent-food creation forwards provenance/snapshot and gets a new UUID. |
| Durable source metadata | DATA_CONTRACTS names the one atomic sourceSnapshot field. The fixture and tests exercise JSON serialization, JSON/ZIP real backup reader/import, actual store stamps, edit, delete/undo, older-writer omission and merge retention. Existing producer merge/stamp mechanisms remain unchanged. |
| Safe offline attribution | SourceSnapshot validates before rendering, renders React text, and reconstructs product/license URLs from fixed origins and validated GTIN. Imported arbitrary URL schemes are ignored. Saved edit/reuse shows original attribution/fetch time without requesting catalogue data; malformed snapshot display is non-destructive. |
| Lifecycle races | Request generation/owner checks handle stale async results and effect cleanup handles day/unmount. Synchronous subscription observes owner/module/status changes, including away/back. Save lacks generation ownership: I1. |
| Preserve diary behavior and scope | Only thin Nutrition wiring plus targeted EntrySheet changes; manual entry remains independent. Existing normalization, undated filing, visible-entry projection, deletion semantics and malformed-row handling are retained. No dependencies, camera, image request, direct OFF fetch, API runtime, sync merger or unrelated navigation change. |
| Locales/accessibility/lazy loading | 25 added strings in all 19 locale files, with translated values. Inputs have labels; buttons, fields and source links have scoped 44px treatment; status/live-region and error primitives are used. Nutrition remains lazy via App.jsx:80. Actual browser accessibility and measured bundle delta remain pending. |

The three operator documentation changes (.env.example, docs/SELF_HOSTING.md, docs/INTEGRATIONS.md) are the parent-approved scope extension. They describe explicit preview/save, offline source retention, module sync and environment recreation. They are not unauthorized API/config changes.

## Task quality and RED/GREEN evidence

History confirms the plan before source:
- e0e28aee: confirmed file plan.
- 25dd8246: domain RED, followed by eb466d7d GREEN.
- 099dfe31: UI/single-submit RED, followed by 385449e2 GREEN.

The RED evidence is substantive but should be described precisely: the new domain/UI suites initially fail import because their implementation files do not yet exist. The creation seam also has an actual failed assertion (invalid source metadata was silently accepted), and the existing EntrySheet duplicate-submit test has an actual failure (2 entries instead of 1). These are not fabricated all-green “RED” claims.

Inspected committed log summaries:
- domain-green.log: 77 passed / 5 files.
- ui-green-attempt.log: 113 passed / 8 files.
- ui-green.log: 159 passed / 11 files.
These are author-run evidence, not independent reruns in this review. Logs retain counts/durations but not complete command/file-selection/environment transcripts, so they do not independently prove every required final gate.

The source tests check useful outcomes: g/ml and same-basis serving arithmetic, malformed values, fingerprint invariance/change, deep copy, immutable edits, distinct IDs, no passive calls, stable error categories, stale async responses, explicit save, duplicate submit, offline attribution and safe links. Real store/backup tests use the existing persistence and merger instead of a parallel implementation.

Coverage limit: the frozen component test hardcodes MOBILE=false and does not exercise a real standalone capability state, mL UI flow, config transition, or the same-batch away/back Save race. The interim report explicitly places additional standalone/ml/stale-save/hostile-snapshot tests outside this frozen head. They cannot count as reviewed coverage here. The inherited 409 retry test uses the earlier manual fixture; the new snapshot is tested through real stamps/merger and backup paths, but this frozen addition is not itself a complete snapshot-specific HTTP/browser sync journey.

## Evidence gaps and practical limits

These are pending evidence, distinct from I1/M1:
- Browser proof at 320/390/1280, light/dark, keyboard, reduced motion, explicit preview/save, offline reopen/edit and failure/manual fallback is not included in the frozen delivery. Author was still completing it.
- Build, locale and strict-source checks are reported passed by the interim handoff; the frozen evidence folder contains the six focused test logs, not their final evidence ledger or measured entry/lazy chunk deltas. Static lazy imports do not prove a measured bundle budget.
- Final frontend/API/MCP/generated combined gate is explicitly parent-owned and pending. Producer source-review passes are not final whole-branch acceptance.
- No real provider call was made; the 3/3 budget remains exhausted. No live availability, physical-phone, real-browser timing, all-language linguistic certification or production reliability claim is made.
- The race probe reproduces a synchronous React batching window; it does not claim an observed ordinary human gesture sequence with elapsed browser events.

Independent actions: read the approved brief, inherited common rules, producer briefs/plans/contracts and relevant runtime, task plan, interim report and review packet; inspected changed source/tests/locales/docs and commit history; ran git diff --check; ran the small offline probe below. No suite, production build, browser, server or install job. No helper agents, provider calls, exercise-media access, source/Git mutations, or changes to parent/author worktrees. The frozen worktree status remained clean. Only this verdict file was written.

The initial probe setup stopped on unavailable local esbuild/package resolution; the next setup stopped on Vite-only import.meta.glob. Neither reached a product assertion. The completed probe uses already-installed shared dependencies read-only, Node load hooks to transpile JSX in memory and replace Vite compile-time env/glob values for English web mode. It does not bundle or write transformed source.

## Reproducible independent probe

Run from the frozen checkout's frontend directory. The script performs only in-memory/localStorage-in-happy-dom operations, patches fetch before any explicit lookup, uses one native transform worker, and exits without leaving a process. It uses the actual frozen component, api wrapper and store. Existing installed dependencies are read from /code/openGym-fork/frontend/node_modules; project files are imported from the frozen checkout.

```bash
RAYON_NUM_THREADS=1 /home/cloudroom-agent/tools/node-v22.23.5-linux-x64/bin/node --input-type=module <<'NODE'
import { registerHooks, createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const req=createRequire('/code/openGym-fork/frontend/package.json');
const {transformSync}=await import(pathToFileURL(req.resolve('rolldown/utils')));
const {Window}=await import(pathToFileURL(req.resolve('happy-dom')));
const win=new Window({url:'http://localhost/'});
for(const key of ['document','navigator','localStorage','sessionStorage','HTMLElement','HTMLInputElement','Event','Storage','location']) Object.defineProperty(globalThis,key,{value:win[key],configurable:true});
globalThis.window=win;globalThis.matchMedia=win.matchMedia.bind(win);globalThis.IS_REACT_ACT_ENVIRONMENT=true;
registerHooks({
 resolve(spec,ctx,next){if(!spec.startsWith('.')&&!spec.startsWith('/')&&!spec.includes(':'))return {url:pathToFileURL(req.resolve(spec)).href,shortCircuit:true};return next(spec,ctx)},
 load(url,ctx,next){
 if(url.startsWith('file:')&&url.includes('/src/')&&/\.(jsx|js)$/.test(url)){
 let source=readFileSync(new URL(url),'utf8').replaceAll('import.meta.env','({})').replace(/import\.meta\.glob\([^)]*\)/g,'({})');
 if(url.endsWith('.jsx'))source=transformSync(url,source,{jsx:{runtime:'automatic'}}).code;
 return {format:'module',source,shortCircuit:true};
 }return next(url,ctx);
}});
const React=await import('react'),{act}=React,{createRoot}=await import('react-dom/client');
const {DEF,useStore}=await import('./src/store/useStore.js');
const {default:FoodLookup}=await import('./src/components/nutrition/FoodLookup.jsx');
const product={source:'open-food-facts',externalId:'012345678905',label:'Synthetic oats',per100:{basis:'g',energyKcal:200},fetchedAt:'2026-11-14T10:00:00Z',attribution:{text:'Open Food Facts',license:'ODbL-1.0'}};
let requests=0;globalThis.fetch=async()=>{requests++;return {ok:true,status:200,json:async()=>product}};
for(const reason of ['module off/on','account away/back','config disabled/configured']){
 localStorage.clear();useStore.setState({S:{...structuredClone(DEF),modules:{nutrition:true}},user:{id:'one'},config:{foodLookup:{status:'configured-unverified'}},ready:true});
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 await act(async()=>root.render(React.createElement(FoodLookup,{day:'2026-11-14'})));
 await act(async()=>{const el=host.querySelector('[name=barcode]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'012345678905');el.dispatchEvent(new Event('input',{bubbles:true}));});
 await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Lookup').click());
 const save=[...host.querySelectorAll('button')].find(b=>b.textContent==='Save');
 if(!save)throw Error('Missing preview: '+host.textContent);
 await act(async()=>{
 if(reason==='module off/on'){useStore.setState({S:{...useStore.getState().S,modules:{nutrition:false}}});useStore.setState({S:{...useStore.getState().S,modules:{nutrition:true}}});}
 if(reason==='account away/back'){useStore.setState({user:{id:'two'}});useStore.setState({user:{id:'one'}});}
 if(reason==='config disabled/configured'){useStore.setState({config:{foodLookup:{status:'disabled'}}});useStore.setState({config:{foodLookup:{status:'configured-unverified'}}});}
 save.click();
 });
 console.log(JSON.stringify({node:process.version,reason,entries:useStore.getState().S.nutritionEntries?.length||0,expected:0}));
 await act(async()=>root.unmount());host.remove();
}
console.log('Synthetic fetch calls: '+requests+'; actual network: 0');
await win.happyDOM.abort();process.exit(0);
NODE
```

