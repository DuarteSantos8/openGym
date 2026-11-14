// A quiet placeholder while something loads. One status region that announces its (translated)
// label once; the bars are decorative. No aria-busy: on the only live region it would keep the
// announcement from ever being spoken. The shimmer is removed under prefers-reduced-motion.
export default function Skeleton({ lines = 2, label, className = '' }) {
  return <div role="status" className={'skel' + (className ? ' ' + className : '')}>
    <span className="vh">{label}</span>
    {Array.from({ length: lines }, (_, i) => <span key={i} className="skel-line" aria-hidden="true" style={i === lines - 1 && lines > 1 ? { width: '60%' } : undefined} />)}
  </div>
}
