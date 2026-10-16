import SceneStage from '../SceneStage.jsx'
import TargetRing from '../TargetRing.jsx'
import ThreadFloor from '../ThreadFloor.jsx'

// 3a Sex: no drawing (no figures); the live target's 88px ring stands 8 above a floor identical to
// Goal's, on the same hero canvas, so the thread holds still (UI decision 1).
export default function SexScene({ target }) {
  return (
    <SceneStage drawKey="sex" viewBox="0 0 320 144" overlay={<TargetRing target={target} big />}>
      <ThreadFloor y={128} />
    </SceneStage>
  )
}
