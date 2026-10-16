import { useEffect, useState } from 'react'
import { nutritionAvailable } from '../nutrition/api.js'
import { loadOnboarding } from './api.js'

// Whether openGym refused the plan the person chose in the onboarding (the hub's state says
// `plan: { status: 'refused' }`; everything else of the write went in). Asked only while the
// profile has no plan: once one exists there is nothing to say. The hub's word is kept for the
// session once it is final (a refusal, or openGym's write settled), so Home asks once.
const settled = new Map()

const isFinal = res => res?.plan?.status === 'refused' || (res?.completedAt != null && ['done', 'failed'].includes(res?.delivery?.opengym))

/** True when the plan chosen at onboarding could not be set up and no plan exists yet. */
export function usePlanRefused(user, hasPlan) {
  const uid = user?.id
  const ask = !hasPlan && !!uid && nutritionAvailable(user)
  const [refused, setRefused] = useState(() => (uid && settled.get(uid)) === true)
  useEffect(() => {
    if (!ask) return undefined
    if (settled.has(uid)) { setRefused(settled.get(uid)); return undefined }
    let live = true
    loadOnboarding().then(res => {
      const answer = res?.plan?.status === 'refused'
      if (isFinal(res)) settled.set(uid, answer)
      if (live) setRefused(answer)
    }, () => { /* no hub to ask: nothing to say */ })
    return () => { live = false }
  }, [ask, uid])
  return ask && refused
}

/** Forgets what the hub said, for tests. */
export function _forgetPlanRefused() { settled.clear() }
