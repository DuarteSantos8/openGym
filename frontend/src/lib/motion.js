// The search overlay's motion, copied verbatim from bearmenu (fitness-eval ui-search.md §10):
// @bearmenu/ui lib/motion.ts, the overlay's own constants (search-overlay.tsx), the city pill's
// icon swap and motion-icon.tsx. Plain objects, no `motion` import, so the main bundle can read
// them; the `motion` engine itself only loads with the search chunk.

// ─── Primitives ──────────────────────────────────────────────────────────────

export const duration = {
  instant: 0.12,
  quick: 0.18,
  standard: 0.26,
  deliberate: 0.36,
  narrative: 0.5,
  exitQuick: 0.11,
  exitStandard: 0.21,
}

export const ease = {
  enter: [0.0, 0.0, 0.2, 1.0],
  standard: [0.4, 0.0, 0.2, 1.0],
  exit: [0.55, 0.0, 1.0, 0.45],
}

// ─── Springs ─────────────────────────────────────────────────────────────────

export const springSnappy = { type: 'spring', damping: 30, stiffness: 380 }
export const springSmooth = { type: 'spring', damping: 30, stiffness: 220 }
export const springSoft = { type: 'spring', damping: 35, stiffness: 140 }
/** @deprecated use `springSoft`; bearmenu keeps the alias. */
export const springGentle = springSoft

// ─── The overlay (search-overlay.tsx) ────────────────────────────────────────

/** Delay before content animates in after the surface is visible. */
export const CONTENT_ENTER_DELAY = 0.11
export const SURFACE_SPRING = { type: 'spring', damping: 22, stiffness: 260, mass: 0.9 }
export const CONTENT_SPRING = { type: 'spring', damping: 20, stiffness: 220, mass: 0.9 }
export const SURFACE_EXIT_DURATION = 0.18
export const CONTENT_EXIT_DURATION = 0.12
export const EXIT_EASE = [0.55, 0, 1, 0.45]
export const SURFACE_EXIT = { duration: SURFACE_EXIT_DURATION, ease: EXIT_EASE }
export const CONTENT_EXIT = { duration: CONTENT_EXIT_DURATION, ease: EXIT_EASE }

// ─── The avatar ↔ close swap (city-pill.tsx): 13.5% overshoot, kept on purpose ──

export const ICON_SWAP_SPRING = { type: 'spring', damping: 18, stiffness: 280 }

// ─── Animated icons (motion-icon.tsx) ────────────────────────────────────────

/** A gesture is a performance with beats: a tween with explicit `times`. */
export const beats = (times, d = 0.62) => ({ duration: d, times, ease: 'easeInOut' })
/** Leaving is not a performance: it returns the glyph, firmly and fast. */
export const returnTransition = { type: 'spring', stiffness: 320, damping: 26 }
/** The longest gesture in the set, with a little room. */
export const GESTURE_MS = 700
/** How long a performed-but-not-active glyph keeps its end pose before snapping to rest. */
export const HOLD_GRACE_MS = 900

// ─── Reduced motion ──────────────────────────────────────────────────────────

export const REDUCED = { duration: 0.15 }

// ─── Archetypes and variants (lib/motion.ts) ─────────────────────────────────

export const archetype = {
  surfaceOpen: { ...springSmooth },
  surfaceClose: { duration: duration.exitStandard, ease: ease.exit },
  listReveal: { ...springSoft },
  listRevealStagger: 0.04,
  listRevealMaxItems: 8,
  contentSwap: { duration: duration.quick, ease: ease.standard },
  contentSwapExit: { duration: duration.exitQuick, ease: ease.exit },
  edgeEnter: { ...springSmooth },
  edgeExit: { duration: duration.exitStandard, ease: ease.exit },
  pressResponse: { duration: duration.instant, ease: ease.enter },
  indicatorMorph: { ...springSnappy },
  imageEnter: { duration: 0.3, ease: ease.standard },
}

export const stagger = { tight: 0.03, standard: 0.04, loose: 0.06 }

export const contentSwapVariants = {
  hidden: { opacity: 0, y: 6 },
  show: { opacity: 1, y: 0, transition: archetype.contentSwap },
  exit: { opacity: 0, y: -4, transition: archetype.contentSwapExit },
}

export const skeletonSwapVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: archetype.contentSwap },
  exit: { opacity: 0, transition: archetype.contentSwapExit },
}

// The result lists (search-results-sections.tsx): every group starts at once, its rows 30 ms apart.
export const LIST_CONTAINER = { hidden: {}, show: { transition: { staggerChildren: 0.03, delayChildren: 0 } } }
export const LIST_ITEM = { hidden: { opacity: 0, y: 6 }, show: { opacity: 1, y: 0, transition: springGentle } }
