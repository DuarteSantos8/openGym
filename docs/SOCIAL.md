# Friends and basic progress

The Profile bottom tab contains Stats and Social. Stats retains the existing charts and
history links. The route remains `/stats`; `/stats?view=social` opens Social explicitly.
Home retains its Settings shortcut.

Social connects registered accounts on the same server. Add friend opens searchable discovery;
the recipient chooses Accept or Decline. Sent requests can be cancelled. Accepted friends have
cards showing weekly workouts, weekly streak, last workout and personal-record count.
The record count is the number of exercises with an eligible record, not the number of times
someone has beaten a previous record. Warm-up and unfinished work do not create records.
Future-dated workouts are excluded from the summary. Weeks follow the friend's week-start and
timezone settings; a streak may continue from the previous week while this week is still empty.

Before acceptance, discovery and requests expose only account id and display name. The accepted
summary adds exactly four fields: `thisWeek`, `weekStreak`, `lastWorkout` and `recordCount`.
Individual records, routines, schedules, notes, body weight, photos and account credentials
are never returned. The detailed friend profile, profile editing and plan-sharing flows are
outside this iteration.

Remove friend immediately revokes access in both directions. Block also prevents discovery
and new requests in both directions; the blocker can unblock from Blocked profiles. Unblocking
does not restore the friendship, and a block by the other person continues to apply.
Disabled accounts are unavailable. Account deletion removes their connections and blocks.
There can be at most 100 pending or accepted connections per account.

Connections and blocks are stored in `DATA_DIR/social.json`, written with the API's existing
durable atomic writer and mode `0600`. A missing file starts with empty lists. A malformed or
unreadable file is refused rather than replaced. Identity and authentication remain in `db.json`.
Social routes use the existing session and CSRF checks; no new authentication path is added.

`api/social/routes.js` owns access and connection changes, `api/social/summary.js` derives the
allowlisted summary, and `api/training/` holds the framework-free metric rules needed by it.
`frontend/src/views/Profile.jsx` owns the Stats/Social switch and `Social.jsx` owns the cards,
requests, discovery and blocks. Social refreshes when visible every minute, on focus, and after
an action. A failed refresh retains the last loaded result with a retry button; authentication
failures clear it.

The API operations and request/response schemas are documented in `api/openapi.yaml` and the
generated API reference. Run `cd api && npm test` and `cd frontend && npm test` for the existing
test suites; browser verification must also cover Profile navigation and the friendship flow.
