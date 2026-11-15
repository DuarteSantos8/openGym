# API diagnostic failure inventory

All rows are classified environment. This later diagnostic retained the same 769 pass / 31 fail / 0 skip totals as the two original runs. Full assertions and stacks are in api-diagnostic.txt.gz.

| Test location | Test | Evidence category |
| --- | --- | --- |
| `test\coach-limits.test.js:72:1` | the instance cap is reserved at enqueue, so a job still running already counts | Windows file-URL conversion produces C:\C:\... for the fixture provider; downstream job state assertions fail. |
| `test\coach-limits.test.js:159:1` | a scheduled review reads a batch of workouts once, not once per tick | Windows file-URL conversion produces C:\C:\... for the fixture provider; downstream job state assertions fail. |
| `test\coach-limits.test.js:192:1` | a workout the phone dated tomorrow is not re-read once the review has covered it | Windows file-URL conversion produces C:\C:\... for the fixture provider; downstream job state assertions fail. |
| `test\coach-limits.test.js:214:1` | an answer the model was paid for counts as the review, even when it was unusable | Windows file-URL conversion produces C:\C:\... for the fixture provider; downstream job state assertions fail. |
| `test\coach-limits.test.js:244:1` | a proposal nobody has answered is not replaced by the next scheduled review | Windows file-URL conversion produces C:\C:\... for the fixture provider; downstream job state assertions fail. |
| `test\credential.test.js:95:1` | a profile credential lives in its own file, not in synced state | POSIX mode assertion: Windows reports 0666 rather than 0600. |
| `test\durable.test.js:12:1` | atomicWrite: bytes flushed, then the rename, then the directory | POSIX mode assertion: Windows reports 0666 rather than 0600. |
| `test\integrations.test.js:55:1` | connections are capped on the way in and the log keeps the newest 50 | POSIX mode assertion: Windows reports 0666 rather than 0600. |
| `test\jobs.test.js:69:1` | an answer that stays unusable fails cleanly and applies nothing | Windows file-URL conversion produces C:\C:\... for the fixture provider; downstream job state assertions fail. |
| `test\jobs.test.js:95:1` | an expired proposal disappears on read rather than lingering forever | Windows file-URL conversion produces C:\C:\... for the fixture provider; downstream job state assertions fail. |
| `test\jobs.test.js:198:1` | a runtime that cannot be cancelled still has its late answer discarded after a forget | Windows file-URL conversion produces C:\C:\... for the fixture provider; downstream job state assertions fail. |
| `test\jobs.test.js:347:1` | a review job produces a checked change-set, and nothing is left unvalidated | Windows file-URL conversion produces C:\C:\... for the fixture provider; downstream job state assertions fail. |
| `test\jobs.test.js:362:1` | a create job produces a bundle the client can merge unchanged | Windows file-URL conversion produces C:\C:\... for the fixture provider; downstream job state assertions fail. |
| `test\jobs.test.js:378:1` | a well-formed answer naming an exercise nobody has is refused, twice, and applies nothing | Windows file-URL conversion produces C:\C:\... for the fixture provider; downstream job state assertions fail. |
| `test\jobs.test.js:393:1` | the one repair round rescues an answer the validator rejected | Windows file-URL conversion produces C:\C:\... for the fixture provider; downstream job state assertions fail. |
| `test\jobs.test.js:406:1` | "nothing to change" keeps the reason it gave, and proposes nothing | Windows file-URL conversion produces C:\C:\... for the fixture provider; downstream job state assertions fail. |
| `test\jobs.test.js:419:1` | a refine carries the plan it is refining, and counts as the next iteration | Windows file-URL conversion produces C:\C:\... for the fixture provider; downstream job state assertions fail. |
| `test\jobs.test.js:436:1` | the admin test-run completes a round trip without a user to spend | Windows file-URL conversion produces C:\C:\... for the fixture provider; downstream job state assertions fail. |
| `test\jobs.test.js:459:1` | the admin test-run answers to the same privilege gate, and spawns nothing without it | Windows file-URL conversion produces C:\C:\... for the fixture provider; downstream job state assertions fail. |
| `test\nudge-copy.test.js:11:1` | api/nudge-copy.js matches the frontend strings (node scripts/build-nudge-copy.mjs) | CRLF in source/generated text versus LF byte equality. |
| `test\openapi-routes.test.js:71:1` | every error code the e-mail and password signup routes return is in their spec entry | LF-only route-block search against CRLF YAML. |
| `test\prompts.test.js:15:1` | core/prompts.js matches api/coach/prompts/*.md byte for byte | CRLF in source/generated text versus LF byte equality. |
| `test\routes.test.js:214:1` | a debrief is enqueued as its own kind, and the cohort routes gate on the admin switch and the opt-in | Windows file-URL conversion produces C:\C:\... for the fixture provider; downstream job state assertions fail. |
| `test\routes.test.js:264:1` | Ask the Coach mid-workout: the running session goes along, changes come back for that session only | Windows file-URL conversion produces C:\C:\... for the fixture provider; downstream job state assertions fail. |
| `test\server-db-unreadable.test.js:65:1` | db.json unreadable after a sign-up: the copy kept is the last save, so the new profile is still there | POSIX permissions/unwritable fixture expectations do not hold on Windows. |
| `test\server-health-writable.test.js:55:1` | a data directory the server cannot write to is 503, not healthy | POSIX permissions/unwritable fixture expectations do not hold on Windows. |
| `test\server-media.test.js:396:1` | folders are 0700 and files 0600, and an admin deleting the profile removes its folder | POSIX permissions/unwritable fixture expectations do not hold on Windows. |
| `test\server-push-prune-save.test.js:69:1` | an unwritable ./data cannot take the process down through the rest timer nobody awaits | POSIX permissions/unwritable fixture expectations do not hold on Windows. |
| `test\server-recovery.test.js:142:1` | recover.js asks the running server for the owner’s code, by name or by id | Admin socket is intentionally disabled on win32; socket path is absent. |
| `test\server-recovery.test.js:166:1` | the admin socket is private, and recover.js says so when no server runs | Admin socket is intentionally disabled on win32; socket path is absent. |
| `test\wrapped.test.js:62:1` | api/wrapped-copy.js matches the frontend strings (node scripts/build-wrapped-copy.mjs) | CRLF in source/generated text versus LF byte equality. |
