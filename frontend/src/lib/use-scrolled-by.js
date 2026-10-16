import { useEffect, useState } from 'react'

/** Whether the page has scrolled more than `px` (read once a frame while it scrolls). */
export function useScrolledBy(px) {
  const [past, setPast] = useState(false)
  useEffect(() => {
    let frame = 0
    const read = () => { frame = 0; setPast(window.scrollY > px) }
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(read) }
    read()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [px])
  return past
}
