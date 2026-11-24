// What the progress-photo camera asks the phone for (#1315). It used to ask for 1920 x 1920, and
// phones did what they were told: a square frame, shown as a square in the middle of the screen
// with the rest black, and saved square. A camera's own modes are 16:9 or 4:3, so the ask is a
// 16:9 frame the way the screen is held (portrait on a phone held upright), and only as an
// `ideal`: a camera that has no such mode gives its nearest one instead of failing. The fix
// follows Daniele Borgna's (@Borgna02) PR #1316, which stopped asking for a square.
// Pure, so the screen (components/PhotoCamera.jsx) can be tested without a camera.

/** Whether the screen is held upright: taller than wide. Unknown counts as upright, as a phone mostly is. */
export function portraitScreen(win = globalThis.window) {
  const w = win && win.innerWidth, h = win && win.innerHeight
  return !(w > 0 && h > 0) || h >= w
}

/** The getUserMedia constraints for the `facing` camera ('user' or 'environment'). */
export function cameraConstraints(facing, { portrait = portraitScreen() } = {}) {
  const long = 1920, short = 1080
  return {
    video: {
      facingMode: { ideal: facing === 'environment' ? 'environment' : 'user' },
      width: { ideal: portrait ? short : long },
      height: { ideal: portrait ? long : short },
    },
    audio: false,
  }
}
