
# License, Privacy and Third-party Source Register

This is a research/checklist starting point, **not a legal clearance**. Review the exact tags, notice files, content/data licenses and usage agreements in force at integration time.

| Candidate | Intended use | Known concern / decision gate |
| --- | --- | --- |
| openGym | Core app code | AGPL v3; network-service source obligations; exercise media excluded from code license |
| Gym visual | Upstream exercise stills/animations | Separate proprietary media rights; noncommercial unmodified 180px allowance only as described in upstream NOTICE; commercial fork requires its own license; not permitted as AI generation inputs |
| Motion | React interface animation | MIT; test version compatibility and bundle impact |
| Apache ECharts | Charts | Apache 2.0; no patient claims; accessibility fallback |
| Open Food Facts | Food product data | Code AGPL, database ODbL, contents DbCL, images CC-BY-SA; honor API access and user-agent policies; never infer image rights from API results |
| sports-lib | FIT/TCX/GPX parser | AGPL library; handle attribution, app AGPL compatibility, and untrusted file parsing |
| NutriTrace | Optional diary sidecar | AGPL; API permission & host controls; evaluate maintenance/backup and client sync semantics |
| Mealie | Optional recipe sidecar | AGPL; API scopes and user ownership; recipe photographs and imported third-party content may have separate rights |
| Liftosaur | Advanced progression engine inspiration/adapter | AGPL; no assumed drop-in SDK; Liftoscript execution needs sandbox/evaluator review |
| FitTrackee | Optional endurance service | AGPL; Codeberg canonical; verify current release; route/location privacy |
| MediaPipe | Pose tracking | Apache 2.0 code; particular pretrained model weights may have separate terms; no clinical-validity assumption |
| Capacitor BLE community plugin | Native sensor bridge | MIT; verify Capacitor-major matching, hardware compliance and platform permissions |
| React Three Fiber / Drei / Three.js | 3D UI | MIT; verify React 19/R3F v9 and optimize on low-end phones |
| BodyParts3D | Anatomy geometry | MIT code is **not** blanket asset license; geometry CC-BY-SA-2.1 JP, attribution and derivative obligations |
| Sports2D | Optional 2D video analysis | BSD-3-Clause core; camera-plane limitation; models subject to separate terms |
| OpenSim | Research-grade musculoskeletal simulation | Apache 2.0 core; models/add-ons separately licensed and require domain validation |
| Node-RED | Optional automations | Apache 2.0; secure dashboard and event signatures |
| LangGraph.js | Optional AI workflow runtime | MIT; use only if existing Coach insufficient |
| Ollama | Local inference runtime | MIT runtime; AI model weights each have their own license |

## Mandatory privacy review per feature
- [ ] Data categories collected; location/video/health specificity; retention and deletion.
- [ ] In-app consent UX with plain-language external destination and opt-out behavior.
- [ ] Credentials stored server-side; least-privilege, revocation, audit without secret logs.
- [ ] User export and deletion include every new saved record.
- [ ] Threat model covers cross-account access, CSRF/CORS, SSRF, rate limiting and untrusted provider payloads.
- [ ] No raw camera/video upload by default; do not use health data to train models implicitly.
- [ ] Legal/commercial media approval when application is distributed under new branding or monetized.

Source of upstream media terms: https://github.com/sorensadrgit-art/openGym/blob/main/NOTICE.md



