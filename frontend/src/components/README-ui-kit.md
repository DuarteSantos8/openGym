# UI kit

Build pages from these instead of hand-written markup and inline styles. Each primitive emits
today's classes and elements (locked by `layout.test.jsx`, `blocks.test.jsx` and
`sheet-layout.test.jsx`), so `index.css` stays the one source of styling. Spacing props are steps:
1…12 = 2, 4, 6, 8, 10, 12, 14, 16, 18, 22, 24, 32px, plus 2.5 = 5px; gaps may also be 0. A value
the kit has no class for throws in development. No primitive sets a page width: that is the
shell's job.

| Instead of | Use (file) |
|---|---|
| `RootHeader` / `SubHeader` at the top of a routed view | `<Page root title action>` (a tab root: `title` is its hidden h1, `action` one context button; sub/heading/onBack throw) / `<Page title sub action onBack heading>` (layout; `heading` is a field standing in for the title) |
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

## Headers (`tab-kit.css`; a page never builds or styles its own, ui-guards G8)

- **Tab root** (`RootHeader.jsx`, from `<Page root>`): one pinned 56px row in the gutter,
  `[SearchPill] [context button] [AvatarButton]`, no visible title (the tab bar names the tab; the
  `title` is a `.sr-only` h1). A hairline fades in after 4px of scroll. It sits under the
  connection row (z 44); the search overlay lifts it to `--z-tab-hdr`.
