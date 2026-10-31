// openGym on a Zepp OS wrist: the app's dark look and lime accent (frontend/src/index.css), the
// Wear OS watch's tokens (frontend/android/wear/.../ui/Theme.kt), for small round AMOLED screens.
//
//   - Black is true black, not a tinted near-black: on AMOLED an off pixel costs no battery and
//     makes the bezel disappear (frontend-design: tinted near-black is a default, not a choice).
//   - One thing in lime per screen, the thing to press (frontend-design: spend boldness in one place;
//     design-taste-frontend: one accent, flat colour, no gradients, no glows, no shadows at rest).
//   - Numbers huge and bold, labels small and quiet, two sizes doing the work
//     (design-taste-frontend: "one very large, one small"; apple-design: hierarchy from weight + size).
//   - Quiet text #A1A1A6 is 8:1 on black, never below 4.5:1 (ui-ux-pro-max color-contrast).
//   - Tap targets 48 px or more on a 480 px screen, 8 px apart (ui-ux-pro-max touch-target-size,
//     touch-spacing), and everything kept inside the round safe area (safe-area-awareness).
export const C = {
  bg: 0x000000,
  lime: 0x30d158,
  limePress: 0x1f8a3a,
  onLime: 0x000000,
  tile: 0x1c1c1e,
  tileHi: 0x2c2c2e,
  text: 0xffffff,
  quiet: 0xa1a1a6,
  warm: 0xff9f0a,
  red: 0xff453a,
  track: 0x1f2a22,
}

// Type sizes in design pixels (480 wide): a number, a title, a label. Nothing in between.
export const T = { hero: 112, number: 72, title: 34, body: 28, label: 24 }

// The smallest a target may be (design pixels).
export const TAP = 56
