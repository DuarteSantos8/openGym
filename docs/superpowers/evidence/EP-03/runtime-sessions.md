# Local runtime observations

All servers were foreground `exec_command` processes with retained session IDs,
not shell background jobs. API data directories were created with `mktemp -d
/tmp/ep03-data-XXXXXX`. Only synthetic guest state was loaded in the browser.
No cause is established for the unexpected SIGTERM exits below.

| Process | Retained session | Observation |
|---|---|---|
| Initial API, port 33103 | 2722 | Spawned approximately 09:24:45 UTC; later returned exit 143 with no additional output. Exact exit time was not captured. |
| Initial Vite, port 5177 | 42569 | Spawned approximately 09:24:45 UTC; later returned 143. Exact exit time not captured. The 09:27:58 rebase caused transient HMR missing-module/render errors while commits were replayed; final runs reloaded stable code. |
| Replacement API | 9866 | Started 09:32 UTC; returned 143 without an exit timestamp. Resulting 390 px light startup 502 responses are retained in `browser-light-390-interrupted.json`. |
| Third API, PID 7808 | 10114 | `ps` confirmed start 09:34:29 UTC and presence at 09:35:18; absent at 09:36:32. Returned 143. The interrupted 1280 px results are retained separately. |
| TTY API, PID 10435 | 15031 | Wrapper printed start 09:36:55 UTC (`ps` process start rounded 09:36:54). Stayed alive through final browser checks. Deliberately stopped by its PID at 09:40:28; wrapper recorded that exact exit time and 143. |
| Replacement Vite, PID 6184 | 16153 | `ps` start 09:32:45 UTC. Deliberately stopped by its PID at 09:40:28 after browser verification. |
| Chromium, PID 3258 | 7038 | `ps` start 09:24:44 UTC, dedicated `/tmp/ep03-chromium` profile and port 9323. QA tab closed, then browser stopped by its PID at 09:40:28. |
| Initial verification wrapper | 19300 | Started frontend at 09:30:05. Frontend log contains complete summary at 442.49 s: 7,952 pass, 1 timeout, 663 files. The outer wrapper returned 143 and never recorded a child exit code or started the remaining commands. They were subsequently run individually in retained TTY sessions. |

Parent confirmed no kill commands were issued from its thread. A targeted source
search found no broad process-kill pattern explaining these exits. No health,
availability or application success is inferred from an interrupted command.
Final captures were repeated after restart. Their only HTTP errors are the
guest boot's expected two `/api/me` 401 responses, explicitly preserved in JSON.
No final browser scenario remains blocked by the initial server interruptions.
