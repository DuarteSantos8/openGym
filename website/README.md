# opengym.duarte-santos.ch

Source of the project website — plain hand-written HTML/CSS/JS, no build step,
served by nginx.

Not in this folder (added at deploy time):

- `img/` — built by `build-images.sh <dist>/img`: the five screenshots from
  `../assets/screenshots/` as PNG plus WebP at 480/600/1170 px (served through `<picture>`),
  `banner.png`, and `social.jpg` (1200×630, the og:image on every page)
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
only the brand, GitHub, Discord and the download button.

`site.js` carries five independent pieces, each one failing soft so the page is
complete without any of them: the topic-rail sheet, its scrollspy, the scroll
reveals, the demo iframe (injected only once the frame is on screen, and never
below 700 px, where the CSS swaps it for an "open it full-screen" card), and the
two things that come from the public api.github.com at view time — the star/issue
counts and the About page's release timeline. Both wait for `requestIdleCallback` so
they never compete with the hero image.

Every page starts with a "Skip to content" link (`.skip`, visible on focus) that
targets `<main id="main">`. Screenshots change under the same file name, and nginx
caches images for seven days — bump the name if a new one must show up at once.

`api.html` is the one **generated** file in here: `node scripts/build-api-docs.mjs`
rewrites it from `../api/openapi.yaml`. Edit the spec, re-run the script, commit both —
never hand-edit `api.html`, the next run overwrites it. The page is static HTML in this
site's own design (no Swagger UI, nothing rendered at view time); the only script of its
own it carries is the contents drawer and the card expand/collapse.

`styles.css` and `site.js` are cache-busted with `?v=N` — nginx serves the site
with `no-cache, must-revalidate`, but the query bump is what saves a Cloudflare
edge from handing out an old stylesheet with new markup. Bump it on every change.
