import { actionCount, cx, GAPS, oneOf, STEPS } from '../lib/ui-kit.js'
import RootHeader from './RootHeader.jsx'
import SubHeader from './SubHeader.jsx'

// Layout primitives. Each emits the markup the pages write by hand today, with the spacing that
// used to be inline as a ui-kit.css class, so a page moves onto them without a pixel changing.
// Sizes are steps on the space scale (lib/ui-kit.js); a value off the scale throws in development.
// None of them sets a page width: that belongs to the shell (#app, --page-w).

// A routed page: its header, then the page's content as it is (no wrapper). The page names
// itself and says which actions it has; how its header looks is the kit's (ui-guards G8 holds
// every page to this). `root` is a tab's root: RootHeader, with the search, the avatar and at
// most one context button (`action`), and `title` only as the page's name for a screen reader.
// Every other page gets SubHeader: back, the title with `sub`, at most two actions, and
// `heading` in place of the title where the title is itself a field (the routine editor).
export function Page({ title, sub, action, onBack, heading, root = false, children }) {
  if (import.meta.env.DEV && root && (onBack || sub != null || heading != null || actionCount(action) > 1)) {
    throw new Error('Page: a root page takes no sub, heading or onBack, and one action at most (RootHeader shows the search and the avatar)')
  }
  return <>
    {root ? <RootHeader title={title} action={action} />
      : <SubHeader title={title} sub={sub} action={action} onBack={onBack}>{heading}</SubHeader>}
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
