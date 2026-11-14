# EP-02 tasks and design note

Branch: `room/ep-02-design-foundation-sevy` (brief name `feat/ep-02-design`). Spec: `docs/superpowers/briefs/EP-02.md`.

## What the code already has (so we extend, not add)

`frontend/src/index.css` already defines: surfaces (`--bg`, `--surface`, `--surface-2/3`, `--bg-el`), one accent per theme (`--acc`, `--acc-ink`, `--acc-soft`, `--on-acc`, 8 accents, light variants), a type scale (`--fs-caption2` to `--fs-large`), radii (`--r-sm/--r/--r-lg/--r-xl/--r-card`), tabular numerals on `body`, a global `:focus-visible` ring (2.5px `--acc-ink`), a global `prefers-reduced-motion` rule, 44px hit areas, and shared `Section`/`Row`/`Button` in `components/ui.jsx`, `EmptyState`, `CardHead`.

## Token refresh (constrained)

| Area | Decision |
|---|---|
| Surfaces | No new colours. Cards use `--surface`; nested wells `--surface-2`. |
| Accent | One accent only: `--acc` / `--acc-ink`. Status uses icon + text, never colour alone. |
| Type | Existing `--fs-*` only. A metric value uses `--fs-large`, label `--fs-footnote` (the label is visually hidden on Home, where CardHead already says Body weight). |
| Numerals | Inherit `tabular-nums` from `body`. |
| Spacing/radius | `--pad`, `--r-card`. |
| Focus | Existing global ring; new controls add nothing. |
| New tokens | Only two additive: `--spring` (a CSS `linear()` easing, defined only inside `@supports`, no overshoot so the sheet never lifts off the bottom edge; engines without `linear()` keep the existing `--ease`) and `--skel` (shimmer base, mixed from `--surface-2`). Both defined in `:root`, so every theme and seasonal theme inherits them. |

## Files

- New: `components/MetricCard.jsx`, `Skeleton.jsx`, `ErrorState.jsx` (Skeleton and ErrorState are reusable primitives with no production caller yet, by design: Home uses MetricCard only.) Tests: one shared `components/primitives.test.jsx` (MetricCard, Skeleton, ErrorState and the existing EmptyState, Row, Section), `components/motion-scope.test.js`, `views/Home.metric.test.jsx`, `sheets.bwdelta.test.js`.
- Edit: `sheets.jsx` (`bwDeltaColor` gets an optional `ink` argument; old callers unchanged), `index.css` (additive rules), `views/Home.jsx` (Body weight header value uses `MetricCard`), `locales/*` (new strings, if any).
- Not touched: workout logic, store, routes, `lib/modules.js`, `lib/sync-merge.js`.

## Motion (CSS only, no `motion` dependency)

1. Bottom sheet: existing `sheetup` keyframes get the `--spring` easing.
2. `MetricCard` entrance fade/rise, 160 ms (reuses `viewfade`).
Both are removed by the existing `prefers-reduced-motion` rule, and a second explicit `@media` branch in the new rules. Set rows, rest timer and save are not animated; an interaction test checks a set tap works synchronously.

## Tests

Role, accessible name, keyboard, empty and error state per primitive; retry button fires once; a set tap in `Workout` is not behind any animation class. Existing Home tests stay untouched.
