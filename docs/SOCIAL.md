# Friends and shared plans

Open **Profile → Social** to see friends and pending items. **Add friend** opens the
registered profiles on the same openGym server; the other person must accept before
either of you can open the other's training profile or send a plan. Guests and
standalone mobile profiles must sign in or connect to their server first. Both the
sender and recipient see the sharing disclosure and their current body-weight
sharing setting before sending or accepting a request.

Profile keeps **Stats** and **Social** one tap apart through a segmented control while
the identity header stays in place. History, Settings and friend profiles all remain
within the Profile section of the bottom navigation.

The Social overview keeps each friend card compact:

- A streak of consecutive weeks containing a logged workout. The current week can
  still be unfinished without breaking the streak. The friend's week-start setting
  and saved reminder time zone are used; profiles without a saved zone use UTC.
- Workouts this week and the date of the latest workout.
- The number of personal records available in the friend's full profile.

Open a friend to see their full training profile:

- Total workouts, workouts this month, weekly streak and latest workout.
- Their latest body weight and, when at least two weigh-ins exist in the last 30
  days, the change over that period, only when they enable **Share body weight with
  friends**. The weigh-in history itself is never returned.
- Their weekly schedule and routines, including exercise targets. Private routine
  notes are not included.
- One personal record for every exercise they have logged. Records follow exercise
  history: heaviest load, highest reps for an unloaded exercise, longest timed
  hold, or most cardio minutes in one session. Completed work sets count; warm-ups
  and unfinished sets do not. The most recently logged exercise mode determines
  which metric is shown. Load records also show the repetitions from the set that
  first achieved that load, when that set is available. Repetitions from a lighter
  set are never attached to a heavier record.

Requests and shared plans appear before the friends list. General server discovery
uses initials; profile photos are visible only to the owner and accepted friends.
Friend actions such as sharing a plan or removing the connection live in the card's
ellipsis menu.

Summaries and open friend profiles refresh when opened, when the window regains
focus or becomes visible, every minute while visible, or when **Refresh** is pressed.
A failed refresh keeps previously loaded data with an error and a retry action.
A profile is cleared when the server reports that access is no longer allowed.
A lightweight count also keeps the Profile navigation badge current. Summaries reflect synced, saved workouts.
The Social API returns these derived profiles, not the friend's full workout state,
body-weight log, private workout or routine notes, gym cards, or live location.

## Sharing a plan

Use **Share my plan** on a friend's card. Choose the routines, whether to include
their weekly schedule, and whether to include exercise notes. Notes are off by
default and are also removed by the server unless explicitly enabled. Preview the
selected exercises, notes and schedule before sending. Only custom exercises used
by the selected routines are included. This is a snapshot; later edits do not
change it. Sending again replaces your previous pending snapshot for that friend.

The recipient opens **Plans from friends → Review plan**, expands a routine to
inspect its exercises, and chooses **Add to my plan**. Routines are added with new
IDs. **Use this weekly schedule** is off by default; enabling it replaces the
recipient's weekday assignments. Weights and load increments convert between kg
and lb when needed. Older plan files without a unit retain their existing import
behavior. Successfully importing dismisses the snapshot from the inbox; **Dismiss**
also removes a snapshot without importing it. The snapshot ID is saved atomically
with the imported routines and follows normal account-state sync. If dismissal
fails, the inbox shows **Already imported** and still allows dismissal. Retrying
the same snapshot does not add routines or reapply its schedule, even after its
imported routines have been deleted. Simultaneous imports on two devices use the
same routine IDs so normal state merging does not duplicate those routines.

Removing a friend ends access in both directions and deletes pending shared plans
between the two accounts. Previously imported routines remain in each person's
own plan. **Block** is available on incoming requests and in a friend's menu. It
also removes the connection and pending plans, hides discovery in both directions,
and prevents new requests, profile access and plan sharing. **Blocked profiles**
lets the blocker undo the block; unblocking does not restore the friendship.
Declining a request alone does not block future requests. Disabled accounts do not
appear in friends or plan inboxes.

## Storage and limits

Connections, directional blocks and pending plans live in `DATA_DIR/social.json`,
written atomically.
The display name, optional compressed avatar and body-weight sharing preference live
with the account in `DATA_DIR/db.json`. Existing accounts, connections and workout
files require no migration. Existing accounts retain body-weight sharing until they
change it; new accounts start with it off. Registered profile names are discoverable
to other signed-in users on the same instance; all training data and profile photos
remain behind an accepted friendship. The existing session and CSRF checks also
apply to all Social routes.

There is a limit of 100 connections per account, including pending requests, and
one pending plan per sender/recipient pair. Shared plans are limited to 256 KB,
100 routines and 100 exercises per routine. Normal plan-file export/import still
works for people using different servers. Social does not connect separate servers.
