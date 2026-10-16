import { createContext, useContext } from 'react'

// The two contexts the onboarding layout provides (components/onboarding/OnboardingLayout.jsx).
// Nothing outside the layout reads them: a screen or a scene rendered elsewhere throws.

/** The answers, the actions and the flow's navigation (lib/onboarding/use-onboarding-store.js). */
export const OnboardingContext = createContext(null)
/** The thread: { register(el, opts), svg, path } (components/onboarding/ThreadProvider.jsx). */
export const ThreadContext = createContext(null)

export function useOnboarding() {
  const value = useContext(OnboardingContext)
  if (!value) throw new Error('useOnboarding: an onboarding screen renders inside the onboarding layout')
  return value
}
