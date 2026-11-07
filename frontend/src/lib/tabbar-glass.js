// The floating tab bar on the iPhone (components/TabBar.jsx, Liquid Glass G1): where the glass
// lens sits, and when the bar shrinks to a small capsule while you scroll. Pure, so a unit test
// can pin the numbers.

export const MIN_AT = 24   // points scrolled down before the bar shrinks
export const EXP_AT = 12   // points scrolled up before it grows back
export const TOP_AT = 8    // this close to the top (or the bottom) the scroll position is not a gesture

// The lens as a transform of its full-size self (a tab slot less 4 px wide, the bar less 8 px high,
// at the bar's left and top edge): [x, y, scaleX, scaleY]. The bar is the screen minus 16 each side;
// four tab slots plus the 64 px Start slot between the second and third tab, 8 px padding. Shrunk, it
// is the inner pill of the capsule (116 wide, 126 at the large text size) and sits lower by what the
// bar lost in height.
export function lensBox({ screenW, tab, min, ax }) {
  const tw = (screenW - 112) / 4
  if (min) return [4, ax ? 18 : 12, (ax ? 56 : 52) / (tw - 4), (ax ? 50 : 44) / (ax ? 68 : 56)]
  return [8 + tab * tw + (tab > 1 ? 64 : 0) + 2, 0, 1, 1]
}

// One scroll event in, the bar's next shape out. `acc` is the distance travelled in the current
// direction. The last 8 px at the bottom are skipped: iOS reports the bounce back as scrolling up.
export function nextMin({ min, acc, y, last, scrollMax }) {
  if (y <= TOP_AT) return { min: false, acc: 0 }
  if (y > scrollMax - TOP_AT) return { min, acc }
  const d = y - last
  if (d * acc < 0) acc = 0
  acc += d
  const to = acc > MIN_AT ? true : acc < -EXP_AT ? false : min
  return { min: to, acc: to === min ? acc : 0 }
}
