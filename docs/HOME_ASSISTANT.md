# Home Assistant

openGym runs happily next to Home Assistant, and there are two ways to connect them.

| You want | Use |
|---|---|
| A message to Home Assistant when you finish a workout, set a record or weigh in | openGym's own [webhooks](INTEGRATIONS.md#webhooks) (`INTEGRATIONS`). Built in, nothing to install. |
| openGym **inside** Home Assistant: in the sidebar, already signed in, with sensors and services | The community add-on below. |

## The community add-on

[**opengym-ha**](https://github.com/Amantux/opengym-ha) is a Home Assistant add-on and a HACS
integration for openGym. It is maintained by a community contributor, not by this project, and is
not tested or supported here: problems with the add-on or its sensors belong in
[its issues](https://github.com/Amantux/opengym-ha/issues); problems inside the app belong in
this repository's issues, as always.

What it adds:

- **openGym in the Home Assistant sidebar, with no second sign-in.** A passkey cannot be created
  inside Home Assistant's frame, so the add-on signs each Home Assistant user in to their own
  openGym profile (made the first time they open it). The first profile on the instance becomes
  the admin, so open it yourself first.
- **Sensors per profile:** body weight, last workout, workouts this week and in the last 7 days,
  today's routine.
- **Services and an event:** `opengym.log_body_weight` (for a smart-scale automation),
  `opengym.get_summary`, and `opengym_workout_completed`.

It builds on your own machine at install from the official `opengym-api` and `opengym-web`
images, pinned by digest, so the exercise photos and animations are never re-hosted
([NOTICE.md](../NOTICE.md)). Each openGym release is tested against the add-on. If every test
passes, the release reaches the add-on as an update. If a test fails, the add-on keeps its
previous version.

### What it changes, so you can judge it

The add-on does not fork openGym. It carries **one small patch to `api/server.js`**, applied at
build with no fuzz, which does two things: the api can bind to loopback (`HOST`), and a second
listener on a unix socket (`HA_INTERNAL_SOCKET`, mode 0600, off unless set) lets the add-on's
gateway find or create the profile for a Home Assistant user and ask for a one-minute session.
Those sessions are openGym's own (`makeSession`), so "sign out everywhere", disabling and
deleting a profile end them as they end any other. Nothing in the public listener, its routes or
its CSRF and origin checks is touched.

**Taking someone's access away.** Home Assistant decides who can open the panel, so removing the
person from Home Assistant is the first step. In openGym, use **Disable account** (Admin) on their
profile: it ends their sessions and keeps them out, and **Enable account** brings them back. Do
not use **Delete account** for that: the next time a Home Assistant user opens the sidebar, the
add-on makes them a new, empty profile.

**Admins** cannot be disabled (openGym answers "cannot disable an admin"). To remove one, the
owner first takes their admin role away (**Remove admin**, owner only), then disables the account.
If the person leaving is the owner, make another admin the owner first (**Make owner**).

Direct access from outside Home Assistant is off by default; when it is turned on, openGym's own
sign-in (passkeys, or a password if `PASSWORD_LOGIN` is on) applies as usual.

### Install

1. In Home Assistant: *Settings → Add-ons → Add-on store → ⋮ → Repositories*, add
   `https://github.com/Amantux/opengym-ha`, install **openGym** and start it.
2. For the sensors and services, in HACS add the same repository under *Custom repositories*
   with type **Integration**, download **openGym**, restart Home Assistant, then accept the discovered openGym under *Settings → Devices &
   services*. If you do not use HACS, follow the add-on's Documentation tab instead.

For a standalone openGym that you run yourself, keep following [self-hosting](SELF_HOSTING.md).
