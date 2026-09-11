# Friends and shared plans

Open **Social** and exchange friend codes with another registered user on the same
openGym server. Send a request; the other person must accept before either of you
can see the other's progress or send a plan. Guests and standalone mobile profiles
must sign in or connect to their server first.

Each friend card shows:

- A streak of consecutive weeks containing a logged workout. The current week can
  still be unfinished without breaking the streak. The friend's week-start setting
  and saved reminder time zone are used; profiles without a saved zone use UTC.
- Total workouts, workouts this week, and the date of the latest workout.
- Personal records for each exercise, with up to 12 records shown, ordered by the
  date they were first achieved. Expand **Personal records** to see them. Records
  follow exercise history: heaviest load, highest reps for an unloaded exercise,
  longest timed hold, or most cardio minutes in one session. Completed work sets
  count; warm-ups and unfinished sets do not. The most recently logged exercise
  mode determines which metric is shown.

Summaries refresh when Social opens, when the window regains focus, every minute
while visible, or when **Refresh** is pressed. They reflect synced, saved workouts.
The Social API returns these summaries, not the friend's full workout state,
body-weight log, private workout notes, gym cards, or live location.

## Sharing a plan

Use **Share my plan** on a friend's card. Confirming sends your routines, weekly
schedule and the custom exercises they use. This is a snapshot; later edits do not
change it. Sending again replaces your previous pending snapshot for that friend.

The recipient opens **Plans from friends → Review plan**, expands a routine to
inspect its exercises, and chooses **Add to my plan**. Routines are added with new
IDs. **Use this weekly schedule** is off by default; enabling it replaces the
recipient's weekday assignments. Weights and load increments convert between kg
and lb when needed. Older plan files without a unit retain their existing import
behavior. Successfully importing dismisses the snapshot from the inbox; **Dismiss**
also removes a snapshot without importing it.

Removing a friend ends access in both directions and deletes pending shared plans
between the two accounts. Previously imported routines remain in each person's
own plan. Disabled accounts do not appear in friends or plan inboxes.

## Storage and limits

Connections and pending plans live in `DATA_DIR/social.json`, written atomically.
Existing accounts and workout files require no migration. Friend codes are derived
from the existing instance secret and user ID, and are not login credentials.
The existing session and CSRF checks also apply to all Social routes.

There is a limit of 100 connections per account, including pending requests, and
one pending plan per sender/recipient pair. Shared plans are limited to 256 KB,
100 routines and 100 exercises per routine. Normal plan-file export/import still
works for people using different servers. Social does not connect separate servers.

The new Social copy currently uses the English source strings; existing translated
labels retain their normal language behavior.
