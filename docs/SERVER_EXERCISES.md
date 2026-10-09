# Server exercise catalogue

Signed-in users can use a common catalogue of custom exercises. Publishing and managing it
requires the existing administrator role (`ADMIN_UIDS` or the account's admin flag).

This is an instance catalogue, independent of the built-in catalogue introduced in v1.4.0.
`catalogue/` remains the source for bundled exercises, translations, categories and licensed
media. Publishing only writes `DATA_DIR/shared-exercises.json` and user-uploaded media; it
does not edit catalogue source files, generated datasets or bundled media. Shared exercises
keep their `c`-prefixed custom identifiers, so numeric built-in and drawing identifiers cannot
be replaced through these routes. Both catalogues appear in the existing library and pickers.

## Publish an exercise

An administrator opens **Library → Create your own exercise**, or edits an existing custom
exercise, then turns on **Share with the server** and saves. With the switch off, a new exercise
stays private. Other users can use published exercises in their routines but do not get their
edit/delete controls or the publishing switch. The API independently enforces the admin role.

Names, instructions, equipment, muscles, links and attached exercise media are shared. Private
workouts, progress pictures, body weight and account settings are never included. Publishing
requires a connection to the server. If it fails, the editor keeps the unsaved changes.

Signed-in clients refresh the catalogue on sign-in, on foreground return and every 30 seconds
while visible. Definitions are cached in the profile's custom exercises for offline sessions
and included in plan exports as ordinary custom exercises. An export does not grant server
catalogue permissions.

## Edit or stop sharing

Any administrator can edit a shared exercise. The API checks its revision to prevent an old
editor from overwriting a newer edit; reopen the exercise after a conflict.

Turning the switch off withdraws it from the common catalogue and keeps a private copy for the
administrator doing the withdrawal. Removing a published exercise also withdraws it. Clients
retain the last definition if a routine, workout, active session or favourite still references
it. Retired definitions disappear from exercise pickers, but existing plans and history retain
the name and muscle metadata. Already downloaded media may remain in the normal local cache.

## Storage and media

`DATA_DIR/shared-exercises.json` stores up to 1,000 published exercises and is written atomically.
Published exercise media is copied to `DATA_DIR/shared-exercise-media/`, independently of its
original owner's uploads, so private media garbage collection cannot delete a shared picture.
Include both in the existing data-directory backup.

Only files referenced by a currently published exercise are accessible to other signed-in
accounts through `/api/media/{hash}`. Unpublishing removes that permission. The shared media
folder retains the bytes; withdrawing an exercise does not delete files as a side effect.
With `MEDIA_UPLOADS=0`, exercises can still be shared without attached media.

## API

- `GET /api/shared-exercises`: signed-in users; returns `{ exercises: [...] }`.
- `PUT /api/admin/shared-exercises`: administrators; accepts `{ exercise, baseRevision? }`.
  New exercises need a `c`-prefixed custom id. Editing requires the current `serverRevision`.
- `DELETE /api/admin/shared-exercises`: administrators; accepts `{ id, baseRevision }`.
- `GET /api/config` advertises `shared_exercises: true`.

Older servers without these routes keep their existing private exercise behaviour. Both the
API and frontend need to be updated to publish and consume a server catalogue.
