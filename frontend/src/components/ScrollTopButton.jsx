import { useEffect, useRef, useState } from 'react'
import { t } from '../lib/i18n.js'
import { HIDE_AT, SHOW_AT, scrollToTop } from '../lib/scroll-top.js'
import Icon from './Icon.jsx'

// The way back up from far down a long page: Exercises, History, any list that runs on. It comes
// in once the page is SHOW_AT screens down and leaves under HIDE_AT (lib/scroll-top.js); a tap
// sends it out at once rather than riding the glide up with you. App.jsx leaves it out wherever
// the tab bar is gone (a workout, the Coach chat), and `off` covers the workout screen besides.
// While it shows, body.totop-on gives the page enough room at the bottom that the last row's
// buttons scroll clear of it (index.css).
export default function ScrollTopButton({ off = false, path }) {
  const [on, setOn] = useState(false)
  // tapped: stays out until the page is back near the top, whatever the scroll on the way says
  const leaving = useRef(false)
  useEffect(() => {
    leaving.current = false
    if (off) { setOn(false); return }
    const check = () => {
      // A sheet pins the body (Modals.jsx): scrollY reads 0 then, not where the page is.
      if (document.body.style.position === 'fixed') return
      const y = window.scrollY, vh = window.innerHeight || 1
      if (y < vh * HIDE_AT) leaving.current = false
      setOn(was => !leaving.current && (was ? y >= vh * HIDE_AT : y > vh * SHOW_AT))
    }
    check()
    window.addEventListener('scroll', check, { passive: true })
    window.addEventListener('resize', check)
    return () => { window.removeEventListener('scroll', check); window.removeEventListener('resize', check) }
  }, [off, path])
  useEffect(() => {
    document.body.classList.toggle('totop-on', on)
    return () => document.body.classList.remove('totop-on')
  }, [on])
  if (off) return null
  const go = () => { leaving.current = true; setOn(false); scrollToTop() }
  return (
    <button type="button" id="totop" className={on ? 'on' : ''} onClick={go} aria-label={t('Back to top')}
      aria-hidden={on ? undefined : 'true'} tabIndex={on ? 0 : -1}>
      <Icon name="arrowUp" />
    </button>
  )
}
