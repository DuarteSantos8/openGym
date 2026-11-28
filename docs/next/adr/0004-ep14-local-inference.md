# ADR-0004 EP14: local inference (Ollama), Node-RED, LangGraph
Timebox: 1 session (used: 0.3) · Decision: **GO-WITH-CONSTRAINTS for local inference · Node-RED done · LangGraph NO-GO**
Date: 2026-11-14 · Base: `next/ready-20261114`

## Hardware (measured on the dev laptop, 2026-11-14)
| Item | Value |
|---|---|
| CPU | Intel Core i9-14900HX, 24 cores / 32 threads |
| GPU | NVIDIA GeForce RTX 4070 Laptop, 8,188 MiB VRAM (nvidia-smi) |
| RAM | 15.7 GB total, 4.8 GB free at measurement |
| Ollama | not installed |

## Software (upstream 1.4.5)
The Coach already speaks to Ollama / any OpenAI-compatible endpoint (`api/coach/core/providers.js`, adapters). EP14-T02 (provider router) is therefore **already present**.

## Decision
- **Local inference: feasible.** 8 GB VRAM fits a 7–8B model at 4-bit quantization (~5 GB weights) on the GPU with room for context; 70B-class models are out of reach. RAM is the tighter limit: close heavy apps while running it.
- The test itself (EP14-T01 RED cases: timeout, malformed tool JSON, concurrent inference during a workout save) needs Ollama installed — **not installed by the agent**; your call.
- **Node-RED:** done. `contrib/node-red/` has a signed webhook receiver flow with its own e2e and CI job.
- **LangGraph.js:** NO-GO (YAGNI). No multi-step workflow needs it; revisit only with a named one.

## To run the test yourself
```powershell
winget install Ollama.Ollama
ollama pull qwen2.5:7b        # or llama3.1:8b
ollama run qwen2.5:7b "Reply with the JSON {\"ok\": true}"
```
Then point the Coach at `http://localhost:11434/v1` (OpenAI-compatible) in Settings → Coach and run one weekly review; record latency and whether the proposal passes `validate.js`.
