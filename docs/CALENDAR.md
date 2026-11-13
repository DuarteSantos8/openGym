# Calendar feed

Settings → Integrations → **Calendar feed** makes a private address (an iCalendar / ICS feed) that
Apple Calendar, Google Calendar, Outlook, Thunderbird or any other calendar app can subscribe to.
It shows your planned sessions, and if you switch on "Show finished workouts too", the workouts
you finished. The calendar app fetches it again by itself, so a change in your plan shows up there
(how often is the app's choice: Apple and Outlook every hour or so, Google every few hours).

It needs an openGym server (the address is served by it) with API tokens on (the default; see
docs/API_TOKENS.md, `API_TOKENS`).

## Subscribing

- **Apple Calendar** (iPhone, Mac): tap "Open in my calendar app" in the sheet, or Calendar →
  File → New Calendar Subscription and paste the link.
- **Google Calendar**: on a computer, Other calendars → + → From URL, paste the link.
- **Outlook**: Add calendar → Subscribe from web, paste the link.

## What is in it

- Planned sessions from a week ago to eight weeks ahead, as all-day events named after the
  routine, with its exercises in the description. A day holds what the app's own day plan says:
  a pinned or moved session, a rest day you set, the weekday plan (a combined day is one event per
  routine). A coach week or a rotation has no fixed days, so its next session shows today only;
  sessions you pinned to a day show on that day.
- With "Show finished workouts too": every workout of the last 90 days as a timed event
  ("✓ Push", with the number of sets and the exercises). A past day with a workout shows the
  workout instead of the plan.

Nothing else: no body weight, no notes, no photos.

## The link is the key

Anyone with the link sees what it shows, so keep it to yourself. It is a token of its own kind
(`kind: calendar`, listed under Settings → API tokens as "Calendar feed"): it reads this one feed
and nothing else, every other route refuses it, and it ends with "Sign out everywhere", a new
password or a disabled account, like every token. "Make a new link" ends the old one at once;
"Turn off" ends it without a new one. The server keeps the token sealed (AES-GCM, with a key
derived from `DATA_DIR/secret`) so the sheet can show the link again.

A calendar app cannot send a header, so the token is in the path:
`https://your-server/api/calendar/ogt_….ics`. Reverse proxies log request paths; if your access
logs are shared with someone, leave them out for `/api/calendar/` or turn the feed off.

Each fetch counts against the token's per-minute budget (`TOKEN_READS_PER_MIN`), and the answer
may be cached by the client for 15 minutes.
