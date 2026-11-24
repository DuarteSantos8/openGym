
# openGym Next — Product Specification (Proposed)

**Status:** Proposed design; must be reviewed before code implementation. **Source baseline:** `sorensadrgit-art/openGym` `main` equal to upstream at `68dad18f` as checked on 2026-11-13. **Why:** The two earlier add-on PRs were closed unmerged after reliability concerns; the new effort begins from the existing upstream product, not a wholesale rewrite.

## Vision and positioning

An exceptional self-hostable training application that helps someone finish workouts quickly, understand progress, and optionally manage food, outdoor activity, camera-derived movement and sensor data. It should be calm and immediately useful during a workout yet visually compelling when exploring progress. Privacy and portability are features, not marketing promises without technical backing.

## Users and permissions

- **Primary:** individual fitness enthusiast working out on a phone, watch, laptop or in a self-hosted web app.
- **Secondary:** coach or trainer *only for data the owner explicitly shares*. Multi-client coach dashboard is outside MVP and requires its own permissions and data tenancy review.
- **Optional future:** PT student/researcher using consenting synthetic or authorized movement examples for educational comparisons. Not a clinical chart system or medical device.

## Core use cases and acceptance

| Journey | User sees | Data meaning and safety |
|---|---|---|
| Start today's training | Today's real routine, equipment, focused logging | Existing workout logic preserved; never block set logging on AI/sensors |
| Record one set | Prefilled load, reps, next rest timer, undo | Offline durable immediately; full merge behavior unchanged |
| Review performance | Personal 1RM/volume/consistency over a selected range | Date and unit correctness; empty state rather than made-up metrics |
| Log breakfast | Text/manual/barcode search; serving editor; total; edit/delete | Explicit nutrition data model; unknown numbers not counted as zero silently |
| Continue offline | Saved edits and a clear sync badge on reconnection | No duplicate food entries or lost deletions |
| Import a run | Local FIT/TCX/GPX preview, then explicit save | Idempotent import, units, location privacy, source ID |
| Assess a squat | Camera permission, alignment, limited rep/tempo feedback | Confidence flags; all poses estimates; easy stop and manual edit |
| Explore anatomy | Interactive view filtered to trained muscles | Linked to existing group mappings, licensed models, keyboard/2D fallback |
| AI training recommendation | Evidence, why suggested, accept/reject | No silent AI writes, model source identified, errors not masked |
| Connect an external provider | Capabilities and requested scopes, connect/test/revoke | Secret stored server-side, errors shown, no cross-user data exposure |

## MVP definition

The MVP improves the currently working app without forcing new integrations: baseline reliability; a measured and accessible visual refinement; read-only enhanced analytics; versioned local-first food diary with sync, export, backup and safe migration; user-triggered Open Food Facts lookup. A nutrition connector pilot may follow only after the local diary's contracts are stable. Wearables, pose, 3D, endurance services, automation and agent frameworks are optional post-MVP product tracks.

## Experience structure

**Today/Home** retains quick-access training and recovery summaries, and may add a compact nutrition tile when enabled. **Workout** remains fast and deliberately plain during set entry. **Plan** retains existing routines and progression. **Nutrition** offers a date selector, food search, meal list, macros and editing. **Insights** exposes filterable charts and a compact data explanation. **Activity** handles endurance imports and maps only after user opt-in. **Body Explorer** and **Camera Lab** are separate optional destinations. **Coach** continues to use the existing provider mechanisms. **Integrations** explains availability, permissions and actionable errors.

## Design system direction

Near-black/charcoal layered surfaces, restrained high-contrast accent, premium typographic scale, tabular number treatment, subtle highlights, optional translucent glass for panels—not for critical numeric inputs. Avoid neon overload, parallax behind form fields, giant cover animations and static marketing visuals that compete with set logging. Motion may use shared-layout transitions, native-feeling spring sheets, small staggered entrances and hover/touch feedback. Reduced-motion and no-WebGL fallbacks are first-class.

## Data policy

Existing workout/weight/routine state remains authoritative in openGym. New food entries have one local-first source of truth unless a distinct provider mode is explicitly selected. Imported route/health/food measurements carry provenance; dedup is by stable provider ID or content fingerprint. Derived analytics are recomputable, not new master records. Raw camera frames are ephemeral by default. Export/backup/delete flows cover every saved new field.

## Instrumentation and claims

Do not add telemetry by default. For staging only, synthetic repeatable fixtures and performance diagnostics can be enabled explicitly. Report source freshness and unknowns. Pose rep counts, readiness and nutritional estimates are not clinical assessments. No injury diagnosis, rehabilitation prescriptions or personal medical record management in first release.

## Design acceptance

Test the rendered experience at mobile narrow widths (including ~320 px), ordinary phone and tablet widths, desktop, dark/light modes, keyboard, screen reader focus flows, localized strings and RTL where applicable, low-power devices and reduced motion. A goal is that users can still complete every core workout with third-party access disabled and no network.

## Open decisions that must be resolved per epic

- Which nutrition schema fields belong to existing `S`, and how older mobile clients preserve them.
- Whether/when a connected NutriTrace instance becomes an authority for nutrition rather than a one-way data source.
- Which specific external BLE devices and MediaPipe pose models are licensed and supported.
- How a public/commercial fork will replace or license third-party Gym visual exercise animations.
- Whether rehabilitation education will be a public product surface or a separate research build.

These decisions have explicit acceptance tests in the companion implementation plans; do not settle them by silently importing unrelated services.



