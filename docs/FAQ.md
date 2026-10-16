# FAQ

Short answers, with a link to the long one.

### What does it cost?

Nothing. Gains is open source under the AGPL: no subscription, no paid tier, no ads.

### Do I need my own server?

No, there are three ways to use it:

- **Try it:** there is no public demo or instance. Gains is in a private beta; you run your own.
- **Phone only:** the Android app needs no server and no account; everything stays on the phone.
  See [MOBILE.md](MOBILE.md).
- **Your own instance:** `docker compose up` on any machine with Docker gives you sync between
  devices and profiles for friends and family. See [SELF_HOSTING.md](SELF_HOSTING.md).

### Is there an iPhone app?

Not in the App Store, and Apple doesn't allow installing apps from anywhere else. On an iPhone you can
self-host and add Gains to your home screen from Safari (it's a full PWA that works offline), or
build the native app onto your own phone with Xcode. Both are described in [MOBILE.md](MOBILE.md).
An App Store build is on the [roadmap](../ROADMAP.md).

### Why isn't it on the Play Store?

There is no store listing and no download yet: Gains is a personal project in a private beta. You
build the Android app yourself ([docs/MOBILE.md](MOBILE.md)) or use your own instance as a
home-screen app.

### Where is my data?

On a self-hosted instance, in the `./data` folder next to `docker-compose.yml`: one JSON file per
profile plus the account list. Back up that folder and you've backed up everything. In the phone app
it's in the app's private storage. In guest mode it's only in that browser. You can export
everything as one file at any time under **Settings → Data & backup**.

### Does the app send anything anywhere?

Your instance has no telemetry and phones home to nobody. The exercise pictures and animations ship
inside the web image, so not even those are downloaded. The AI coach, if an admin turns it on, sends
the training data it needs to the provider you configured; [AI_COACH.md](AI_COACH.md) lists exactly
what. Push notifications go through your browser's push service, as all web push does.

### Was Gains written with AI?

It's developed with [Claude Code](https://claude.com/claude-code), Anthropic's coding agent, and a
large share of the code, tests and docs is drafted that way. The training logic is covered by unit
tests that run on every pull request. The longer answer is in
the [README](../README.md#how-gains-is-built).

### Does the app itself use AI?

Only if you turn it on. The default install calls no AI service. Two optional pieces exist: the
[AI coach](AI_COACH.md) (off until an admin enables it, runs with your own provider key, every
change needs your approval) and the [MCP server](../mcp/README.md), which lets an AI client on your
computer read your history. Neither is needed for anything else in the app.

### My passkey sign-in doesn't work.

Almost always one of two things:

1. You're opening it over plain `http://` on a LAN address. Passkeys only work over HTTPS (or on
   `localhost`). Use guest mode, turn on password sign-in, or put it behind HTTPS.
2. `RP_ID` and `ORIGIN` in `.env` don't match the address in your browser exactly.

[SELF_HOSTING.md](SELF_HOSTING.md#2-understand-the-passkey-requirement-important) explains both, and
its troubleshooting section covers the rarer cases.

### Can I use a password instead of a passkey?

Yes, if the instance allows it: set `PASSWORD_LOGIN=1`. It's off by default. See
[password sign-in](SELF_HOSTING.md#password-sign-in-optional).

### Can several people use one instance?

Yes. Everyone creates their own profile and sees only their own data. You can make signup
invite-only and give yourself an admin dashboard; see
[multiple users](SELF_HOSTING.md#4-multiple-users).

### How do I update?

`git pull && docker compose pull && docker compose up -d`. Your data is untouched. See
[updating](SELF_HOSTING.md#8-updating).

Then update the app on every device that syncs. A phone still on v1.3.9 or older keeps syncing,
and the server looks after what that phone doesn't know about, but it can't always tell what the
phone has seen. One case it gets wrong on purpose: if the old phone sets something back to exactly
what it was before, after another device changed it, the other device's change wins. Once every
device is updated, nobody has to guess.

### I'm moving from another app. Can I bring my history?

FitNotes, Strong and Hevy work out of the box, Apple Health for body weight, and any CSV with a date,
an exercise and something measured. See [DATA_IMPORTS.md](DATA_IMPORTS.md).

### Can I reuse the exercise images in my own project?

No. They are © Aliaksandr Makatserchyk, Gym visual, licensed to the openGym project and not covered
by the AGPL. Gains is a fork of openGym and uses them unmodified, at 180 px, non-commercially.
Anything else needs your own licence from [gymvisual.com](https://gymvisual.com/). Details in
[NOTICE.md](../NOTICE.md). The exercise text in [catalogue/](../catalogue/README.md) is a different
story: that's openGym's, under openGym's AGPL, and fixes are welcome.

### Where do I ask something that isn't here?

Open an [issue](https://github.com/steradrian/gains/issues).
