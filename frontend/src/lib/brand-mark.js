// The Gains G as strokes, in the numbers the brand kit gives it (gains-logo.js GEO: ring radius 24,
// stroke 8.4, groove at 25.2 and 1.1 wide, in a 100 box with y up), written here with y down so they
// can go straight into an SVG path. components/BrandMark.jsx draws it still (and, animated in CSS, as
// the loader), lib/brand-motion.js draws the same G on the splash's canvas
// (brand-motion.test.js checks that they agree), and index.html carries a
// copy of the markup for the first frame, before any script runs.
export const MARK = {
  centre: 'M68.39 34.57A24 24 0 1 0 74 50H51',
  groove: 'M69.30 33.80A25.2 25.2 0 1 0 75.2 50V48.8H52.5',
  width: 8.4,
  grooveWidth: 1.1,
  // The G's own extent in the 100 box, so the SVG is cropped to the letter.
  box: '21.8 21.8 56.4 56.4',
}
