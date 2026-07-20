// Number field with −/+ buttons; tapping the field selects its content so typing replaces.
export default function Stepper({ value, step = 1, onChange, decimal = true, className = '', label }) {
  const set = v => onChange(Math.max(0, Math.round((v || 0) * 100) / 100))
  const inner = (
    <div className={'step ' + className}>
      <button onClick={() => set((+value || 0) - step)}>−</button>
      <input
        type="number"
        inputMode={decimal ? 'decimal' : 'numeric'}
        value={value}
        onFocus={e => e.target.select()}
        onChange={e => onChange(e.target.value === '' ? 0 : Math.max(0, parseFloat(e.target.value) || 0))}
      />
      <button onClick={() => set((+value || 0) + step)}>+</button>
    </div>
  )
  if (!label) return inner
  return (
    <div>
      <div className="small muted" style={{ marginBottom: 5, textAlign: 'center' }}>{label}</div>
      {inner}
    </div>
  )
}
