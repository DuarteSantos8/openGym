# TypeScript, step by step

openGym is moving from JavaScript to TypeScript one file at a time, while it keeps shipping. There
is no big rewrite and no freeze: JavaScript and TypeScript live side by side until the last file
has moved. Started in 1.4.6.

## How it is set up

- `frontend/tsconfig.json`: `allowJs` with `checkJs` off, so JavaScript runs as before and is never
  type checked. Every `.ts`/`.tsx` file is checked with `strict` and `noUncheckedIndexedAccess`.
- `tsc` only checks (`noEmit`). Vite and vitest compile TypeScript themselves.
- `npm run typecheck` in `frontend/` runs it, and CI runs it on every push (test.yml, "Type check").
- The MCP server and the API load some of the app's files straight in Node (see
  `mcp/scripts/check-node-loadable.mjs`). Node 22.18 and later strips types itself, so a shared file
  can be TypeScript as long as it uses only syntax that can be erased: no `enum`, no `namespace`,
  no parameter properties (`erasableSyntaxOnly` enforces this). Type-only imports say so:
  `import type { State } from '../types/model.ts'` (`verbatimModuleSyntax`).
- Imports name the real file, extension included: `./recap-period.ts`. Node needs that, and it
  keeps a renamed file from hiding behind a `.js` that is not there.

## The data types

`frontend/src/types/model.ts` describes the profile document: sets, entries, workouts, routines,
the state. A field goes in when a converted file reads it, with the meaning the code gives it, so
the types grow with the migration instead of being guessed up front. Almost everything is optional
because older profiles miss newer fields.

## Converting a file

1. `git mv lib/x.js lib/x.ts` (or `.jsx` to `.tsx`), then change its importers to `./x.ts`.
2. Type the exports first: parameters and return values. Inside, let inference do the work.
3. No `any`. Where data really is unknown (a payload from a server, an old backup), take `unknown`
   and narrow it, the way the JavaScript already checked it.
4. Behaviour stays the same. A conversion that finds a bug fixes it in its own commit, with a test.
5. `npm run typecheck`, the file's tests, and `node mcp/scripts/check-node-loadable.mjs` when the
   file is one the server loads.

Tests can stay JavaScript; they move when their file does, or later.

## Order

1. 1.4.6: the setup, `types/model.ts`, the first files.
2. The shared core the server also uses: `workout-model`, `format`, `onerm`, `progression`,
   `history`, `sync-merge`, `log-workout`, `routine-write`, and the store.
3. The big files, split while they move: `sheets.jsx`, `views/Workout.jsx`, `store/useStore.js`,
   `views/Settings.jsx`.
4. The other components and views.
5. The API and the MCP server, then `checkJs` on for whatever is left and finally no JavaScript.

Contributors: a pull request in JavaScript is still welcome. If its file has moved meanwhile, we
carry the change over.
