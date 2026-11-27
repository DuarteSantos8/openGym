# Device and runtime checks (EP16-T03, EP14)

## Emulated phones (2026-11-15, automated)

`frontend/playwright.config.mjs` runs every E2E and axe test in three projects. CI runs all three (`e2e` job).

| Project | Engine | Profile | Result |
|---|---|---|---|
| `chromium` | Chromium | 390×844 | 9/9 |
| `iphone-webkit` | **WebKit 27.2** (Safari's engine; the iOS app is a WKWebView) | iPhone 13: viewport, touch, UA, DPR 3 | 8/8 (+1 skipped) |
| `pixel-chromium` | Chromium (the Android app is a Chromium WebView) | Pixel 7 | 9/9 |

Covered on all three:
- guest flow;
- Progression lab;
- **3D map: WebGL loads, seeded muscles are shaded, the canvas is disposed on close**;
- axe WCAG 2.1 AA on 5 screens;
- zero external requests; no uncaught errors.

Skipped on WebKit: the Movement lab, which needs a camera (WebKit has no fake camera).

Not covered by emulation:
- Safari **15.5** specifically (Playwright's WebKit is current; `check-bundle-syntax` guards 15.5 syntax and built-ins);
- real camera permission prompts;
- GPU/driver quirks;
- battery and heat;
- WKWebView/Capacitor shell behaviour.

## Real phones: still to do (owner)

| Check | iPhone (iOS ≥ 15.5) | Android (mid-range) |
|---|---|---|
| Install / open the native build | | |
| Movement lab: camera prompt, squat count over 10 reps (±1) | | |
| 3D map: open, turn, close; background the app and return (WebGL context loss) | | |
| 10 minutes on Add-ons with the 3D map open: battery %, heat | | |
| VoiceOver / TalkBack through Add-ons | | |

## Local AI coach on a real model (EP14, ADR 0007), 2026-11-15

Setup:
- **Hardware:** RTX 4070 Laptop GPU, 8 GB.
- **Ollama:** 0.40.16, running inside WSL next to the API, on 127.0.0.1 only, with GPU via CUDA ("inference compute … RTX 4070").
- **Model:** `qwen2.5:7b` (Q4_K_M, 4.7 GB).
- **Context:** `OLLAMA_CONTEXT_LENGTH=16384`. Ollama's default of 4096 is shorter than the coach's rules plus a training history.
- **How it was driven:** through the coach's own admin routes and job queue (connect → models → config → test → enqueue), with a throwaway data folder and the test suite's sample state.

| Step | Result | Time |
|---|---|---|
| Model list | `["qwen2.5:7b"]` | — |
| Test the Coach | ok (`HTTP · 127.0.0.1:11434 · 1 models`) | 37.1 s (includes loading the model) |
| `review` job | outcome **ready**; one `add-exercise` change, accepted by the validator | 8.0 s |
| `ask` job | answered | 2.8 s |

**Quality: technically working, weak reasoning.**
- The review called the abs undertrained, then proposed an incline dumbbell bench press.
- The answer to the question mentioned a "stalled leg day" that isn't in the data.

Proposals always wait for the user's approval, so nothing like this is applied by itself.

For better plans, the options are:
- a larger local model, which on 8 GB VRAM means partial CPU offload and so slower answers (e.g. `qwen2.5:14b`, `ollama pull`);
- a hosted provider on the admin card (Anthropic, OpenAI, Gemini or OpenRouter). Training data then leaves the machine, which is the user's decision to make.

To use it in the app:
1. Create the first profile; on this instance it becomes admin.
2. Settings → Account → Admin dashboard → **AI Coach**.
3. Provider "OpenAI-compatible endpoint", base URL `http://127.0.0.1:11434/v1`, model `qwen2.5:7b`.
4. Press **Test the Coach**.
