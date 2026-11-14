
# Architecture Decisions — openGym Next

**ADR-001: Enhance, do not re-platform.** Keep React 19/Vite, JS/JSX, Zustand, Node 22 API, JSON state storage, Capacitor, passkeys, offline sync, and existing workout/coach engines. Any later data-store or framework migration needs a separately justified ADR and rollout plan. Reason: the core already works and offers offline portability; a rewrite would create unnecessary regression risk.

**ADR-002: Local-first nutrition as default authority.** Add versioned nutrition records in the existing profile model rather than depending on a self-hosted external nutrition server for basic food logging. Confirm merge behavior, older-client compatibility and schema in code before implementation. NutriTrace is optional: begin with a scoped read/controlled import pilot, then establish ownership before any write synchronization.

**ADR-003: Derived analytics do not become a second training database.** Read from current workouts/body data and imported activities, recalculate trends; retain provenance and units. Apache ECharts is dynamically loaded only for relevant screens. The current Stats screens remain until a replacement meets functional parity.

**ADR-004: Food catalogs are not user journals.** Open Food Facts is an attributed lookup source, not the authoritative record of what a user ate. Store the selected nutrient snapshot and user adjustments with source/time when the user confirms a food entry. Do not silently rewrite diaries when upstream product data changes.

**ADR-005: Separate full applications via API, never wholesale source mergers.** NutriTrace, Mealie, FitTrackee and Node-RED run independently if justified. Use configured, scoped credentials, a typed normalizing adapter, explicit availability status, idempotency, retry and revocation tests. Do not embed their full Svelte/Vue/Python applications into the React/Node app.

**ADR-006: Activity import is staged.** sports-lib parses bounded FIT/TCX/GPX locally. A preview is never a saved activity until the user confirms. Preserve type, source fingerprint, time, path privacy and original units. FitTrackee, if used, is a complementary view/service, not an unbounded second author of activity records.

**ADR-007: Advanced progression is gated.** Reuse openGym's policies and existing Liftosaur importer. Only add a Liftoscript evaluator for a specific unmet programming use case, with deterministic tests, explicit manual overrides and immutable policy-version provenance. Do not allow arbitrary scripts to call the network or file system.

**ADR-008: Camera/ML is local and optional.** MediaPipe inference runs on-device when feasible. Require active camera consent; expose confidence/limitations; disable/stop explicitly. No raw image upload or model training without fresh authorization. Sports2D/OpenSim are research/specialist pipelines, not dependencies for workout logging.

**ADR-009: 3D is a lazy enhancement, not a navigation dependency.** React Three Fiber v9 for React 19, Drei, Three.js, selectable licensed anatomy meshes. WebGL disabled/failing -> accessible 2D muscle explorer. Use low-resolution geometry and adapt to low-end hardware.

**ADR-010: AI is a proposal system.** Reuse existing Coach, including its existing compatible endpoint route for Ollama/vLLM. Only add LangGraph.js if a durable multi-step workflow's need has been established. All writes require schema validation and explicit user approval; never allow prompts or retrieved documents to override server authorization.

**ADR-011: Maintain upstream mergeability.** Keep additive modules, feature flags, minimal routing changes and separate data adapters. Avoid editing generated exercise data or upstream licensed assets. Sync with upstream regularly by a reviewed merge/rebase strategy, no force-reset of user work.

**ADR-012: Prototype and release are different.** A cloud browser screenshot, unit test or build does not prove hardware, multi-device or production service reliability. Staging uses isolated data and secrets; release requires an explicit owner approval gate and demonstrated rollback.



