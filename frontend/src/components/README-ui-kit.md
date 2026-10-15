# UI kit

Build pages from these instead of hand-written markup and inline styles. Each primitive emits
today's classes and elements (locked by `layout.test.jsx`, `blocks.test.jsx` and
`sheet-layout.test.jsx`), so `index.css` stays the one source of styling. Spacing props are steps:
1…10 = 2, 4, 6, 8, 10, 12, 14, 16, 18, 22px, plus 2.5 = 5px; gaps may also be 0. A value the kit
has no class for throws in development. No primitive sets a page width: that is the shell's job.

| Instead of | Use (file) |
|---|---|
| `RootHeader` / `SubHeader` at the top of a routed view | `<Page root title sub>` (no action/onBack: it throws) / `<Page title sub action onBack>` (layout) |
| `<div style={{ height: 8 }} />` | `<Spacer size={4} />` (layout) |
| `<div className="row between" style={{ gap: 6 }}>` | `<Inline justify="between"\|"end" gap={3} wrap align="start"\|"end"\|"baseline"\|"stretch">` (layout) |
| a column of blocks with margins | `<Stack gap={6}>` (layout). Never around `.lrow` rows |
| `.card` + `row between` + `<h2 style={{ margin: 0 }}>` | `<Card title action tone="danger"\|"accent"\|"orange">` (blocks); tone draws a 1px ring |
| `.item > .grow > .tt + .ss`, `.chev` | `<ItemRow lead title subtitle titleClassName subtitleClassName trailing chevron onClick>` (blocks) |
| `.tiles > .tile > .l + .v` | `<Tiles><StatTile label icon value unit size="sm"\|"xs" tone className onClick /></Tiles>` (blocks) |
| `.big` + `<span className="muted" style={{ fontSize: '1rem' }}>` | `<Stat value unit size="sm">` (blocks) |
| `.empty > .ico` (+ `strong`) | `<EmptyState icon title>text</EmptyState>` (blocks) |
| `<h4 className="sec">` | `<SectionTitle>` (blocks) |
| `.tag(.acc)(.nocap)` | `<Tag tone="acc"\|"dim" icon nocap>` (blocks) |
| `.chips > .chip(.on)` | `<ChipRow ref><Chip on nocap onClick /></ChipRow>` (blocks); Chip is `type="button"` |
| hand-built `.lrow` | `<Row>` in a `<Section>` (ui.jsx) |
| sheet `<h3>`, or `row between` + xmark | `<SheetHeader title sub onClose action>` (sheet-layout) |
| spacer + primary Button (+ spacer + more) | `<SheetActions gap={4}>buttons</SheetActions>` (sheet-layout) |

An ItemRow with `onClick` is itself a `role=button`: give it no button, link or field inside (it
warns in development). Make the child the control and drop the row's onClick, or move it out.

## Tokens and utilities (`src/ui-kit.css`, loaded after `index.css`)

- Space `--space-1`…`--space-10`, `--space-2-5` (5px); rhythm `--gap-list` (8), `--gap-row` and
  `--gap-block` (12), `--gap-section` (22). Layout `--tap-min`, `--row-min`, `--item-min`.
- Type `--fs-caption` 12, `-footnote` 13, `-subhead` 15, `-callout` 16, `-body` 17, `-title3` 20,
  `-title2` 22, `-tile` 26, `-big` 30, `-large` 34; `--fw-regular|medium|semibold|bold`.
- Media `--on-media`, `--media-bg`, `--knob`: colours drawn over photos and video.
- Utilities: `.ink-danger|warn|orange|acc|ok`, `.stack`, `.g-N`, `.sp-N`, `.mb-N`, `.mt-N`, `.m-0`,
  `.fs-*`, `.fw-*`, `.ta-start|center|end`, `.wrap`, `.jc-end`, `.ai-*` (N: 0…10, 2.5). Each is
  written `.x.x.x` so it beats index.css class rules (`h4.sec`, `.sheet h3`, `.chip.on`);
  `ui-kit-cascade.test.js` checks every utility on every primitive's element. Id rules still win.
- An odd px or a computed value may stay inline; a new layout gets a class, never a new colour.

## Touch targets and sheets

- **44px to tap.** `--tap-min` is the floor. `Button size="sm"` (36px painted), `size="xs"` (about
  27px), `Chip`, icon buttons, help buttons and segmented buttons are painted at their own size and
  tapped over a centred `::before` that is never smaller than `--tap-min` either way (index.css, next
  to `.iconbtn`; `tap-targets.test.js` works the box out for each size). A control you add that is
  painted under 44px needs the same pseudo-element, not a bigger box. A chip in a scrolling `.chips`
  strip gets the same 44px: the strip is itself `--tap-min` tall with the chips centred, so the
  hit area fills the strip and never overflows it (an overflow would grow the strip's scroll height).
- **A sheet is a dialog.** Everything opened with `useUI.openSheet` gets `role="dialog"`,
  `aria-modal`, a name from its first heading (`SheetHeader`'s `<h3>`, or any `h1`-`h3`), focus on the
  sheet itself on open (never on a field: a phone raises its keyboard), Tab kept inside, the page
  behind it `inert`, Escape closing it unless it is locked, and focus back on what opened it
  (`lib/use-sheet-dialog.js`, `lib/use-dialog-focus.js`). Give a sheet a heading, or it has no name.
  A sheet that focuses a field itself keeps it. Stacked sheets work in any closing order: the one
  under a newer sheet is inert, and the page stays inert until the last closes. Content that is
  already a dialog (a photo viewer) keeps its own role and name and still gets focus in, the trap,
  the inert page and focus return; only content marked `data-own-dialog-focus` (the + sheet, which
  runs the trap itself) is left alone. A sheet that replaces another in the same tap
  (`close(); nextSheet()`) inherits the opener of the one it replaced.

## Guards (`src/ui-guards.test.js`, a ratchet)

Each file's count must equal `src/ui-guards.baseline.json`. Above it fails, and so does a new file
above 0. Below it also fails ("lower the baseline"): a migration PR runs
`node scripts/ui-guards-baseline.mjs` and commits its own files' entries. Never regenerate to hide a rise.

- **G1** literal-valued inline style properties, wherever they sit: in a ternary, a spread, a
  constant, a helper's return. A computed value or a `--custom-property` is free. A `style={x}`
  the guard cannot follow counts 1; a `style` prop passed through counts 0.
- **G2** colours (hex, `rgb()`/`hsl()`, names) in legacy CSS outside the theme `:root` rules, and
  in any `.js`/`.jsx`.
- **G3** classNames holding `card item tile(s) empty lrow tag chip(s) big row`, `h4.sec`, and `<h3>`
  however they are built (string, ternary, array, template, `cx()`). Not counted in primitive files.
- **G4** each routed component renders `<Page>`, itself or through a local component.
  Exempt: Workout, FocusView, Login, MobileOnboarding.
- **G5** each primitive's markup equals the legacy markup. **G6** only `sheets.jsx` and
  `src/sheets/` import `src/sheets/*`. **G7** a new stylesheet holds no colour (only `index.css`
  and `ui-kit.css` define colour tokens on `:root`), no `max-width` and no `max-inline-size`.
