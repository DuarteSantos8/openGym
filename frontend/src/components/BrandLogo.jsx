// The openGym logo, as in assets/logo: the mark (five plain rectangles on a 352×174 grid, square
// corners, brand green) and the lockup (mark, then "open" plus "Gym" in brand green). Brand colours,
// not the accent: the accent is the user's, the logo is not. Never mirrored in RTL.

const RECTS = [[80, 242, 352, 28], [80, 199, 36, 114], [131, 169, 47, 174], [334, 169, 47, 174], [396, 199, 36, 114]]

/** The mark alone, `height` px high (width follows, 352:174). `color` only for a one-colour use. */
export function BrandMark({ height = 24, color = '#a3e635', className, style }) {
  return (
    <svg className={className} viewBox="80 169 352 174" width={height * 352 / 174} height={height}
      fill={color} aria-hidden="true" focusable="false" style={{ flex: 'none', ...style }}>
      {RECTS.map(([x, y, w, h]) => <rect key={x + '-' + y} x={x} y={y} width={w} height={h} />)}
    </svg>
  )
}

/**
 * The lockup at `size` px type: mark 1.07× the type high, a gap of 0.2×, the mark's middle at
 * 0.36× above the baseline (opengym-logo-dark.svg). "open" follows the theme (index.css .brand-lockup).
 */
export default function BrandLogo({ size = 34, as: Tag = 'span', className = '', style }) {
  return (
    <Tag className={('brand-lockup ' + className).trim()} dir="ltr" style={{ fontSize: size, ...style }}>
      <svg className="brand-lockup-mark" viewBox="80 169 352 174" aria-hidden="true" focusable="false">
        {RECTS.map(([x, y, w, h]) => <rect key={x + '-' + y} x={x} y={y} width={w} height={h} />)}
      </svg>
      <span className="brand-lockup-open">open</span><span className="brand-lockup-gym">Gym</span>
    </Tag>
  )
}
