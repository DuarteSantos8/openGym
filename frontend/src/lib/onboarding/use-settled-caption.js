import { useEffect, useState } from 'react'

/**
 * The About-you caption, a polite live region, as of the last settled answer: while a picker is
 * still moving it keeps what it said, so a drag is announced once, when it stops (prototype v4
 * writes the caption only on `final`). The hub's exact target arriving later updates it too.
 */
export function useSettledCaption(settled, text) {
  const [said, setSaid] = useState(settled ? text : '')
  useEffect(() => { if (settled) setSaid(text) }, [settled, text])
  return said
}
