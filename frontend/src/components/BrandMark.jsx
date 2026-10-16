import { useId } from 'react'

// The Gains G, drawn as strokes in the current text colour: a ring that turns into the crossbar,
// with a thin groove cut along the outside of it (the rim of a plate). The numbers are the brand
// kit's (gains-logo.js GEO: radius 24, stroke 8.4, groove at 25.2 and 1.1 wide, in a 100 box with
// y up), written with y down. The loader and the splash (lib/brand-motion.js) draw the same
// geometry over time; brand-mark.test.js keeps the two in step. index.html carries a copy of this
// markup for the first frame, before any script runs.
export const MARK = {
  centre: 'M68.39 34.57A24 24 0 1 0 74 50H51',
  groove: 'M69.30 33.80A25.2 25.2 0 1 0 75.2 50V48.8H52.5',
  width: 8.4,
  grooveWidth: 1.1,
  // The G's own extent in the 100 box, so the SVG is cropped to the letter.
  box: '21.8 21.8 56.4 56.4',
}

// Sized by the font-size it sits in (1em), coloured by `color`. A mark that stands for the app
// has no name of its own: give `label` when it is the only thing saying so.
export default function BrandMark({ className, label }) {
  const id = 'groove-' + useId().replace(/:/g, '')
  return (
    <svg className={'brand-mark' + (className ? ' ' + className : '')} viewBox={MARK.box} width="1em" height="1em"
      role={label ? 'img' : undefined} aria-label={label || undefined} aria-hidden={label ? undefined : true} focusable="false">
      <defs>
        <mask id={id} maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
          <rect className="mark-keep" width="100" height="100" />
          <path className="mark-cut" d={MARK.groove} fill="none" strokeWidth={MARK.grooveWidth} strokeLinejoin="round" />
        </mask>
      </defs>
      <path mask={`url(#${id})`} d={MARK.centre} fill="none" stroke="currentColor" strokeWidth={MARK.width} strokeMiterlimit="4" />
    </svg>
  )
}

// The first frame of the app, until the state is read: the mark where the splash holds it.
export function BootMark() {
  return <div className="boot-mark"><BrandMark /></div>
}
