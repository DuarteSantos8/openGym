// The dip (README.md, press-kit.js): reps, depth and tempo on parallel bars, rings, a straight bar
// or a bench, plus the elbow angle side-on. It measures, it never grades.
//
// The hands stay on the bars and the shoulders sink towards them (press-kit's arm drop): the rep
// is the shoulder's drop towards the wrists, the depth the shoulder's height against the elbow's,
// level being the upper arm horizontal, the usual dip standard. Side-on the camera's height does
// not matter; from the front or at an angle the elbows sit behind the shoulders at the bottom, so
// depth is judged only with the phone at elbow height (with arms straight) and level.
import { t } from '../i18n-core.js'
import { createViewDetector, framing, matchExercise, VIEW_EDGES as KIT_VIEW_EDGES } from './kit.js'
import { ARM, createArmDropTracker, DROP_STANDARDS, SHALLOW_MISS } from './press-kit.js'

// Body-weight and weighted dips on bars, rings, a straight bar or a bench. Machines (the kneeling
// pad and the lever hide the body), dips on the floor (too small a motion), holds, and one-arm,
// Korean and impossible dips (another rep) are left out.
const IDS = new Set([
  '0251', '0814', '1430', '2462', '2363', '8143', '0677', '1755', '1767', '3313', '4205', '4719',
  '0129', '4360', '0830', '0812', '0813',
])
const DIP = /^\s*(weighted |ring |chest |triceps? |bench |parallel bar |straight bar )*dips?\s*$/i

// Vision's shoulder sits at the base of the neck, in front of and above the joint the upper arm
// turns about (form lab overlays, three side-on dippers). Side-on, dips whose upper arms reach
// level or lower by eye read the shoulder 0.16 above the elbow to 0.37 below it (upper arms), a
// dip stopped well short with the knees bent 0.58 above; on the near arm alone, chair dips that
// look level read 0.2 to 0.3 above. SHOULDER_MARK comes off before depth is judged (the squat's
// HIP_MARK, for the hip); the push-up, with no shallow clip to place it, keeps 0.
export const SHOULDER_MARK = 0.15

// How far above the elbow the shoulder may read (upper arms, after SHOULDER_MARK) and the dip
// still be called level. Where Vision's shoulder sits over the joint differs from lifter to lifter
// by about a tenth of an upper arm (form lab, side-on bench and chair dips at the bottom): reps
// that look level on full-size frames read 0.12 above the elbow to 0.05 below, and bench dips that
// look 5 to 10 degrees shorter than those read 0.03 to 0.2 above, the same reading for a different
// depth, and one lifter's same-looking reps spread over 0.14. The camera cannot tell those apart,
// so they are given the benefit of the doubt and named level; a dip is refused when it reads more
// than 0.3 above, a tenth of an upper arm past the shortest of those (a chair dip stopped with the
// knees bent, clearly short by eye, read 0.41 above). The push-up keeps LEVEL_BAND.
export const ABOVE_BAND = 0.3

// Touch-and-go dips: a lifter who sets up locked out with the shoulders pushed down, then dips
// without locking out between reps (form lab, a bar dip from a low diagonal camera: the far elbow
// read 146 to 149 degrees at each top against 168 at the start, the arm's height 6 to 8 per cent
// short of the start) never came back under the phase machine's top, and ten reps read as one.
// A way up that gets back within 15 per cent of the arm's height of the start (signal 0.3; those
// tops read 0.15 to 0.2) and turns down again ends the rep there; a bounce at the bottom does not
// come near it.
export const TURN_TOP = 0.3

// Side-on runs to about 25 degrees here (VIEW_EDGES), not the kit's 20: a bench dip filmed from
// the side with the torso leaning back read 0.20 to 0.25 (the shoulders retracted on the bench
// read wider than the hips), so its depth went unjudged and the camera was asked to move. Side-on
// the depth is the shoulder against the elbow in the image; turning the lifter puts part of the
// elbow's distance behind the shoulder into depth, which a camera off elbow height misreads. With
// the phone at knee height a dip to exactly level reads 0.08 upper arms shallow at 20 degrees and
// 0.11 at 26 (test-kit), so at the edge a dip just to level can be refused; one 10 degrees deeper
// is not.
export const VIEW_EDGES = { side: 0.245, front: KIT_VIEW_EDGES.front }  // widthRatio: side to about 25 degrees

const SPEC = {
  shoulderMark: SHOULDER_MARK,
  aboveBand: ABOVE_BAND,
  turnTop: TURN_TOP,
  framing: frame => framing(frame, ARM),
  viewDetector: () => createViewDetector(VIEW_EDGES),
  startHint: () => t('Arms straight to start'),
  readyHint: () => t('Ready. Go when you are.'),
  notes: {
    side: () => t('Filmed from the side: depth, tempo and elbow angle.'),
    diagonal: () => t('Filmed at an angle: depth and tempo only.'),
    front: () => t('Filmed from the front: depth and tempo only.'),
  },
}

const dip = {
  id: 'dip',
  name: 'Dip',
  kind: 'reps',
  views: ['side', 'diagonal', 'front'],
  setup: 'Phone side-on, 2 to 3 m away, your upper body and arms in the frame. From the front, put it at elbow height and level.',
  matches: ex => matchExercise(ex, { ids: IDS, name: DIP, cats: new Set(['strength', 'calisthenics']) }),
  standards: DROP_STANDARDS,
  defaultStandard: 'level',
  misses: SHALLOW_MISS,
  create: opts => createArmDropTracker(dip, SPEC, opts),
}

export default dip
