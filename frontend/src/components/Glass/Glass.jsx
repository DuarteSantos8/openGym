import { useRef, useCallback } from 'react'

export default function Glass({
  as: Tag = 'div',
  variant = 'default',
  pill = false,
  interactive = false,
  className = '',
  style,
  children,
  ...rest
}) {
  const ref = useRef(null)
  const raf = useRef(0)

  const onPointerMove = useCallback((e) => {
    if (!interactive || !ref.current) return
    const rect = ref.current.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 100
    const y = ((e.clientY - rect.top) / rect.height) * 100
    cancelAnimationFrame(raf.current)
    raf.current = requestAnimationFrame(() => {
      ref.current.style.setProperty('--mx', `${x}%`)
      ref.current.style.setProperty('--my', `${y}%`)
    })
  }, [interactive])

  const onPointerDown = useCallback((e) => {
    if (!interactive || !ref.current) return
    const rect = ref.current.getBoundingClientRect()
    ref.current.style.setProperty('--mx', `${((e.clientX - rect.left) / rect.width) * 100}%`)
    ref.current.style.setProperty('--my', `${((e.clientY - rect.top) / rect.height) * 100}%`)
  }, [interactive])

  const classes = [
    'glass',
    variant === 'strong' && 'glass--strong',
    variant === 'thin' && 'glass--thin',
    variant === 'tinted' && 'glass--tinted',
    pill && 'glass--pill',
    interactive && 'glass--interactive',
    className,
  ].filter(Boolean).join(' ')

  return (
    <Tag
      ref={ref}
      className={classes}
      style={style}
      onPointerMove={onPointerMove}
      onPointerDown={onPointerDown}
      role={interactive && !rest.onClick ? 'button' : undefined}
      tabIndex={interactive && !rest.onClick ? 0 : undefined}
      {...rest}
    >
      {children}
    </Tag>
  )
}
