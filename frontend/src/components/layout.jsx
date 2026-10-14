import { cx, GAPS, oneOf, STEPS } from '../lib/ui-kit.js'
import RootHeader from './RootHeader.jsx'
import SubHeader from './SubHeader.jsx'

// Layout primitives. Each emits the markup the pages write by hand today, with the spacing that
// used to be inline as a ui-kit.css class, so a page moves onto them without a pixel changing.
// Sizes are steps on the space scale (lib/ui-kit.js); a value off the scale throws in development.
// None of them sets a page width: that belongs to the shell (#app, --page-w).

// A routed page: its header, then the page's content as it is (no wrapper). `root` is a tab's
// root (large title and the avatar), which has no back and no action of its own; every other page
// gets SubHeader with back and `action`.
export function Page({ title, sub, action, onBack, root = false, children }) {
  if (import.meta.env.DEV && root && (action || onBack)) {
    throw new Error('Page: a root page takes no action or onBack (RootHeader shows the avatar)')
  }
  return <>
    {root ? <RootHeader title={title} sub={sub} /> : <SubHeader title={title} sub={sub} action={action} onBack={onBack} />}
    {children}
  </>
}

// A column of blocks, `gap` apart. For new layout only: never around .lrow rows, whose hairlines
// are adjacency selectors.
export function Stack({ gap, as: El = 'div', className, children, ...rest }) {
  oneOf('Stack', 'gap', gap, GAPS)
  return <El className={cx('stack', gap != null && 'g-' + gap, className)} {...rest}>{children}</El>
}

// The height of today's `<div style={{ height: N }} />`.
export function Spacer({ size = 4 }) {
  oneOf('Spacer', 'size', size, STEPS)
  return <div className={'sp-' + size} />
}

// A `.row`: centred, 12px apart unless `gap` says otherwise.
const JUSTIFY = { between: 'between', end: 'jc-end' }
const ALIGN = ['start', 'end', 'baseline', 'stretch']
export function Inline({ gap, justify, align, wrap = false, as: El = 'div', className, children, ...rest }) {
  oneOf('Inline', 'gap', gap, GAPS)
  oneOf('Inline', 'justify', justify, Object.keys(JUSTIFY))
  oneOf('Inline', 'align', align, ALIGN)
  return <El className={cx('row', JUSTIFY[justify], gap != null && 'g-' + gap, wrap && 'wrap', align && 'ai-' + align, className)} {...rest}>
    {children}
  </El>
}
