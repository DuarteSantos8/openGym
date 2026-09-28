<!-- GitLab has no issue *forms*, only these Markdown templates: the prompts below are the
     same ones the GitHub/gitea forms asked for, and they are here because leaving them out
     costs a round-trip on nearly every report. Delete the italics as you fill them in. -->

/label ~bug

### What did you do?

*Steps to reproduce, as precisely as you can.*

1.
2.
3.

### What did you expect to happen?

### What happened instead?

*Error messages, console output or screenshots if you have them.*

### How are you running openGym?

*Pick one: self-hosted (docker compose) · frontend dev server (`npm run dev`) · Android APK ·
other / not sure*

### Version & environment

- openGym version or commit:
- Browser & OS: *e.g. Safari 17 on iOS 18, Chrome 126 on Android*

### Is this about login / passkeys?

Most login issues are an `RP_ID`/`ORIGIN` mismatch — check your `.env` against the domain you
reach openGym on before reporting. See the [self-hosting guide](../../docs/SELF_HOSTING.md).

- [ ] Yes, and I have already checked `RP_ID`/`ORIGIN`
- `RP_ID` =
- `ORIGIN` =
- What sits in front of the app (reverse proxy, tunnel, none):

<!-- Security bug? Do not use this template. Open a *confidential* issue instead — tick
     "This issue is confidential" before submitting. See SECURITY.md. -->