- **SearchPill** (`scope` home|train|food|progress, `value`, `onChange(text)`, `onOpen`,
  `expanded`, `controls`): the real input (`role=combobox`, bearmenu's attributes), the tab's long
  placeholder where it fits the field and its short one where not (`lib/text-fit.js`, measured;
  re-measured on resize and locale change), a clear button, Escape clears. Focus calls `onOpen`
  for the overlay; with none it is a plain field. RootHeader reads the scope from the address.
- **AvatarButton** `mode="profile"|"close"` (`onClose`): 40px, the pill's surface, 44px to tap;
  close mode is the search overlay's close in the same spot, dot hidden.
- **Sub-page** (`SubHeader.jsx`, from `<Page>`): back · centred title (`--fs-title2` bold, two
  balanced lines) · at most two actions (a third throws). The title is centred while it fits and
  otherwise takes the room between back and the actions; where a word would break it steps down to
  20, then 17px (`useTitleFit`), hyphenated at the last step. `sub` centred under it; `children`
  (Page `heading`) is a field as the title, start-aligned; `sticky` pins it.

## The tab roots' blocks (the native redesign; look in `tab-kit.css`)

Built for the four tab restyles (fitness-eval `ui-redesign-components.md`; Owner decisions in
`redesign-native.md` override it). Each has behaviour tests (`date-nav.test.jsx`,
`tab-kit.test.jsx`, `line-art.test.jsx`, `blocks.test.jsx`, `ui.test.jsx`). A prop value with no
class throws in development, as everywhere in the kit.

| Component (file) | Props | What it is |
|---|---|---|
| `MonthBar` (date-nav) | `date onPickDate onToday` | The month as a button opening `calendarSheet` (the day picked goes to `onPickDate`); "Today" at the end, hidden but in place on today |
| `WeekStrip` (date-nav) | `date onSelect marks maxDate weekStart` | The week around `date`: selected (`--sel-fill`), today (`--acc-ink`, `aria-current=date`), a dot per `marks[iso]` (`done`/`plan`/`ovr`/`noted`), days after `maxDate` disabled. Swipe or arrow past an end for the next/previous week; the date does not change |
| `WeekDots` (date-nav) | `days:[{iso,done}] label` | A read-only week of dots, one `role=img` named by `label` or the count |
| `HeroStatus` (tab-kit) | `glyph eyebrow title\|value unit caption metrics status tone onRetry` | The tab's state, centred. `metrics` = two values split by a hairline. `status` loading (skeletons, `role=status`), error (caption + Try again), empty (a dash); `tone="over"` puts the caption in orange ink. Never a greeting |
| `ActionRow` / `ActionButton` (tab-kit) | `children` (2–4) / `icon label onClick disabled busy badge` | Equal columns of 56px discs with labels. No filled primary (Owner decision 7). `busy` = spinner + `aria-busy`; `badge` = a dot and its words in the name |
| `MacroGauge`, `MacroGauges` (tab-kit) | `macro value target unit label` | A 270° `role=meter` arc in `--macro-*`, start cap always drawn, "of 150 g", "+12 g" in orange ink over target; `MacroGauges` is the 3-column row |
| `SectionHeader` (tab-kit) | `title link onLink` / `title onOpen` | A tab root's `--fs-title2` heading with a text link, or one button with a chevron. `SectionTitle` stays the small grey one |
| `StatSection` (tab-kit) | `title onOpen art values footer status note onRetry` | A Progress card: the title + chevron is its one button; 1–2 values split by a hairline, an optional art lead and footer. No icon tile |
| `MediaRow` (tab-kit) | `art title subtitle link onOpen onPlay playLabel chevron variant="exercise"` | An `.item` led by 96×72 art (56px thumb in the exercise variant). With a `link` line or `onPlay`, the title block opens it and each control is its own button |
| `StickyActionBar` (tab-kit) | `children` | The page's one main pill, sticky above the tab bar (`--tabbar-h`), resting at the end of the page |
| `LineArt` (line-art) | `scene state` | `routine {days,next,scheduled}`, `mobility {minutes}`, `scale {kg}`, `equipment {eq}` (`equipmentOf(ex.eq)`). Two strokes, three inks (`--acc-graphic` for data), no figures, ≤8 paths; draws in once a session (`useDrawIn`), fades under reduced motion; `aria-hidden` |
| `EmptyState` (blocks) | + `art action secondary` | `art` replaces the icon; `action`/`secondary` are `{label, onClick, icon}` pills. Without them the markup is unchanged |
| `InlineNote`, `Skeleton` (blocks) | `icon children` / `w h r` | A quiet centred status line; a hidden loading block at its size (numbers are px) |
| `Button` (ui) | + `shape="pill"` | 44px, `--r-pill`, sized to its label (`.btn-pill`) |
| `Segmented` (ui) | + `tone="strong"` `size="lg"` | The selection fill for page sub-views and the Progress range; 36px buttons. The subtle default stays for in-card ranges |
| `Row` (ui) | + `glyph`, `accessory="add"` with `onOpen onAdd addLabel` | A bare 24px lead icon; a + disc of its own ("Add to {title}") with the text opening the row, the row itself no button |

## Tokens and utilities (`src/ui-kit.css`, loaded after `index.css`)

- Space `--space-1`…`--space-12`, `--space-2-5` (5px); rhythm `--gap-list` (8), `--gap-row` and
  `--gap-block` (12), `--gap-section` (22), `--gap-tab-section` (32, between a redesigned tab
  root's sections). Layout `--tap-min`, `--row-min`, `--item-min`, `--r-pill`.
- Type `--fs-caption` 12, `-footnote` 13, `-subhead` 15, `-callout` 16, `-body` 17, `-title3` 20,
  `-title2` 22, `-tile` 26, `-big` 30, `-large` 34, `-display` 48; `--fw-regular|medium|semibold|bold`;
  tracking `--ls-display`, `--ls-title`.
- Sizes `--hdr-h` 56 and `--hdr-btn` 40 (the headers), `--disc` 56 and `--disc-sm` 36 (action and
  add discs), `--glyph` 24, `--art-w`×`--art-h` 96×72 (a media row's art), `--thumb-lg` 56,
  `--tabbar-h` (what the tab bar takes from the bottom, measured: 63px, 81px from 1000px),
  `--search-panel-w`; layers `--z-search` 47, `--z-tab-hdr` 48. Line art `--il-w`, `--il-w-d`.
  Motion `--ease-io`, `--hero` (640ms).
- Colour tokens, in `index.css`'s theme blocks: `--sel-fill`/`--on-sel` (a selected day or
  segment: the label colour as a fill), `--bar-bg`, `--ring-hair`, `--gauge-track`, `--scrim`,
  `--skel`/`--skel-sheen`, `--shadow-thumb`, `--shadow-float`, and `--acc-graphic` (the accent as a
  line-art stroke; a custom accent sets it in `lib/accent.js`). `accent.test.js` measures
  `--acc-graphic` (3:1 on every fill a scene sits on) and `--on-sel` (7:1) for every preset and
  own colour. No component reads a hue: fills use `--acc`/`--on-acc`, text `--acc-ink`, line art
  `--acc-graphic`.
- `--r-card` is 16px (was 14): every card, list card and tile.
- Media `--on-media`, `--media-bg`, `--knob`: colours drawn over photos and video.
- Utilities: `.ink-danger|warn|orange|acc|ok`, `.stack`, `.g-N`, `.sp-N`, `.mb-N`, `.mt-N`, `.m-0`,
  `.fs-*`, `.fw-*`, `.ta-start|center|end`, `.wrap`, `.jc-end`, `.ai-*` (N: 0…12, 2.5). Each is
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
  however they are built (string, ternary, array, template, `cx()`). Not counted in primitive files
  (`PRIMITIVE_FILES`: blocks, layout, sheet-layout, ui, and the redesign's date-nav, line-art,
  tab-kit).
- **G4** each routed component renders `<Page>`, itself or through a local component.
  Exempt: Workout, FocusView, Login, MobileOnboarding. The baseline is empty.
- **G5** each primitive's markup equals the legacy markup; a deliberate design change (the tab-root
  header, 2026-10-15) changes the fixture with a comment saying so, never by regenerating it.
  **G6** only `sheets.jsx` and `src/sheets/` import `src/sheets/*`. **G7** a new stylesheet
  (`ui-kit.css`, `tab-kit.css`, `nutrition.css`, …) holds no colour (only `index.css` and
  `ui-kit.css` define colour tokens on `:root`), no `max-width` and no `max-inline-size`, not even
  in a media query.
- **G8** no page chooses its own header: nothing past `layout.jsx` imports `RootHeader`/`SubHeader`,
  no view builds `.hdr`/`.tab-hdr`/`.sub-hdr` (the full-screen views excepted), and `<Page>` takes
  no `className` or `style`. Width is the shell's too (`page-width.test.js`). Not a ratchet: it is 0.
