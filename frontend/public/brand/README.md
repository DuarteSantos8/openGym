# Gains brand assets

The icons here are a **temporary placeholder** (the letter G on the dark background). They are all
rendered from one file, `icon.svg`.

To ship the designer's final icon:

1. Replace `icon.svg` with the master (square, full bleed, keep the artwork inside the centre 80%
   so the maskable crop does not clip it). A 1024x1024 PNG works too: render from that instead.
2. Re-render the three PNGs from `frontend/public/brand/`:

   ```bash
   rsvg-convert -w 180 -h 180 icon.svg -o icon-180.png
   rsvg-convert -w 192 -h 192 icon.svg -o icon-192.png
   rsvg-convert -w 512 -h 512 icon.svg -o icon-512.png
   ```

3. For the native app icon and splash, copy the master over `frontend/resources/icon.svg` and run
   `npx @capacitor/assets generate` (docs/MOBILE.md).

`manifest.json`, `index.html` (favicon and apple-touch-icon) and `sw.js` (notification icon) point
at these three PNGs, so nothing else changes. The name, colours and links live in
`frontend/src/brand.js`; the manifest and `index.html` carry the same name and colour as plain text
because they are read before any script runs.
