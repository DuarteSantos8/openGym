# Plan: UI foundation (Gains frontend)

Source: core:refactor-planner, 2026-10-14. Saved by the main session. Repo `~/fitness/opengym`, main `eaabcefe`. Counts are from main on 2026-10-14; hex counts strip comments first. "Views" means `views/*.jsx`, tests excluded.

**Owner's goal:** make future UI changes in one place, not page by page, and catch architectural mistakes early.

**Gate decided: Option B, UI fork (owner, 2026-10-15).** The owner finds upstream's UI weak and will redesign it themselves. We no longer take upstream UI changes (views, sheets, components, CSS). We keep merging upstream `lib/`, `store/`, `api/` and backend fixes, and port a UI fix by hand only when it's wanted. Stages 4, 5 and 6 are unblocked.

## 0. Facts that shape the plan
| Fact | Evidence | Consequence |
|---|---|---|
| Page width now lives in the shell | #11 `eaabcefe`; `--page-w` index.css:97; `page-width.test.js` | Done. The Nutrition branches predate it and must merge main |
| Upstream is very active | 30 days of first-parent commits: 335 total, 70 on sheets.jsx, 45 on index.css. Non-merge commits since 09-14: Workout 135, Settings 104, Stats 42 | Every JSX edit in a hot file costs merge work. Gate those stages |
| The fork already differs from upstream on 83 UI files (+1611/−918) | `git diff --stat upstream/main origin/main` | Fork-owned: SubHeader, RootHeader, the TabBar rewrite, hubs, TodayCard, PlusSheet, LiveDock, tab-shell.css |
| Primitives are already widely used | Button 238, Row 162, Section 54, Switch 51, Stepper 43, Segmented 30, SubHeader 16, RootHeader 4 | Build on ui.jsx; no new UI library |
| CSS load order | App.jsx's CSS (tab-shell, coach, admin, FocusView) loads before `index.css` (main.jsx:3,8) | index.css wins ties, so new CSS loads **after** index.css |

## 1. Inventory
### 1a. Repeated markup (views + sheets.jsx, non-test)
| Pattern | Count | Examples | Replace with |
|---|---|---|---|
| `.card` | 38 (+4 in components) | Admin.jsx:176, :299 (inline borderColor), Stats.jsx:229, ProgressHub.jsx:19 | Card |
| `.card h2` header (`row between` + `h2 style={{margin:0}}`) | 28 h2 | Admin.jsx:177, :232, :315 | Card `title`/`action` |
| `.item` floating row (`.grow>.tt+.ss`, `.chev`) | 30 | Library.jsx:63, Admin.jsx:334, Workout.jsx:77 | ItemRow |
| `.lrow` built by hand instead of Row | 4, plus 24 `lrow-i` | Settings.jsx:724, Measurements.jsx:132, ProgressHub.jsx:22 | Row (exists) |
| `.tiles>.tile>.l+.v` | 26 tiles in 7 grids, with inline `fontSize` | Admin.jsx:111-114, AdminCoach.jsx:365, sheets.jsx:445 | Tiles, StatTile |
| `.big` value + muted unit | 4 | Home.jsx:76, Measurements.jsx:195 | Stat |
| `.empty>.ico` (+strong) | 17 (+6 in components), plus `adm-empty` 5, `chat-empty` 5 | History.jsx:28, sheets.jsx:384, FoodHub.jsx:10 | EmptyState |
| `h4.sec` section headers | 31 | sheets.jsx:338, Admin.jsx:150 | SectionTitle |
| Other header variants | adm-group-t 9, ob-h 8, ins-h 5, pcard-eyebrow 5, sect-t by hand 2 | CheckIn.jsx:237, sheets.jsx:2035 | SectionTitle / Section |
| `.tag` | 31 | sheets.jsx:996, :1105 | Tag |
| `.chip`/`.chips` | 27/15, plus mchip 6, adm-pill 20 | sheets.jsx:231, Library.jsx:92 | Chip / ChipRow |
| `.row`/`.row.between` flex utility | 99 | ProgressHub.jsx:20 | Inline |
| Sheet title `<h3>` | 48 in sheets.jsx, 91 overall | sheets.jsx:81, :326 | SheetHeader |
| Sheet footer (spacer + primary Button) | 29 | sheets.jsx:339-341 | SheetActions |

