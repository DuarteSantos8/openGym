import { t } from '../lib/i18n.js'
import BrandMark from './BrandMark.jsx'
import { Skeleton } from './blocks.jsx'

// icon: the size of the icon it replaces (--glyph), for a button that swaps its icon for the loader.
const SIZES = ['xs', 'sm', 'md', 'lg', 'icon']

// The Gains G drawing itself, over and over: the app's one loading animation. It is the brand mark
// (BrandMark, cropped to the G, so the G fills the box it is sized to) with its stroke animated in
// ui-kit.css, in the text colour around it: muted in a muted line, light on the dark theme and dark
// on the light, and white inside a primary button. Still, the whole G, when the device or the app
// asks for reduced motion (the same CSS). Decoration: the words next to it (Loading) are what is
// announced.
export function Loader({ size = 'md', className }) {
  if (import.meta.env.DEV && !SIZES.includes(size)) throw new Error(`Loader: size ${size} is not one of ${SIZES.join(', ')}`)
  return <BrandMark className={`loader loader-${size}` + (className ? ' ' + className : '')} />
}

// A list that is loading: skeleton rows on the geometry of a list row (thumbnail, two lines, a
// value), one live status named by `label`. Instead of the loader wherever the page will be a list.
export function LoadingList({ rows = 3, label }) {
  return (
    <div className="loadrows" role="status" aria-label={label || t('Loading…')}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="loadrow">
          <Skeleton w={48} h={48} r={8} />
          <span className="loadrow-t"><Skeleton w={i % 2 ? '46%' : '58%'} h={12} /><Skeleton w={i % 2 ? '40%' : '34%'} h={10} /></span>
          <Skeleton w={36} h={12} />
        </div>
      ))}
    </div>
  )
}

// A loading line: the loader and its words, one live status. `inline` sits in a sentence, a row's
// subtitle or a button, `block` (the default) is a line of its own, centred. Give children for the
// words ("Loading…" is the default); an icon-only use says so with `label`.
export function Loading({ size, inline = false, className, label, children }) {
  const words = children === undefined ? t('Loading…') : children
  return (
    <div className={'loadline' + (inline ? ' loadline-inline' : '') + (className ? ' ' + className : '')} role="status"
      aria-label={words === null || words === false ? (label || t('Loading…')) : undefined}>
      <Loader size={size || (inline ? 'xs' : 'sm')} />
      {words !== null && words !== false && <span>{words}</span>}
    </div>
  )
}
