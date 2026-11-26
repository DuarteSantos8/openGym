// The Ironvane mark is a square-cut IV on a 284×174 grid. Ironvane orange is a brand colour,
// not the user's accent: the lockup stays itself when the accent changes. Never mirrored in RTL.
import { APP_NAME } from '../lib/brand.js'
import './BrandLogo.css'

const MARK_PATHS = [
  'M0 0h46v174H0z',
  'M68 0h64l44 112L220 0h64l-76 174h-64z',
]
const BRAND_COLOR = '#ff6b2c'

/** The mark alone, `height` px high (width follows, 284:174). `color` only for a one-colour use. */
export function BrandMark({ height = 24, color = BRAND_COLOR, className, style }) {
  return (
    <svg className={className} viewBox="0 0 284 174" width={height * 284 / 174} height={height}
      fill={color} aria-hidden="true" focusable="false" style={{ flex: 'none', ...style }}>
      {MARK_PATHS.map(d => <path key={d} d={d} />)}
    </svg>
  )
}

/** The lockup at `size` px type at the default root size; user text sizing still scales it. */
export default function BrandLogo({ size = 34, as: Tag = 'span', className = '', style }) {
  return (
    <Tag className={('ironvane-lockup ' + className).trim()} dir="ltr" style={{ fontSize: `${size / 16}rem`, ...style }}>
      <svg className="ironvane-lockup-mark" viewBox="0 0 284 174" fill={BRAND_COLOR} aria-hidden="true" focusable="false">
        {MARK_PATHS.map(d => <path key={d} d={d} />)}
      </svg>
      <span className="ironvane-lockup-name"><span className="ironvane-lockup-iron">{APP_NAME.slice(0, 4)}</span><span className="ironvane-lockup-vane">{APP_NAME.slice(4)}</span></span>
    </Tag>
  )
}
