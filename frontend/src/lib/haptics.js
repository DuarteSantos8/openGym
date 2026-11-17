// A short tap for the routine drag: lift, drop, select. It rides the Vibrate switch and the buzz
// bridge in sound.js: navigator.vibrate on Android, the iPhone's haptic engine through
// RestAlertPlugin.buzz (the style picks the generator). Nothing on a browser that cannot buzz.
import { vibrate } from './sound.js'

const STYLE = { lift: 'light', drop: 'medium', select: 'selection' }

export function tick(kind) {
  vibrate(kind === 'drop' ? 18 : 10, STYLE[kind])
}
