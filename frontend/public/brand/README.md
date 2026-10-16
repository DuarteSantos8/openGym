# Gains brand assets

The mark is a geometric G with a plate groove: a thin line runs inside the stroke and turns into the
crossbar, like the rim of a weight plate. It is monochrome. On the dark theme it is the light ink
(`--label`), on the light theme the dark one; the app icon is white on `#0c0b0a` (the app's dark `--bg`). The accent colour
is not part of the mark.

`icon.svg` is the one master: a full-bleed square, `#0c0b0a`, the white G drawn as two strokes (the
ring and bar, and the groove cut out of it) at the kit's numbers (radius 24, stroke 8.4, groove 25.2
and 1.1 wide, in a 100 box; the G spans the middle 56.4% of it, inside the maskable safe zone).
`frontend/resources/icon.svg` is a copy and a test keeps them identical. Everything else here is
rendered from it:

| File | What it is |
|---|---|
| `icon-180.png` | Apple touch icon (iOS draws its own corners, so full bleed) |
| `icon-192.png`, `icon-512.png` | manifest icons, purpose `any` |
| `icon-192-maskable.png`, `icon-512-maskable.png` | manifest icons, purpose `maskable`: full-bleed squares, never pre-rounded |
| `favicon.svg`, `favicon-32.png`, `favicon.ico` (48/32/16) | the tab icon, with rounded corners |
| `badge-96.png` | the status-bar badge of a notification: white G on transparent, as Android wants it; also the manifest's `monochrome` icon |

`manifest.json`, `index.html` (favicons, apple-touch-icon) and `sw.js` (notification icon and badge)
point at these files. The name and colours live in `frontend/src/brand.js`; the manifest and
`index.html` carry the same name and colour as plain text because they are read before any script runs.

`index.html` also draws the G itself, in the page's ink, inside `#root` until React renders the first
frame; `BootMark` (`src/components/BrandMark.jsx`) draws the same mark in the same place, so nothing
jumps between them. `scripts/brand-assets.py` renders every raster in the app and the native shells from
`icon.svg`; the native ones are listed in `docs/MOBILE.md`.

## In motion

- **Loader** (`src/components/Loader.jsx`, `lib/brand-motion.js`): the G draws itself along its stroke,
  holds, erases, again (2.4 s), on a canvas sized by CSS. `<Loading>` pairs it with its words; the kit's
  README says which to use where.
- **Splash** (`src/components/BootSplash.jsx`, `lib/brand-splash.js`): over the page at launch, the G
  already drawn (it is the still the first frame and the native launch image show), then "gains" arrives
  letter by letter, each settling into its weight. It ends when the animation is over and the app has read
  its state, then fades; a tap or Enter, Space or Escape ends it early. The page behind it is inert
  while it plays (the dialogs' counted hold, `holdPage()` in `lib/use-dialog-focus.js`). Once per page load. Not played for
  reduced motion (the device's setting or the app's switch) or without a canvas.
- Both draw in the CSS colour of their canvas, so they follow the theme with no prop. The letters are
  outlines (`lib/brand-glyphs.js`, 31 KB gzipped, from the kit; Jost, SIL OFL) loaded only when a splash
  is going to play.
