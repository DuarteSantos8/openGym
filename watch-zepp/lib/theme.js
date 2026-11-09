// openGym on a Zepp OS wrist: the app's dark look and the brand's green accent (frontend/src/index.css,
// a new profile's accent since 1.4.5; the watch does not get the phone's own accent), the
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
  // The brand's green (#a3e635) and its pressed shade; it is light, so what sits on it is the
  // brand's near-black, 12.8:1 (ui-ux-pro-max color-contrast).
  lime: 0xa3e635,
  limePress: 0x7aad28,
  onLime: 0x0c0e12,
  tile: 0x1c1c1e,
  tileHi: 0x2c2c2e,
  text: 0xffffff,
  quiet: 0xa1a1a6,
  warm: 0xff9f0a,
  red: 0xff453a,
  track: 0x222b14,
  // The logo, never the accent (gym-app/assets/logo): the mark and "Gym" in brand green, "open"
  // in the lockup's light ink. The accent above is the UI's (the same green today); the logo stays the brand's.
  brand: 0xa3e635,
  brandInk: 0xeef1f6,
}

// Type sizes in design pixels (480 wide): a number, a title, a label. Nothing in between.
export const T = { hero: 112, number: 72, title: 34, body: 28, label: 24 }

// The smallest a target may be (design pixels).
export const TAP = 56
