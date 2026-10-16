import { useEffect, useRef } from 'react'
import { loadOnboarding } from './api.js'
import { isFlowPath } from './flow.js'
import { nutritionAvailable } from '../nutrition/api.js'
import { hasData, useStore } from '../../store/useStore.js'

/**
 * "Leaves mid-way" (ux-onboarding §6): the next sign-in resumes at the first unanswered step. Asked
 * once a boot, of a signed-in web profile that has no training data yet (a profile with data is
 * past onboarding, and the hub is not asked for every one of them), and only when the person had
 * started: an onboarding with nothing answered is not pushed on anyone.
 */
export function useOnboardingResume({ user, ready, pathname, navigate }) {
  const asked = useRef(false)
  useEffect(() => {
    if (asked.current || !ready || !user || !nutritionAvailable(user) || isFlowPath(pathname)) return
    asked.current = true
    if (hasData(useStore.getState().S)) return
    const askedOf = user.id
    loadOnboarding().then(s => {
      // Someone else signed in (or out) while it was out: the answer is about the one before.
      if (useStore.getState().user?.id !== askedOf) return
      const started = s.step != null || Object.keys(s.answers || {}).length > 0
      if (s.completedAt == null && started) navigate('/onboarding', { replace: true })
    }).catch(() => { /* no hub, or no answer: nothing to resume */ })
  }, [ready, user, pathname, navigate])
}
