import Icon from './Icon.jsx'
import { glyphOf } from '../lib/glyphs.js'
import { tileStyle } from '../lib/routine-colors.js'

// The routine's tile: its colour (the accent when it has none) and its icon.
export default function RoutineTile({ r, className = '' }) {
  return <span className={('lrow-i ' + className).trim()} style={tileStyle(r)}><Icon name={glyphOf(r?.emoji)} /></span>
}
