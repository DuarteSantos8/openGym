import { cx } from '../../lib/ui-kit.js'
import { useDrawIn } from '../../lib/use-draw-in.js'

// The card a scene stands in, and its 320-unit canvas. The scene draws itself in the first time it
// shows in a session (lib/use-draw-in.js) and is simply there after that; under reduced motion it
// fades in over 120ms. `label` makes a static scene an image with a name; a scene whose state is
// said by a caption leaves it out. `end`: when the scene's late parts (dashed, data) fade in.
export default function SceneStage({ drawKey, viewBox, label, end, overlay, after, className, children }) {
  const draw = useDrawIn('onboarding:' + drawKey)
  return (
    <div className={cx('ob-stage-card', className)} {...(label ? { role: 'img', 'aria-label': label } : {})}>
      <div className={cx('ob-art', draw)} style={end != null ? { '--end': end + 'ms' } : undefined}>
        <svg viewBox={viewBox} aria-hidden="true" focusable="false">{children}</svg>
        {overlay}
      </div>
      {after}
    </div>
  )
}
