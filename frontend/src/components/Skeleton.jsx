// A quiet placeholder while something loads. One status region (announced once), the bars are
// decorative. The shimmer is removed under prefers-reduced-motion (index.css).
export default function Skeleton({ lines = 2, label, className = '' }) {
  return <div role="status" aria-busy="true" aria-label={label} className={'skel' + (className ? ' ' + className : '')}>
    {Array.from({ length: lines }, (_, i) => <span key={i} className="skel-line" aria-hidden="true" style={i === lines - 1 && lines > 1 ? { width: '60%' } : undefined} />)}
  </div>
}
