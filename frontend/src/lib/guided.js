import { guideFor, ladderFor } from './exercise-guide.js'
import { EXIDX } from './exercises.js'

export const cuesFor = exerciseId => guideFor(exerciseId)?.cues || []
export const easierOf = exerciseId => ladderFor(exerciseId, id => !!EXIDX[id]).easier
