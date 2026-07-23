// openGym icon set — hand-drawn on a 24×24 grid, stroke-based, single weight.
//
// Everything is one <svg> primitive with `currentColor`, so an icon inherits the
// text colour and optical size of whatever it sits in. No emoji anywhere in the
// chrome: emoji render differently on every platform, sit on their own baseline
// and can't take a theme colour, which is what made the old UI feel assembled
// rather than designed.
//
// Conventions, so a new icon never looks foreign next to an old one:
//   · 24×24 viewBox, live area 3…21 — 3px of optical padding all round
//   · strokes only (no fills) except where a shape reads better solid (star.fill)
//   · round caps + round joins, stroke width from --icon-stroke (1.7 default)
//   · geometry snapped to .5 so it lands on pixel edges at 24px

const P = {
  /* ---- navigation ---- */
  house: <path d="M3.5 10.7 12 3.8l8.5 6.9M5.9 9.4V19a1.4 1.4 0 0 0 1.4 1.4h9.4A1.4 1.4 0 0 0 18.1 19V9.4" />,
  calendar: <><rect x="3.4" y="5.2" width="17.2" height="15.4" rx="3.2" /><path d="M8.2 3.4v3.4M15.8 3.4v3.4M3.4 10.2h17.2" /></>,
  chart: <path d="M4.5 20.2V13M9.5 20.2V6.4M14.5 20.2v-5.1M19.5 20.2V9.6" />,
  magnifier: <><circle cx="11" cy="11" r="7" /><path d="m20.5 20.5-4.4-4.4" /></>,
  // A real cog outline (8 teeth, generated on a circle) — an earlier version drew
  // radial rays and was indistinguishable from `sun` at tab-bar size.
  gear: <><path d="M20.48 10.59 20.48 13.41 18.58 13.72 17.87 15.43 19 17 17 19 15.43 17.87 13.72 18.58 13.41 20.48 10.59 20.48 10.28 18.58 8.57 17.87 7 19 5 17 6.13 15.43 5.42 13.72 3.52 13.41 3.52 10.59 5.42 10.28 6.13 8.57 5 7 7 5 8.57 6.13 10.28 5.42 10.59 3.52 13.41 3.52 13.72 5.42 15.43 6.13 17 5 19 7 17.87 8.57 18.58 10.28Z" /><circle cx="12" cy="12" r="3.1" /></>,

  /* ---- training ---- */
  dumbbell: <><rect x="5.9" y="7.9" width="3.2" height="8.2" rx="1.3" /><rect x="14.9" y="7.9" width="3.2" height="8.2" rx="1.3" /><path d="M9.1 12h5.8M3.6 9.9v4.2M20.4 9.9v4.2" /></>,
  barbell: <path d="M2.9 12h18.2M7.4 7.4v9.2M9.8 9.3v5.4M16.6 7.4v9.2M14.2 9.3v5.4" />,
  figureRun: <><circle cx="14.2" cy="4.9" r="1.9" /><path d="M13.4 9.1 9.6 11.4l1.7 3.3-2.4 5.4M13.4 9.1l3.4 1.5 1.4 3.4M11.3 14.7l4.3.9 1.5 4.5M9.6 11.4 6 10.2" /></>,
  figureStrength: <><circle cx="12" cy="5.2" r="2" /><path d="M12 8.4v5.6M12 14 9.2 20.5M12 14l2.8 6.5M8 10.6h8M5.4 9.1v3M18.6 9.1v3" /></>,
  scale: <><rect x="3.4" y="4.4" width="17.2" height="16.2" rx="3.4" /><path d="M8.3 9.2a3.9 3.9 0 0 1 7.4 0" /><path d="M12 9.2v2.5M8.9 16.2h6.2" /></>,
  flame: <path d="M12 20.4c3.2 0 5.4-2.1 5.4-5.1 0-3.9-3.4-5.6-2.6-9.8-2.5.8-4 2.9-4 5.1 0 1-.5 1.6-1.2 1.6-.8 0-1.2-.7-1.2-1.8-1.1 1.2-1.8 2.9-1.8 4.9 0 3 2.2 5.1 5.4 5.1Z" />,
  timer: <><circle cx="12" cy="13.4" r="7.2" /><path d="M12 9.6v3.8h2.8M9.6 3.4h4.8" /></>,
  clock: <><circle cx="12" cy="12" r="8.2" /><path d="M12 7.4V12l3.1 1.9" /></>,

  /* ---- status / achievement ---- */
  trophy: <><path d="M7.6 4h8.8v4.6a4.4 4.4 0 0 1-8.8 0Z" /><path d="M7.6 5.6H4.9v1.5a3 3 0 0 0 2.9 3M16.4 5.6h2.7v1.5a3 3 0 0 1-2.9 3M12 13v3.4M8.6 20.4h6.8l-.7-4H9.3Z" /></>,
  medal: <><circle cx="12" cy="14.8" r="5.2" /><circle cx="12" cy="14.8" r="1.9" /><path d="M9.1 9.9 6.4 3.6M14.9 9.9l2.7-6.3" /></>,
  target: <><circle cx="12" cy="12" r="8.2" /><circle cx="12" cy="12" r="4.6" /><circle cx="12" cy="12" r="1.1" /></>,
  star: <path d="m12 3.9 2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8Z" />,
  starFill: <path d="m12 3.9 2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8Z" fill="currentColor" stroke="none" />,
  crown: <path d="M4.2 17.6h15.6M4.2 17.6 3.4 7.2l4.6 3.2L12 4.6l4 5.8 4.6-3.2-.8 10.4Z" />,
  bolt: <path d="M13.4 3.4 5.6 13.6h5.2l-.2 7 7.8-10.2h-5.2Z" />,
  shield: <path d="M12 3.6 5 6.2v5.5c0 4 2.9 7.5 7 8.7 4.1-1.2 7-4.7 7-8.7V6.2Z" />,
  heart: <path d="M12 20c-.4 0-.8-.1-1-.4l-6.2-6a4.6 4.6 0 0 1 0-6.6 4.4 4.4 0 0 1 6.2 0l1 1 1-1a4.4 4.4 0 0 1 6.2 0 4.6 4.6 0 0 1 0 6.6l-6.2 6c-.2.3-.6.4-1 .4Z" />,
  rocket: <><path d="M12 3.6c2.8 2.5 4.2 5.7 4.2 9.1v4.5H7.8v-4.5c0-3.4 1.4-6.6 4.2-9.1Z" /><circle cx="12" cy="10.3" r="1.8" /><path d="M7.8 14 5.2 16.6v3.8l2.6-2M16.2 14l2.6 2.6v3.8l-2.6-2" /></>,
  sparkles: <><path d="m8.4 3.8 1.1 2.9 2.9 1.1-2.9 1.1-1.1 2.9-1.1-2.9L4.4 7.8l2.9-1.1Z" /><path d="m16.2 12.4.8 2.1 2.1.8-2.1.8-.8 2.1-.8-2.1-2.1-.8 2.1-.8Z" /></>,
  lightbulb: <><path d="M9.2 16.4a5.6 5.6 0 1 1 5.6 0v1.8H9.2Z" /><path d="M10 20.6h4" /></>,

  /* ---- routine glyphs: what a training day actually is ---- */
  // Named after the split or the kit, because that's how people name routines
  // ("Push Day", "Leg Day", "Kettlebell") — an award icon says nothing about it.
  arm: <><circle cx="7" cy="5.8" r="1.9" /><path d="M7 8.8v4.6l-1.2 6.2M7 11.4l4.4 1.9" /><rect x="12.2" y="10.8" width="2.3" height="5" rx=".9" /><rect x="15.9" y="10.8" width="2.3" height="5" rx=".9" /><path d="M14.5 13.3h1.4" /></>,
  abs: <><path d="M7.8 4.4h8.4v10.4a4.2 4.2 0 0 1-8.4 0Z" /><path d="M12 5.4v12M8.2 9h7.6M8.6 12.7h6.8" /></>,
  legs: <><path d="M8.4 4.2h7.2" /><path d="M9.9 4.2v4.9l-1.3 4.4.9 6.3M14.1 4.2v4.9l1.3 4.4-.9 6.3" /><path d="M7.7 19.8h2.6M13.7 19.8h2.6" /></>,
  pullup: <><path d="M3.6 5.1h16.8M8.5 5.5v2.3M15.5 5.5v2.3" /><circle cx="12" cy="10.5" r="1.9" /><path d="m8.5 7.8 3.5 5 3.5-5M12 13.3v3.9M12 17.2l-2.1 3.2M12 17.2l2.1 3.2" /></>,
  kettlebell: <><path d="M9.5 11V9.6a2.5 2.5 0 0 1 5 0V11" /><path d="M14.9 11.8c2.2 1.5 3.6 3.9 3.6 6.4a1.6 1.6 0 0 1-1.6 1.6H7.1a1.6 1.6 0 0 1-1.6-1.6c0-2.5 1.4-4.9 3.6-6.4Z" /></>,
  plate: <><circle cx="12" cy="12" r="8.2" /><circle cx="12" cy="12" r="2.7" /></>,
  machine: <><path d="M12 3.6v3.1" /><rect x="6.6" y="6.7" width="10.8" height="12.9" rx="1.9" /><path d="M9 10.1h6M9 13.2h6M9 16.3h6" /></>,
  bike: <><circle cx="6.2" cy="16.2" r="3.5" /><circle cx="17.8" cy="16.2" r="3.5" /><path d="m6.2 16.2 4.3-7.4h4.9l2.4 7.4M9.3 8.8h4.5M13.8 8.8l-2.6 7.4" /></>,
  swim: <><circle cx="8.8" cy="8.2" r="1.8" /><path d="m10.9 10 4.6-2.2 3.3 3.4" /><path d="M3.5 15.6c1.6-1.3 3.1-1.3 4.7 0s3.1 1.3 4.7 0 3.1-1.3 4.7 0c.9.7 1.7.9 2.6.5" /></>,
  boxing: <><path d="M7.6 8.6A4.6 4.6 0 0 1 12.2 4h1.6a5.4 5.4 0 0 1 5.4 5.4v2.4a3 3 0 0 1-3 3H7.6Z" /><path d="M7.6 14.8v2.3a2.6 2.6 0 0 0 2.6 2.6h5.2a2.6 2.6 0 0 0 2.6-2.6v-2.3" /><path d="M7.6 9.8H6.3a1.8 1.8 0 0 0 0 3.6h1.3" /></>,
  stretch: <><circle cx="14.4" cy="5.4" r="1.9" /><path d="M14.4 8.2c-3 1.4-5 4-5.8 7.4" /><path d="M8.6 15.6 6.2 20M8.6 15.6l4.6 4.4" /><path d="M12.6 9.6 18 12" /></>,

  /* ---- actions ---- */
  plus: <path d="M12 5.2v13.6M5.2 12h13.6" />,
  minus: <path d="M5.2 12h13.6" />,
  check: <path d="m4.8 12.6 4.8 4.8L19.2 6.8" />,
  checkCircle: <><circle cx="12" cy="12" r="8.2" /><path d="m8.2 12.2 2.7 2.7 5.1-5.4" /></>,
  xmark: <path d="M6.2 6.2 17.8 17.8M17.8 6.2 6.2 17.8" />,
  pencil: <><path d="M17.1 3.9a2.1 2.1 0 0 1 3 3l-9.9 9.9-4 1 1-4Z" /><path d="m15.1 5.9 3 3" /></>,
  trash: <><path d="M4.8 6.6h14.4M9.4 6.6V4.8a1.2 1.2 0 0 1 1.2-1.2h2.8a1.2 1.2 0 0 1 1.2 1.2v1.8" /><path d="M6.6 6.6 7.4 19a1.6 1.6 0 0 0 1.6 1.4h6a1.6 1.6 0 0 0 1.6-1.4l.8-12.4" /><path d="M10.4 10.2v6.4M13.6 10.2v6.4" /></>,
  link: <><path d="M10.2 13.8a3.6 3.6 0 0 0 5.4.4l2.6-2.6a3.6 3.6 0 0 0-5.1-5.1l-1.5 1.5" /><path d="M13.8 10.2a3.6 3.6 0 0 0-5.4-.4l-2.6 2.6a3.6 3.6 0 0 0 5.1 5.1l1.5-1.5" /></>,
  play: <path d="M8.4 5.6 18 12l-9.6 6.4Z" />,
  pause: <path d="M9.4 5.8v12.4M14.6 5.8v12.4" />,
  reset: <><path d="M4.4 12a7.6 7.6 0 1 0 2.3-5.4" /><path d="M4 4.4v4.4h4.4" /></>,
  bell: <><path d="M6.6 10.4a5.4 5.4 0 0 1 10.8 0c0 4 1.4 5.6 1.4 5.6H5.2s1.4-1.6 1.4-5.6Z" /><path d="M10.1 19.2a2.1 2.1 0 0 0 3.8 0" /></>,
  bellSlash: <><path d="M8.1 6.6a5.4 5.4 0 0 1 9.3 3.8c0 4 1.4 5.6 1.4 5.6H9.4M6.6 16H5.2s1.4-1.6 1.4-5.6v-.6" /><path d="M10.1 19.2a2.1 2.1 0 0 0 3.8 0M4 3.6l16 16.8" /></>,
  chevronRight: <path d="m9.6 5.6 6.6 6.4-6.6 6.4" />,
  chevronLeft: <path d="m14.4 5.6-6.6 6.4 6.6 6.4" />,
  chevronDown: <path d="m5.6 9.4 6.4 6.2 6.4-6.2" />,
  chevronUp: <path d="m5.6 14.6 6.4-6.2 6.4 6.2" />,
  arrowUp: <path d="M12 19.6V4.4M6.2 10.6 12 4.4l5.8 6.2" />,
  arrowDown: <path d="M12 4.4v15.2M6.2 13.4 12 19.6l5.8-6.2" />,
  expand: <path d="M14.4 4.4h5.2v5.2M9.6 19.6H4.4v-5.2M19.6 4.4 13.8 10.2M4.4 19.6l5.8-5.8" />,
  minimize: <path d="M19.6 9.6h-5.2V4.4M4.4 14.4h5.2v5.2M14.4 9.6l5.2-5.2M9.6 14.4l-5.2 5.2" />,

  /* ---- objects ---- */
  person: <><circle cx="12" cy="8" r="3.8" /><path d="M4.8 20.4a7.2 7.2 0 0 1 14.4 0" /></>,
  personCircle: <><circle cx="12" cy="12" r="8.4" /><circle cx="12" cy="10" r="2.9" /><path d="M6.6 18.4a5.8 5.8 0 0 1 10.8 0" /></>,
  clipboard: <><rect x="5.4" y="4.8" width="13.2" height="15.8" rx="2.6" /><path d="M9 4.8a1.6 1.6 0 0 1 1.6-1.6h2.8A1.6 1.6 0 0 1 15 4.8v1.4H9Z" /><path d="M9.2 11.6h5.6M9.2 15.2h4" /></>,
  list: <path d="M8.4 6.6h11.2M8.4 12h11.2M8.4 17.4h11.2M4.6 6.6h.01M4.6 12h.01M4.6 17.4h.01" />,
  folder: <path d="M3.6 7.4a2 2 0 0 1 2-2h3.1l2 2.4h6.7a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2H5.6a2 2 0 0 1-2-2Z" />,
  globe: <><circle cx="12" cy="12" r="8.2" /><path d="M3.8 12h16.4M12 3.8c2.1 2.2 3.2 5.1 3.2 8.2s-1.1 6-3.2 8.2c-2.1-2.2-3.2-5.1-3.2-8.2s1.1-6 3.2-8.2Z" /></>,
  moon: <path d="M19.4 14.2A7.8 7.8 0 0 1 9.8 4.6a8.2 8.2 0 1 0 9.6 9.6Z" />,
  sun: <><circle cx="12" cy="12" r="4.4" /><path d="M12 3.6v2M12 18.4v2M20.4 12h-2M5.6 12h-2M17.94 6.06l-1.42 1.42M7.48 16.52l-1.42 1.42M17.94 17.94l-1.42-1.42M7.48 7.48 6.06 6.06" /></>,
  key: <><circle cx="8.2" cy="15.8" r="3.8" /><path d="m10.9 13.1 8-8M16.6 7.4l2 2M14.6 9.4l2 2" /></>,
  lock: <><rect x="5" y="10.4" width="14" height="10" rx="2.8" /><path d="M8.4 10.4V7.8a3.6 3.6 0 0 1 7.2 0v2.6" /></>,
  download: <path d="M12 3.8v11.4M7.6 11.2 12 15.6l4.4-4.4M4.6 19.4h14.8" />,
  upload: <path d="M12 15.6V4.2M7.6 8.2 12 3.8l4.4 4.4M4.6 19.4h14.8" />,
  wrench: <path d="M15.2 3.9a5 5 0 0 0-4.8 6.6l-6 6a2.1 2.1 0 0 0 3 3l6-6a5 5 0 0 0 6.1-6.3l-2.9 2.9-2.8-.7-.7-2.8Z" />,
  // checkered, not a pennant — this marks "finish workout", and a 2×2 grid is
  // what reads as a finish line at 16px
  flag: <><path d="M6 20.4V4.2" /><path d="M6.4 5.2h13v9.2h-13" /><path d="M12.9 5.2v9.2M6.4 9.8h13" /></>,
  chartLine: <path d="M3.6 20.2V4.4M3.6 20.2h16.8M6.4 16.4l3.9-4.8 3.1 2.7 5.2-6.6" />,
  dot: <circle cx="12" cy="12" r="4.2" fill="currentColor" stroke="none" />,
  history: <><path d="M4.5 12.2a7.6 7.6 0 1 0 2.5-5.6" /><path d="M4.1 4.4v4.3h4.3" /><path d="M12 8.3v4.2l3.1 1.9" /></>,
  signOut: <><path d="M14.2 4.6H7a1.9 1.9 0 0 0-1.9 1.9v11a1.9 1.9 0 0 0 1.9 1.9h7.2" /><path d="m16.8 8.4 3.6 3.6-3.6 3.6M20.4 12H10.2" /></>,
  shuffle: <><path d="M3.6 7.2h2.9c1.6 0 2.8.9 3.8 2.4l3 4.8c1 1.5 2.2 2.4 3.8 2.4h2.9M3.6 16.8h2.9c1.6 0 2.8-.9 3.8-2.4l.7-1.1M15.6 9.9l.7-1.1c1-1.5 2.2-2.4 3.8-2.4h1.9" /><path d="m17.9 4.3 2.8 2.1-2.8 2.1M17.9 14.7l2.8 2.1-2.8 2.1" /></>,
  info: <><circle cx="12" cy="12" r="8.2" /><path d="M12 11v5.4" /><circle cx="12" cy="7.9" r=".9" fill="currentColor" stroke="none" /></>,
}

// A few keys are aliases so call sites can say what they mean.
P.search = P.magnifier
P.settings = P.gear
P.exercises = P.magnifier
P.weight = P.scale
P.streak = P.flame
P.done = P.check

export const ICON_NAMES = Object.keys(P)

/**
 * <Icon name="flame" />           — inherits font-size via `1em` sizing
 * <Icon name="flame" size={28} /> — explicit pixel size
 */
export default function Icon({ name, size, className = '', style, ...rest }) {
  const d = P[name]
  if (!d) return null
  const s = size ? { width: size, height: size } : null
  return (
    <svg
      className={'icn ' + className}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      style={s ? { ...s, ...style } : style}
      {...rest}
    >
      {d}
    </svg>
  )
}
