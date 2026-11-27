# ADR 0009: Exercise media in a commercial build

- Status: accepted (2026-11-22, owner go-ahead on the plan's defaults); **blocks the first paid deploy**
- Context: `NOTICE.md` is explicit. The stills and animations in `catalogue/media/` are licensed to openGym by Gym visual, not under the AGPL: "A non-commercial fork of openGym may keep the unmodified 180 px media together with this notice. A commercial fork, or any other use, needs its own licence from gymvisual.com." The same notice forbids using the media "to train, prompt or feed any AI system, or as a basis for generated images, animations or video". Charging for a Pro tier makes the hosted Ironvane build commercial.

## Decision

The **Cloud edition ships without Gym visual media** until one of these is true:

- **A (default):** the media are replaced in the cloud build by sources whose licence allows commercial use: the fork's own 3D mannequin demos (EP26, own work), the CC-licensed demo clips and photos already under `catalogue/demos/` and `catalogue/photos/` with their attributions, and public-domain photos (free-exercise-db, Unlicense) where nothing else exists.
- **B:** the owner buys a commercial licence from Gym visual that covers the hosted app, and files the licence under `docs/next/licences/` (not the media, the paper).

The default edition (non-commercial, self-hosted) keeps the unmodified 180 px media and the notice, as it does today.

## Rules for agents

1. Never pass anything under `catalogue/media/` to a model, a generator or a script that calls one. Not as input, not as a reference, not as a "style".
2. Never copy the media out of the repository or raise their resolution.
3. The cloud build's media come from a manifest (`catalogue/media-sources.json`, EP18-T04) that names the licence and author per file. A file without a commercial-use licence fails that build.
4. Exercise *text* is a separate matter: see `NOTICE.md` "Exercise text".

## Consequences

- EP18-T04 (the manifest and the build filter) and EP26-T01 (the mannequin) are on the critical path for monetisation, not polish.
- The safe reading is that a build on the way to taking money is commercial. So the Cloud edition is built without Gym visual media from its first public deploy, not only from the day Stripe goes live. Local development and Stripe test mode are not a public deploy.
- Not legal advice. Before going live, the owner confirms the reading of Gym visual's terms with Gym visual in writing.
