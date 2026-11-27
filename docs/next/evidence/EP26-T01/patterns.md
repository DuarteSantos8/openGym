# 11.02e / EP26-T01 E5b: movement pattern examples

**Status: all eight sequences are draft.** A named movement reviewer and review date are pending under [ADR 0012](../../adr/0012-health-content.md). The release owner assigns the reviewer. The examples show representative directions and poses; they do not depict equipment, grip, individual exercise variants, or provide form coaching. The timings are display loop lengths, not training prescriptions. Native-language review is pending.

The base is `da96e4002bd0d05200d650f85d47c6692d990d40`; the squat rig was introduced in `82e185d3` and merged in #130 (`0c8216d5`). The pose contract is unchanged: `POSES` and `POSE_LOOPS` use `PATTERNS` keys; increasing keyframe offsets in milliseconds start at zero, one frame has `key: true`, and joint angles are in degrees. The existing 2–12 frame, 800–8,000 ms loop and ±180° angle limits apply. Both renderers read the same `skeletonAt` and key caption. Lunge anchors on the front sole and rear toe; core uses the same rig turned onto its back. The symbolic standing push and pull poses show direction without depicting a specific bench, bar, or cable setup.

## Pattern-to-pose matrix

Start from a fresh local English guest in Library. Search for the exercise and open its regular sheet. No reviewed movement reference was supplied for any row. Provenance is the existing in-repo symbolic rig and authored text guidance (`frontend/src/content/exercise-guides.js`, IDs below). The geometry, keyframes and descriptive captions are original; there are no external assets or new health claims.

| Pattern | Synthetic fixture: Library sheet | Sequence (ms; **key** in bold) | Key still caption | Movement review |
|---|---|---|---|---|
| `lunge` | Split squat (`0781`) | 0 split stance → **1300 lowered** → loop at 2600 | Both knees are bent, with one foot ahead of the other. | Draft |
| `hinge` | Dumbbell Romanian deadlift (`1459`) | 0 upright → **1400 hinged** → 2800 | The hips are back and the torso tilts forward. | Draft |
| `push-h` | Push-up (`0662`) | 0 hands near chest → **1050 forward reach** → 2100 | The arms reach straight forward at chest height. | Draft |
| `push-v` | Dumbbell standing overhead press (`0426`) | 0 shoulder height → **1200 overhead** → 2400 | The arms extend overhead. | Draft |
| `pull-h` | Dumbbell bent over row (`0293`) | 0 forward reach → **950 row** → 1900 | The elbows draw back and the hands come toward the ribs. | Draft |
| `pull-v` | Cable lat pulldown full range motion (`2330`) | 0 high reach → **1150 downward pull** → 2300 | The elbows move down as the hands come toward the chest. | Draft |
| `core` | Dead bug (`0276`) | 0 raised limbs → **1100 left arm/right leg reach** → 2200 raised limbs → 3300 mirrored reach → 4400 | Lying on the back, one arm reaches back as the opposite leg extends. | Draft |
| `isolation` | Dumbbell biceps curl (`0294`) | 0 arms lowered → **1050 curl** → 2100 | The forearms curl up while the upper arms stay by the sides. | Draft |

For 11.02f, use the family key and time offset in the pose table, and keep variant-specific overlays separate from this draft family example. For 11.02h, reuse the Library fixture table in `frontend/e2e/mannequin-demo.e2e.mjs` and keep the media interception in place. Unknown keys resolve to no pose and no demo. Rollback after any future merge is the fork's normal single-PR revert; there is no migration or stored state to restore.

Independent verification on the Linux production build passed all 39 mannequin browser cases across Chromium, Pixel Chromium and iPhone WebKit emulation. The browser checks exercise playback where WebGL is available, keyboard controls, reduced motion, and the still fallback. Named movement review remains pending.

[Split squat on a dark phone](lunge-sheet-390-dark.png) · [Overhead reach](push-v-key-rig-390-dark.png) · [Supine core still](core-still-390-dark.png)