### 1b. The 713 inline styles (views + sheets.jsx; 121 more in components)
| Bucket | Views + sheets | In hot files* | Components | Becomes |
|---|---|---|---|---|
| Spacing literals | 301 | 202 | 49 | Stack/Inline `gap`, Spacer, `mb-N` |
| Spacer divs `height:N` | 102 | 67 | 42 | `<Spacer size>` (same DOM) |
| Layout (display/flex/align) | 118 | 86 | 11 | Inline / Stack props |
| Colour (`var(--*-ink)`) | 77 | 47 | 3 | `.ink-*` utilities, Card `tone` |
| Type (`fontSize`) | 67 | 41 | 3 | Stat `size`, `.small`, type tokens |
| Fixed size | 7 | 1 | 0 | class |
| Dynamic (must stay inline) | 37 | 21 | 13 | keep, auto-allowed |
| Other | 4 | 0 | 0 | class |

*Hot files: sheets.jsx, Workout, Settings, Stats, Plan, RoutineEdit. Together they hold 465 of the 713.

### 1c. CSS
- index.css 2,170 lines; tab-shell.css 111; coach.css 286; admin.css 155; FocusView.css 62.
- 61 custom properties.
- Hex values: 91 in theme blocks, 43 leaks (#fff/#000 on media, knobs, badges; one conic gradient; one mask) plus 1 in FocusView.css:15, and ~17 issue numbers in comments.
- 3 hex values in JSX, all legitimate.
- 4 `!important`.

## 2. Target primitives and tokens
The new files are fork-owned:
- `components/layout.jsx`
- `components/blocks.jsx`
- `components/sheet-layout.jsx`
- `src/ui-kit.css`, imported in main.jsx **after** `./index.css`

Every primitive emits **today's exact class names and element types**, so index.css stays the only source of styling and className-based tests keep passing.

| Primitive | Props | Emits / replaces |
|---|---|---|
| Page | title, sub, action, onBack, root, children | RootHeader (when `root`) or SubHeader, then the children in a fragment (no wrapper) |
| Stack | gap (1–10), as, className | `div.stack.g-N`; for new code only, never wrapped around `.lrow` |
| Spacer | size (1–10) | `div.sp-N`, the same DOM as today's spacer divs |
| Inline | gap, justify, align, wrap, as | `.row` / `.row.between` + `g-N` / `wrap` |
| Card | title, action, tone ('danger' or 'accent'), as | `.card` with its header row; `tone` replaces the inline borderColor |
| ItemRow | lead, title, subtitle, trailing, chevron, onClick (`tappable`) | `.item>lead+.grow>.tt+.ss+trailing+.chev` |
| Tiles, StatTile | label, icon, value, unit, size, onClick | `.tiles>.tile>.l+.v` |
| Stat | value, unit, size | `.big` + muted unit |
| EmptyState | icon, title, children | `.empty>.ico+strong+div` |
| SectionTitle | children, as='h4' | `h4.sec` |
| Tag | tone, icon, nocap | `.tag(.acc)(.nocap)` |
| Chip, ChipRow | on, nocap, onClick / children | `.chips>.chip(.on)` |
| SheetHeader | title, sub, onClose, action | `h3`, or `row between` + an xmark close button labelled `t('Cancel')` |
| SheetActions | children, gap | spacer + Button stack |

Tokens, in a `:root` block in ui-kit.css. The values equal today's px, so the mapping is exact.

| Group | Tokens |
|---|---|
| Space | `--space-1`…`--space-10` = 2, 4, 6, 8, 10, 12, 14, 16, 18, 22 px |
| Rhythm aliases | `--gap-list` = space-4, `--gap-row` = space-6, `--gap-block` = space-6, `--gap-section` = space-10 |
| Type | `--fs-caption` 12, `-footnote` 13, `-subhead` 15, `-callout` 16, `-body` 17, `-title3` 20, `-title2` 22, `-tile` 26, `-big` 30, `-large` 34; `--fw-regular` 400 … `-bold` 700 |
| Layout | `--page-w` (exists), `--pad` (exists), `--tap-min` 44px, `--row-min` 46px, `--item-min` 60px |
| Media | `--on-media` #fff, `--media-bg` #000, `--knob` #fff |
| Ink utilities | `.ink-danger`, `.ink-warn`, `.ink-orange`, `.ink-acc`, `.ink-ok`, mapped to the existing `--*-ink` tokens |

Snapping the spacing to a 4px grid or adopting a type scale is a later design call (ui-designer). By then it is a token edit, not a sweep across pages.

## 3. Guard tests (ratchet)
`src/ui-guards.test.js` reads the sources, like `page-width.test.js` does. The baseline is `src/ui-guards.baseline.json`, a `{file: count}` map regenerated by `frontend/scripts/ui-guards-baseline.mjs`. A guard fails only when a count **rises**, or when a file missing from the baseline has a count above 0. Only the orchestrator tightens the baseline, after each wave merges.

| ID | Rule | Baseline |
|---|---|---|
| G1 | Static inline style objects per file (any object containing an expression or a `--var` is auto-allowed) | 676 in views + sheets, ~108 in components |
| G2 | Hex in CSS outside `:root` theme rules; hex in JSX outside the allow-list | 44 in CSS / 3 in JSX |
| G3 | Hand-built className starting with card, item, tile(s), empty, lrow, `h4.sec`, tag or chip, outside the primitive files | per file |
| G4 | Every `<Route element>` view renders `<Page>`. Allow-list: Workout, FocusView, Login, MobileOnboarding | a list of unmigrated views that may only shrink |
| G5 | Markup equivalence: `renderToStaticMarkup(primitive)` equals the legacy markup | blocks.test.jsx, layout.test.jsx |
| G6 | Nothing outside `sheets.jsx` and `src/sheets/` imports `./sheets/*` (keeps the 68 `vi.mock`s valid) | 0 |
| G7 | New CSS files contain no hex and no `max-width` | 0 |

## 4. Stages
| # | Stage | Depends on | Agents | Done check |
|---|---|---|---|---|
| 0 | Guards G1–G4 and G7, plus the baseline script | none | 1 Sonnet | Green at baseline; a scratch inline style in a new view fails G1 |
| 1 | Tokens, ui-kit.css, layout/blocks/sheet-layout, G5, G6; `ui.jsx:479` `'Done'` → `t('Done')` | none | 1 Opus | G5 green for every primitive; no consumers changed; build passes |
| 2 | nutrition-home merges main and adopts the primitives (0 static styles, 0 hand-built markup) | 0, 1 | owner of that branch | Its new files pass G1 and G3 with no baseline entry |
| 3 | Wave A: fork-owned and low-churn files | 1 | 4 Sonnet in parallel | per batch |
| — | **Gate: decide on upstream UI tracking** (§5) | 3 | owner | decision recorded |
| 4 | Wave B: hot views, each started right after an upstream merge and merged within a day | gate | 3 Sonnet | per batch |
| 5a | Split sheets.jsx: a pure move into `src/sheets/*.jsx` plus `sheets/shared.js`; sheets.jsx keeps explicit named re-exports (no `export *`) | 2, gate | 1 Sonnet + Opus review | no test files changed; all 68 mocks pass; build passes; the dynamic import in store/useStore.js:1741 still resolves |
| 5b | Migrate the sheet domains | 5a | 4 Sonnet | per batch |
| 6 | Tokenise index.css (spacing literals, the hex leaks into media tokens) and designer-led snapping | gate = UI fork | 1 Sonnet + ui-designer | G2 CSS baseline goes from 44 to ~10 |

### Batches
| Batch | Files | Styles | Parallel with |
|---|---|---|---|
| A1 shell and hubs | Home, TodayCard, ProgressHub, TrainHub, History, Muscles, QueueRow, LiveDock, PlusSheet (not FoodHub) | 44 | A2–A4 |
| A2 progress | Measurements, CheckIn, ProgressPhotos, StructuralBalance, Library | 49 | A1, A3, A4 |
| A3 auth and onboarding | Login, MobileOnboarding, PasswordAuth, Passkeys, ErrorBoundary, CameraScan, QrCanvas | 111 | A1, A2, A4 |
| A4 admin and coach | Admin, AdminCoach, CoachSetup, CoachIntake, CoachChat | 129 | A1–A3 |
| B1 | Stats, Plan, LineChart, Heatmap | 80 | B2, B3 |
| B2 | Settings, ServerSync, WorkoutSettingsSheet, the ui.jsx spacers | 45 | B1, B3 |
| B3 | Workout, RoutineEdit, RestTimer, MuscleExplorer | 74 | B1, B2 |
| S1 | sheets/confirm-menu, starter, body-weight, import | 71 | S2–S4 |
| S2 | sheets/equipment, exercise, exercise-picker | 67 | S1, S3, S4 |
| S3 | sheets/exercise-config, plan | 74 | S1, S2, S4 |
| S4 | sheets/workout-detail, workout-flow | 87 | S1–S3 |

Done check for each batch:
- the full vitest suite is green;
- the batch's files reach 0 static styles under G1 (except listed odd px values) and 0 under G3;
- G4 passes for its route views;
- `git diff --stat` shows only the batch's files and their tests;
- every spacing literal maps to the token with the identical px value;
- reviewed by core:pr-reviewer.

Source-reading tests (Stats.test.js, CoachSetup.test.jsx, and the RoutineEdit/Plan/Library/Home/Settings/MobileOnboarding/Muscles checks) get rewritten as DOM assertions inside their own batch.

## 5. Blast radius and risks
| Risk | Mitigation |
|---|---|
| Upstream merge cost: hot files carry 465 inline styles, and sheets.jsx gets ~70 upstream commits a month | Gate before stages 4, 5 and 6. **Option A (track upstream UI):** stop after Wave A, and the ratchet freezes the hot files. **Option B (UI fork, recommended):** keep merging lib/, store/, api/ and the backend from upstream, and port upstream UI changes by hand. Under option A, a sheets split moves only the low-churn domains |
| CSS load order | Import ui-kit.css after index.css; it holds only single-class modifiers, applied only by primitives |
| Id specificity (`#app`, `#modal-root .list.ex-grid`, `#tabbar`) | Primitives never override id rules |
| Adjacency and `:has` selectors (`.lrow+.lrow::before`, `.lrow:has(.lrow-i)`, `.tag.nocap`) | Never wrap rows in Stack; G5 locks the DOM |
| `!important` (`.ex-grid .item .chev`) | Leave until stage 6 |
| Tests that select by className (item 73, lrow 51, lrow-t 35, chip 32, card 18, sub-hdr 16) | Same class names everywhere (G5) |
| 17+ tests parse index.css | New tokens go in ui-kit.css; index.css `:root` stays untouched until stage 6 |
| `vi.mock('../sheets.jsx')` in 68 test files | A permanent, explicit facade plus G6 (flagged: it is an explicit barrel) |
| Parallel conflicts | Batches touch disjoint files; the baseline, ui-kit.css and the primitives are edited by the orchestrator only |

## 6. Nutrition from day one
| Use | Instead of |
|---|---|
| `Page root` in FoodHub; `Page` on sub-pages | direct RootHeader/SubHeader |
| Card title/action for the Calories, Meals and Water cards | `.card` + `row between` + `h2` |
| ItemRow / Row for meal rows and activity rows | hand-built `.tt` / `.ss` / `lrow-i` |
| SheetHeader + SheetActions in their own files (never inside sheets.jsx) | spacer divs + `h3` |
| Stack/Inline gaps, `.ink-*`, `--macro-*` tokens | inline styles, new colour classes |
| EmptyState, Tag, Chip, StatTile | new `portion-*` / `meal-*` classes (only for genuinely new layout) |
| BwSheet `date` + Calendar `onPick` changes merged **before** stage 5a | — |

## Not verified
- The test suite was not run by the planner.
- CSS line references are approximate.
- Batch style counts include dynamic style objects.
- Only the 30-day churn figures are meaningful.
- Possible name collisions with upstream branches in flight are unchecked.
