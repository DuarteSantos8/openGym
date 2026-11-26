# ADR 0015 — Answer questions about finding things in Ironvane

**Status:** Proposed on 2026-11-26. The owner decides whether to build local app help with optional Coach wording.

## What the Coach knows today

Someone asking “Where can I change how long my rest countdown lasts?” can reach the setting through **Settings → Workout → Rest timer**. The app has that search entry and the page route. At `ed1ce0033`, building the actual Coach ask prompt for this question with an empty synthetic profile included the question, training plan and exercise library. The prompt contained no Settings index or `/settings/workout` destination. A model could guess the steps. The app supplies no basis for verifying its answer.

## Proposed decision

Generate a small text index with each app build from three existing English sources and their translation keys:

| Source | What it supplies |
|---|---|
| `SEARCH` and page definitions in `frontend/src/views/settings-pages.js` | Setting names, keywords and their parent page. Example: Workout → Rest timer, at `/settings/workout`. |
| `GUIDES` in `frontend/src/content/learn.js` | Eight guide titles, summaries and IDs, including Your first week at `/learn?g=first-week`. |
| `STEPS` in `frontend/src/lib/tour.js` and visible step copy in `frontend/src/components/Tour.jsx` | Tour instructions and destinations, such as going from Home to Plan. Some steps require an active session or another condition. |

Offer an explicit app-help action in Coach. Match the question locally against titles and keywords and show the matching steps in the selected language. Keep links under app control. A Settings result may open its parent page and name the row to tap. Use the same availability rules as Settings search and the tour for the current build, modules and session. Omit any entry whose availability or destination cannot be resolved. When nothing matches, offer Settings search or Learn. Keep help read-only.

If the person asks Coach to explain a match, send one text request containing only the question and up to three short, visible help entries. Build a separate help payload. The existing training ask payload includes profile and history. Keep those fields, account identifiers, earlier messages, exercise media and photos out of help requests. Accept text referencing only the selected entries. Resolve their links locally and show the local result if the model response cannot be used. Apply the existing provider consent and Coach limits to this call.

## Cost per question

Local lookup uses zero model tokens and costs $0, including offline. An optional explanation uses at most one provider call. For metered plans, its cost is the provider-reported input and output tokens multiplied by their respective per-token rates. For the hosted MiniMax Token Plan, record one use against the plan allowance. Its hourly usage report cannot establish an individual question's dollar cost. During verification, record observed tokens and billing where available.

## Acceptance before release

Check a Settings result, a Learn guide and a tour action against the actual screens. Check a hidden module, an unknown phrase, a translated question and an offline device. Capture the outgoing explanation request using synthetic data and verify its field allowlist. A substituted link or request to modify training must leave the local result usable and the training profile unchanged.

Accept this proposal to authorize a separate implementation PR. Rejecting or deferring it keeps the existing Settings search, Learn and tour as the ways to find these screens.
