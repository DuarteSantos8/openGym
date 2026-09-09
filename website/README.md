# opengym.duarte-santos.ch

Source of the project website — plain hand-written HTML/CSS/JS, no build step,
served by nginx.

Not in this folder (added at deploy time):

- `img/` — the five screenshots from `../assets/screenshots/` plus `banner.png`
- `icon-180.png` / `icon-512.png` — copied from `../frontend/public/` (the same
  icons the PWA uses, so the browser tab, home screen and app all match)
- `openGym.apk` — the signed release build (see `../docs/MOBILE.md`)
- `demo/` — the browser-only demo build of the app, embedded in the `#demo` section and
  reachable on its own at `/demo/`. Built from `../frontend` with `VITE_DEMO=1` and the
  jsDelivr media bases (see the `pages` job in `../.gitlab-ci.yml`), so the ~140 MB
  of exercise media stays out of it. It has to live on this host: the site frames it, and
  `X-Frame-Options: SAMEORIGIN` would block it from anywhere else.

Navigation is a topic rail (`.side`): one title/subtitle list of everything on the
site, a fixed column beside the page from 1300 px up and the hamburger sheet below
that, with a scrollspy lighting the section under the reader. The top bar keeps
only the brand, GitLab, Discord and the download button.

`site.js` carries five independent pieces, each one failing soft so the page is
complete without any of them: the topic-rail sheet, its scrollspy, the scroll
reveals, the demo iframe (injected only once the frame is on screen, and never
below 700 px, where the CSS swaps it for an "open it full-screen" card), and the
two things that come from the public gitlab.com API at view time — the star/issue
counts and the About page's release timeline. Those two URLs pointed at
api.github.com until that account was suspended; they go back once it is restored.

`api.html` is the one **generated** file in here: `node scripts/build-api-docs.mjs`
rewrites it from `../api/openapi.yaml`. Edit the spec, re-run the script, commit both —
never hand-edit `api.html`, the next run overwrites it. The page is static HTML in this
site's own design (no Swagger UI, nothing rendered at view time); the only script of its
own it carries is the contents drawer and the card expand/collapse.

`styles.css` and `site.js` are cache-busted with `?v=N` — nginx serves the site
with `no-cache, must-revalidate`, but the query bump is what saves a Cloudflare
edge from handing out an old stylesheet with new markup. Bump it on every change.
