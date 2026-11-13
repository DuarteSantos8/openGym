# openGym on NixOS — Flake & NixOS Module

openGym can run natively on NixOS through its **Nix flake** and **NixOS module** — no Docker, no
`docker compose`. The flake builds every openGym component (frontend with the exercise media, API,
MCP server) as reproducible Nix packages; the module declares the whole stack as systemd services
managed by your NixOS configuration. This document covers both.

## 1. Technical introduction

### What the flake provides

`contrib/nix/flake.nix` (inputs: `nixpkgs` pinned to the `nixos-26.05` release branch,
`flake-utils`) exposes, per supported system:

| Output | What it is |
| --- | --- |
| `packages.opengym-frontend` | The React/Vite PWA, built with `buildNpmPackage`. Static files land in `$out/share/opengym`, with the exercise stills and animations from `catalogue/media` in `exercise-media/` next to them. |
| `packages.opengym-api` | The Node.js API (`node server.js`, wrapped as `bin/opengym-api`). |
| `packages.opengym-mcp` | The MCP server for LLM clients (`bin/opengym-mcp`): read tools, plus `log_workout` once paired (`mcp/README.md`). |
| `packages.default` | Alias for `opengym-frontend`. |
| `apps.opengym` | Runs the **full local stack** — API + frontend (exercise media included) behind a throwaway Caddy (`nix run .#opengym`, default `http://localhost:8080`). |
| `apps.default` | Alias for `opengym`. |
| `devShells.default` | Development shell: Node.js 22, coreutils, git. |
| `checks.nixos-module-eval` | Evaluates the module against a list of scenarios (`module-check.nix`) and asserts the resulting services/users/nginx state, environment, hardening and TLS config — plus the configurations that must fail to evaluate (mutually exclusive options, removed options), and a check that this document's option → environment table names every variable the module sets. |
| `checks.opengym-nixos-test` *(Linux)* | Boots a NixOS VM and exercises the HTTP contract end to end (API health, nginx vhost proxy, SPA, exercise media — including the cache and Cross-Origin-Resource-Policy headers). The only VM-test output: the flake has no `nixosTests` attribute, and building one warns. |
| `nixosModules.opengym` | The NixOS module (`nixosModules.default` aliases it). |

### What the NixOS module does

`services.opengym.enable = true` manages, purely declaratively:

- a system `opengym` user/group and the data directory (`/var/lib/opengym` by default),
- `systemd.services.opengym-api` — a **hardened** API unit (see [Systemd hardening](#systemd-hardening)),
- `systemd.services.opengym-mcp` — the MCP server, **only if `mcp.enable` is set**,
- read-only options exposing the built frontend and media directories so *your* web server can
  serve them (or `nginx.enable = true` for the module to manage one — see §4),
- `environment` / `environmentFile` — escape hatches to pass extra environment variables to the
  API (for variables openGym doesn't know about yet). See [Module options reference](#6-module-options-reference).

The module **does not own a web server by default**: it hands you the `web.root` store path (the
exercise media are inside it) to wire into your own reverse proxy (Caddy, nginx, Traefik, …).
openGym needs everything on **one origin** (passkeys require it), and NixOS deployments already run
a proxy — so the module integrates openGym into *yours* instead of re-implementing a web server
itself. See §4. If you'd rather have openGym's web server managed for you, set
`services.opengym.nginx.enable = true` and the module configures an nginx virtualHost for openGym
(only then does the module touch `services.nginx` at all; on the Caddy-native default it leaves
whatever web server you configured alone).

### Configuration flow

```text
browser ── HTTPS ──▶ your web server (Caddy / nginx / …)         everything on ONE origin
                     ├─ /         → web.root            (built SPA, SPA fallback to /index.html;
                     │                                   exercise media under /exercise-media/)
                     └─ /api/*    → opengym-api          (systemd, hardened, :3000 internally)
                                                    │
                              opengym-api ──reads/writes──▶ dataDir (/var/lib/opengym)
```

## 2. Repository layout

```text
contrib/nix/
  flake.nix          Flake entry point — packages, apps, devShell, module alias, eval-check
                     scenarios (the module's test data; the machinery is module-check.nix)
  flake.lock         Locked inputs
  opengym.nix        The NixOS module (options + systemd/nginx wiring)
  node-package.nix   The packaging module shared by the API and the MCP server: stages the
                     app, proves every import it ships resolve, wraps the binary
  serving.nix        The serving contract (routes + media headers), rendered for nginx and Caddy
  module-check.nix   The eval-level check machinery: scenarios → one evaluated system each →
                     one check derivation reporting every failure together
  api.nix            The API's layout over node-package.nix → bin/opengym-api
  mcp.nix            The MCP server's layout over node-package.nix → bin/opengym-mcp
  frontend.nix       buildNpmPackage → $out/share/opengym (+ exercise-media/ from catalogue/media)
  tests.nix          The VM integration test (checks.opengym-nixos-test): boots the stack and
                     exercises the HTTP contract
  default.nix        package-set aggregator (used by both the flake and the module); reads the
                     release version from api/package.json
```

Everything Nix lives under `contrib/nix/` so the flake stays out of the way of the project's own
build (Docker, CI, the Node packages). The flake reads its sources — `api/`, `frontend/`, `mcp/`,
`catalogue/` — from the repository root two levels up, so it must be evaluated *from a checkout of
the whole repo*, never from a sparse copy of `contrib/nix` alone.

## 3. Building and using the packages

Requirements: Nix with flakes enabled (`nix.conf`: `experimental-features = nix-command flakes`).

```bash
# the flake lives in contrib/nix — start there (from the repo root: nix build ./contrib/nix#… )
cd contrib/nix

nix build .#opengym-frontend         # static site + exercise media → result/share/opengym
nix build .#opengym-api              # API → result/bin/opengym-api
nix build .#opengym-mcp
nix run .#opengym                    # full local stack on http://localhost:8080 (see below)
nix develop                          # dev shell: nodejs_22, git, coreutils
nix flake check                      # eval check + (on Linux) the VM integration test
nix build .#checks.x86_64-linux.nixos-module-eval   # just the eval check (scenarios)
nix build .#checks.x86_64-linux.opengym-nixos-test  # just the VM integration test
```

`nix flake check` is the full gate: the eval check (a few seconds) and, on Linux, the VM
integration test (builds and boots a QEMU image — minutes). Nothing runs it in CI yet, so run it
after touching anything under `contrib/nix/`. Separately from the checks, building `opengym-api`
or `opengym-mcp` proves at build time that every relative import the package ships resolves —
a package that would boot as `ERR_MODULE_NOT_FOUND` fails the build instead, which is the point of
`node-package.nix` (see §2).

`nix run .#opengym` starts the API and the built frontend (exercise media included) behind a
throwaway Caddy — open `http://localhost:8080` and use it (passkeys work on `localhost`). Overrides via env
vars: `OPENGYM_DATA_DIR` (default `/tmp/opengym-data`), `OPENGYM_API_PORT` (3000),
`OPENGYM_WEB_PORT` (8080), `OPENGYM_RP_ID`/`OPENGYM_ORIGIN` (local defaults). Bear in mind the API
and frontend ports are just defaults — like any local dev server, don't point it at the internet.

For development, `nix develop` drops you into a shell with everything except `node_modules`;
inside it, the standard flow applies:

```bash
cd frontend && npm install && npm run dev     # Vite dev server on :5173, proxies /api to :3000
cd api && npm install && node server.js       # API on :3000
cd mcp && npm test                            # MCP server tests
```

## 4. Serving the app

The module creates the services but never serves HTTP itself. Point your existing reverse proxy —
always on a **single origin** — at the store paths the module exposes:

| Read-only option | Value | Contains |
| --- | --- | --- |
| `config.services.opengym.web.root` | `…-opengym-frontend/share/opengym` | the built SPA, exercise media included |
| `config.services.opengym.media.root` | `${web.root}/exercise-media` | `still/<id>.webp` and `clip/<id>.mp4`, 180 px |

The URL contract the frontend expects ([`frontend/src/lib/exercises.js`](../frontend/src/lib/exercises.js)):

| URL path | Served from | Notes |
| --- | --- | --- |
| `/` | `web.root` | SPA — any unknown path falls back to `/index.html` |
| `/api/*` | `opengym-api` (the `apiPort` you configured) | reverse proxy, keep `/api` on the URL |
| `/exercise-media/*` | `web.root` | plain static files; nothing extra to map |

The exercise media come from `catalogue/media` in the source tree, copied next to the app at build
time by `scripts/catalogue/stage-media.mjs` (the same step the demo and app builds use). Nothing is
downloaded, at build time or at runtime. They are licensed from Gym visual for openGym only and
stay at 180 px; don't publish that directory on its own (see [`NOTICE.md`](../NOTICE.md)).

### Caddy

The idiomatic NixOS pairing (Caddy terminates TLS, gets automatic certs). Put this in a NixOS
module (where `config` is in scope) so the store paths resolve from the module's read-only options:

```nix
{
  services.caddy = {
    enable = true;
    virtualHosts."gym.example.com" = {
      extraConfig = ''
        encode zstd gzip

        handle /exercise-media/* {
          header {
            Cache-Control "public, max-age=2592000, immutable"
            Cross-Origin-Resource-Policy same-origin
          }
        }

        handle /api/* {
          reverse_proxy 127.0.0.1:${toString config.services.opengym.apiPort}
        }
        handle {
          root * ${config.services.opengym.web.root}
          try_files {path} /index.html
          file_server
        }
      '';
    };
  };
}
```

The routes and their headers are openGym's serving contract, stated once in
[`contrib/nix/serving.nix`](../contrib/nix/serving.nix) and rendered for nginx (by the module)
and for Caddy (by this config and by `nix run .#opengym`). If you hand-write your own, this is
the shape to keep: the API must **keep** its `/api` prefix (openGym routes on it), and
`/exercise-media/*` carries the two headers — a month of browser caching, and
Cross-Origin-Resource-Policy, because the media are licensed for openGym only and no other site
may embed them. Caddy sets the `X-Forwarded-*` headers itself, so the proxy needs nothing else;
the `try_files` fallback to `/index.html` covers unknown SPA paths only.

### nginx

Two ways to use nginx. If you don't already run an nginx config you care about, let the module
manage one:

```nix
{
  services.opengym = {
    enable = true;
    rpId   = "gym.example.com";
    origin = "https://gym.example.com";
    nginx = {
      enable = true;              # module writes the virtualHost below for you
      # hostName   = "gym.example.com";   # defaults to rpId
      # enableACME = true;                # Let's Encrypt + force TLS (requires security.acme.acceptTerms = true)
    };
  };
  security.acme.acceptTerms = true;       # only needed with enableACME = true
}
```

That renders a `services.nginx.virtualHosts."gym.example.com"` with the SPA root + fallback, the
`/api` proxy, the serving contract's headers on `/exercise-media/` (a month of caching plus
Cross-Origin-Resource-Policy), gzip/optimisation settings, and — when `enableACME` — TLS. It's
ordinary `services.nginx` config afterwards, so you can still extend the vhost or add your own
virtualHosts alongside it.

Note: the module declares no web server of its own, so on the Caddy-native default it leaves
`services.nginx` exactly as you configured it. To have it configure the openGym vhost, set
`nginx.enable = true`; to run your own, simply do nothing.

### Passkey constraint (read before choosing a hostname)

WebAuthn passkeys are bound to an exact hostname and require HTTPS. Configure the module with the
name that appears in the browser's address bar, not a container name or internal port:

```nix
services.opengym = {
  rpId   = "gym.example.com";            # bare hostname — no https://, no port
  origin = "https://gym.example.com";    # full origin — scheme, no trailing slash
};
```

Changing `rpId` later invalidates every registered passkey. On a LAN without certificates,
plain `http://<ip>` can't do passkeys — use guest mode or put a certificate in front of it.
The full `RP_ID`/`ORIGIN` troubleshooting guide in
[`docs/SELF_HOSTING.md`](SELF_HOSTING.md#passkeys-fail-even-though-rpid-looks-right) applies
word-for-word.

## 5. Using the NixOS module

### Add the flake as an input

```nix
# flake.nix
{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    # the flake lives in a subdirectory — ?dir= points at it
    opengym.url = "github:DuarteSantos8/openGym?dir=contrib/nix";
  };

  outputs = { self, nixpkgs, opengym, ... }: {
    nixosConfigurations.myhost = nixpkgs.lib.nixosSystem {
      system = "x86_64-linux";
      modules = [
        opengym.nixosModules.default
        ./configuration.nix
      ];
    };
  };
}
```

On the GitLab mirror the same input is
`"git+https://gitlab.com/DuarteSantos8/opengym?dir=contrib/nix"`.

Then `sudo nixos-rebuild switch --flake .#myhost`.

Not using flakes in your NixOS config? You can also `imports` the module file directly from a
checkout of the repo:

```nix
{ imports = [ "/path/to/opengym/contrib/nix/opengym.nix" ]; }
```

#### Package provenance

When you load the module *through the flake* (`opengym.nixosModules.default`), the default
`services.opengym.package` set is the one built by this flake — from the flake's **locked**
`nixpkgs` input. Importing `contrib/nix/opengym.nix` directly instead falls back to building the
packages from *your system's* nixpkgs, which may differ slightly. If you ever need a specific set,
override `services.opengym.package` explicitly (e.g. `opengym.packages.x86_64-linux` from your flake
inputs).

### Minimal enable (works on `localhost`)

```nix
{
  services.opengym = {
    enable = true;
    rpId = "localhost";
    origin = "http://localhost:8080";
  };
}
```

This gives you the `opengym` system user, `/var/lib/opengym` (created via `StateDirectory` +
tmpfiles — the default `dataDir`) and the `opengym-api` service listening on `:3000`. The exercise
media are already in the frontend package. Pair it with the Caddy or nginx config from §4 pointing
at `web.root`.

### A realistic production example

```nix
{
  services.opengym = {
    enable = true;

    rpId   = "gym.example.com";
    origin = "https://gym.example.com";
    rpName = "My gym";

    adminUids  = [ "u-abc123" ];      # list of user IDs; gets the admin dashboard
    inviteOnly = true;                # new signups need an invite code
    allowGuest = false;               # remove "Continue without account"

    auditLog = true;
    auditIp  = "net";                 # record masked network address only

    mcp.enable = false;               # off unless you use an LLM client
  };

  security.acme.acceptTerms = true;
  services.caddy.enable = true;       # or configure nginx as in §4
}
```

### Extra environment variables

openGym's server is env-var driven, so from time to time a new variable reaches the project
before the module grows an option for it. Two options cover the gap — and they are **mutually
exclusive** (setting both is an evaluation error):

```nix
# Per-variable, declared in Nix:
services.opengym = {
  enable = true;
  environment = {
    NEW_FLAG = "1";          # anything the module doesn't already manage
  };
};
```

```nix
# From an existing env file (KEY=VALUE per line), e.g. generated by sops-nix or a tmpfiles rule:
services.opengym = {
  enable = true;
  environmentFile = "/run/opengym/env";
};
```

Both apply to the `opengym-api` systemd unit only; the module's own options take precedence on a
name collision (and for `environmentFile`, systemd applies the file after the declarative
variables, so entries there can still override).

### What enabling the module creates

| Piece | When | Details |
| --- | --- | --- |
| `users.users.opengym`, `users.groups.opengym` | always | system user/group |
| tmpfiles rules | always | `dataDir` (`0750`) |
| `systemd.services.opengym-api` | always | `Restart=on-failure`, runs as `opengym`, hardened |
| `systemd.services.opengym-mcp` | only when `mcp.enable = true` | stdio bridge, runs as `opengym`, same sandbox as the API |
| `services.nginx` vhost | only when `nginx.enable = true` | managed virtualHost (SPA + `/api`, exercise media from the SPA root) |
| `services.nginx` | never touched | the module declares no web server of its own: your `services.nginx` (or Caddy) stays exactly as you configured it |

<span id="systemd-hardening"></span>
The API unit runs under the module's shared sandbox: `NoNewPrivileges`, `ProtectSystem=strict`,
`ProtectHome`, `PrivateTmp`, `PrivateDevices`, the `ProtectKernel*` set (tunables, modules, logs)
with `ProtectControlGroups`, `ProtectHostname` and `ProtectClock`, `RestrictNamespaces`,
`RestrictSUIDSGID`, `RestrictRealtime`, `RemoveIPC`, `LockPersonality`, `UMask=0077`,
`CapabilityBoundingSet=""` — no capabilities at all — `SystemCallArchitectures=native`,
`RestrictAddressFamilies` narrowed to `AF_INET`, `AF_INET6`, `AF_UNIX` and `AF_NETLINK`, a
system-call allowlist (`@system-service`, `~@privileged`), and `ReadWritePaths` limited to
`dataDir` — the API can only write to your data directory. The MCP unit is a **stdio bridge that
only reads** the same files, so it runs under the exact same sandbox (plus `StandardInput=null` /
`StandardOutput=journal`, since a systemd-spawned MCP server has no client on stdin).

## 6. Module options reference

All options live under `services.opengym`. Options marked *(read-only)* are computed by the module
for other modules to consume — setting them yourself is an error.

### Top-level options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `enable` | `bool` | `false` | Enable openGym (user, services, directories). |
| `package` | `attrsOf package` | packages built from source | The package set: `{ opengym-frontend, opengym-api, opengym-mcp }`. Override to serve pre-built binaries (e.g. from a cache). |
| `dataDir` | `path` | `/var/lib/opengym` | Persistent data directory — `db.json`, per-user `state-<uid>.json`, `secret`, `vapid.json`, `audit.log`. With the default `/var/lib/opengym`, systemd's `StateDirectory` creates (and cleans up) it; a custom path is created by a tmpfiles rule and `ReadWritePaths` points at it instead. |
| `apiPort` | `port` | `3000` | Port the API listens on (internal — reachable via your reverse proxy, front it yourself if you open the firewall). |
| `rpId` | `str` | `localhost` | WebAuthn Relying Party ID. Bare hostname, must match the address bar exactly. |
| `origin` | `str` | `http://localhost:8080` | Full origin for CSRF validation. Must match the address bar exactly (scheme + host, no trailing slash). |
| `rpName` | `str` | `openGym` | Display name shown when the browser prompts for a passkey. |
| `defaultLang` | `string \| null` | `null` | Default language for the sign-in screen and new profiles, as a language tag such as `pt-BR` or `de`. `null` keeps the browser default. |
| `sessionDays` | `ints.unsigned` | `90` | Session cookie lifetime, in days. |
| `adminUids` | `listOf str` | `[]` | User IDs granted the admin dashboard, as a list. Empty list = no admin. |
| `inviteOnly` | `bool` | `false` | Require an invite code to create a new profile. |
| `allowGuest` | `bool` | `true` | Offer "Continue without account" (guest mode — never touches the server). Set `false` to remove the button. |
| `passwordLogin` | `bool` | `false` | Offer name-and-password sign-in next to passkeys. Passwords kept from when it was on are inert while it is off. |
| `firstUserAdmin` | `bool` | `false` | Grant the first profile created on an empty instance admin access. |
| `trustProxy` | `bool` | `true` | Let the sign-in throttle and audit log read the client address from the headers a proxy sets. Defaults to true because a NixOS deployment always fronts the API with a reverse proxy. Set false only if the API port is directly reachable, where those headers could be spoofed. |
| `auditLog` | `bool` | `true` | Record sign-ins, signouts, failed attempts and admin actions to `audit.log`. |
| `auditMax` | `ints.unsigned` | `5000` | Max audit events kept (`0` = unlimited). |
| `auditDays` | `ints.unsigned` | `90` | Max days of audit events kept. |
| `auditIp` | `enum ["off" "net" "full"]` | `"off"` | IP recording mode: `off` (none), `net` (network only, e.g. `203.0.113.0/24`), `full`. |
| `vapidSubject` | `str` | `""` | Contact URL sent with web-push requests (e.g. `mailto:you@example.com`). Empty = the `origin` is sent. |
| `coachDisabled` | `bool` | `false` | Switch the AI Coach off entirely. |
| `coachJobTimeoutSeconds` | `ints.unsigned \| null` | `null` | Budget for a single Coach job, in seconds. `null` keeps the app's five-minute default; a set value is a floor of one minute. |
| `allowedPrivateIps` | `listOf str` | `[]` | Private addresses and CIDR blocks the server may push to (webhooks), as a list. |
| `environment` | `attrsOf str` | `{ }` | Extra environment variables set on the `opengym-api` unit — the escape hatch for variables the module doesn't manage yet (newly added to the project). On a conflict with a variable the module derives from its own options, the module's value wins. Mutually exclusive with `environmentFile`. |
| `environmentFile` | `str` | `""` | Path to an env file (`KEY=VALUE` per line) read by the `opengym-api` unit via systemd `EnvironmentFile=`. systemd applies it *after* the declarative environment, so entries in the file may override module-managed variables. Mutually exclusive with `environment`. |

### `nginx.*` suboptions

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `nginx.enable` | `bool` | `false` | Have the module configure an nginx virtualHost for openGym via `services.nginx` (SPA root + fallback, `/api` proxy, cache header on `/exercise-media/`, gzip/optimisation). When `false` (Caddy-native default) the module leaves `services.nginx` as you configured it. |
| `nginx.hostName` | `str` | `"${rpId}"` | Server name the virtualHost listens on. |
| `nginx.enableACME` | `bool` | `false` | Serve over TLS: `enableACME` + `forceSSL` on the vhost. Requires `security.acme.acceptTerms = true`. |

### `media.*` suboptions

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `media.root` *(read-only)* | `path` | — | `${web.root}/exercise-media`: the stills (`still/<id>.webp`) and animations (`clip/<id>.mp4`). Serving `web.root` already serves it; the option is there for setups that need the path on its own. |

`media.fetchAtBuild`, `media.dataDir`, `media.imageRoot` and `media.gifRoot` were removed in
v1.4.0, when the media moved into the repository. A configuration that still sets one fails to
evaluate with a message saying what to do: delete `fetchAtBuild` and `dataDir`, and replace
`imageRoot`/`gifRoot` (and the `/img/`, `/gif/` routes built on them) with `web.root` alone. An
old `/var/lib/opengym/media` directory is no longer used and can be deleted.

### `uploads.*` suboptions

These are separate from `media.*` above: `media.root` is where the *bundled exercise* media live,
while `uploads.*` tune what a *profile* may put on the server (photos and videos). Every default
matches the API's own, so leaving them alone changes nothing.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `uploads.enabled` | `bool` | `true` | Let profiles upload exercise and workout photos and videos. |
| `uploads.quotaMb` | `ints.unsigned` | `200` | Per-profile media quota, in MB. `0` = no cap. |
| `uploads.minFreeMb` | `ints.unsigned` | `512` | Uploads stop below this much free disk space, in MB. `0` = no floor. |
| `uploads.imageMaxMb` | `ints.unsigned` | `2` | Max size for a photo and its thumbnails, in MB. |
| `uploads.gifMaxMb` | `ints.unsigned` | `8` | Max size for an animated GIF, in MB. |
| `uploads.videoMaxMb` | `ints.unsigned` | `40` | Max size for a video, in MB. |
| `uploads.videoMaxSec` | `ints.unsigned` | `60` | Maximum video length, in seconds. |
| `uploads.gcGraceDays` | `ints.unsigned` | `14` | Days an unused upload is kept before garbage collection. |
| `uploads.perHour` | `ints.unsigned` | `600` | Uploads permitted per profile per hour. |

### `web.*` suboptions

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `web.root` *(read-only)* | `path` | — | Built frontend directory (`…/opengym-frontend/share/opengym`). Serve as the SPA root with a fallback to `/index.html`. |

### `mcp.*` suboptions

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `mcp.enable` | `bool` | `false` | Run the MCP server as a systemd service (reads the same `dataDir`; its one write tool goes through the api). Off unless you point an LLM client at it. |
| `mcp.uid` | `string \| null` | `null` | The openGym user ID (from `db.json` `"users"[].id`) the MCP server serves. Leave unset to auto-pick when exactly one user exists; with multiple users it must be set (the server otherwise exits listing them). |

### Option → environment mapping

The module renders these into the `opengym-api` systemd unit as environment variables — useful if
you are cross-referencing the Docker/`.env` contract. The `nix flake check` eval check holds this
table against the module: a variable the module sets that is not named here fails the check.

| Option | Env var | Option | Env var |
| --- | --- | --- | --- |
| `apiPort` | `PORT` | `auditLog` | `AUDIT_LOG` (`1`/`0`) |
| `dataDir` | `DATA_DIR` | `auditMax` | `AUDIT_MAX` |
| `rpId` | `RP_ID` | `auditDays` | `AUDIT_DAYS` |
| `origin` | `ORIGIN` | `auditIp` | `AUDIT_IP` |
| `rpName` | `RP_NAME` | `vapidSubject` | `VAPID_SUBJECT` (set only when non-empty) |
| `sessionDays` | `SESSION_DAYS` | `adminUids` | `ADMIN_UIDS` (set only when non-empty) |
| `allowGuest` | `ALLOW_GUEST` (`1`/`0`) | `inviteOnly` | `INVITE_ONLY` (`1`/`0`) |
| `trustProxy` | `TRUST_PROXY` (`1`/`0`) | `passwordLogin` | `PASSWORD_LOGIN` (`1`/`0`) |
| `firstUserAdmin` | `FIRST_USER_ADMIN` (`1`/`0`) | `defaultLang` | `DEFAULT_LANG` (set only when set) |
| `uploads.enabled` | `MEDIA_UPLOADS` (`1`/`0`) | `uploads.quotaMb` | `MEDIA_QUOTA_MB` |
| `uploads.minFreeMb` | `MEDIA_MIN_FREE_MB` | `uploads.imageMaxMb` | `MEDIA_IMAGE_MAX_MB` |
| `uploads.gifMaxMb` | `MEDIA_GIF_MAX_MB` | `uploads.videoMaxMb` | `MEDIA_VIDEO_MAX_MB` |
| `uploads.videoMaxSec` | `MEDIA_VIDEO_MAX_SEC` | `uploads.gcGraceDays` | `MEDIA_GC_GRACE_DAYS` |
| `uploads.perHour` | `MEDIA_UPLOADS_PER_HOUR` | `coachDisabled` | `COACH_DISABLED` (`1`/`0`) |
| `coachJobTimeoutSeconds` | `COACH_JOB_TIMEOUT_MS` (set only when set) | `allowedPrivateIps` | `ALLOWED_PRIVATE_IPS` (set only when non-empty) |

Three deliberate differences from the API's own defaults, all of them NixOS's choice rather than the
app's: `DATA_DIR` points at `/var/lib/opengym` (the API defaults to `/data` for its containers),
`TRUST_PROXY` starts on because a NixOS deployment always fronts the API with a proxy (the API
itself defaults it off), and the variables with an *unset* state — `DEFAULT_LANG`, `VAPID_SUBJECT`,
`ADMIN_UIDS`, `COACH_JOB_TIMEOUT_MS`, `ALLOWED_PRIVATE_IPS` — are left off the unit entirely
rather than substituted, so the app's own defaults apply (browser language, the origin as VAPID
subject, no admin, the five-minute coach budget, no private address).

`environment` and `environmentFile` are raw passthrough and don't appear here — they end up on the
unit exactly as you write them (see [Extra environment variables](#extra-environment-variables)).

## 7. Data, backups and updates

**Everything** lives under `dataDir` (`/var/lib/opengym`): `db.json` (profiles + public passkeys),
`state-<uid>.json` (each user's plan, workouts, body weight, settings), `secret` (session-cookie
key), `vapid.json` (push keys), and `audit.log`. Passkey private keys never reach the server.

```bash
sudo tar czf opengym-backup-$(date +%F).tar.gz /var/lib/opengym
```

Restore by unpacking it back; nothing else needs reconfiguring.

Updating is a normal flake workflow:

```bash
nix flake update opengym
sudo nixos-rebuild switch --flake .#myhost
```

Your data is untouched; the exercise media come with the new frontend package. Changing `rpId`/`origin` is *not* a
routine update — see the passkey caveat in §4.

## 8. Troubleshooting

| Symptom | Fix |
| --- | --- |
| No passkey prompt / "verification failed" | `rpId`/`origin` don't match the address bar. Ask the server what it loaded: `journalctl -u opengym-api -b \| grep 'gym-api on'`.  See §4 and `docs/SELF_HOSTING.md`. |
| App loads but exercises show no image/animation | Your web server doesn't serve `web.root` for `/exercise-media/*`, for example because an older config still routes `/img/` and `/gif/` or sends everything unknown to `index.html` without trying the file first. `curl -I https://your-host/exercise-media/NOTICE.md` should answer 200. |
| `/api` returns 502/404 | Your proxy's `apiPort` (`services.opengym.apiPort`) differs from what `reverse_proxy`/`proxy_pass` targets. |
| `nginx` is silently gone after enabling the module | No longer expected, and a bug if you see it: the module used to force `services.nginx.enable = false`, which took a user's own nginx down with it. Set `services.opengym.nginx.enable = true` to have the module configure nginx for openGym, or leave it off and bring your own web server — the module then touches neither. |
| Service won't start | `journalctl -u opengym-api -xe`. Common: custom `dataDir` not created/owned correctly (the tmpfiles rule should handle it; check `systemd-tmpfiles --create`). |
| Eval fails: `environment and environmentFile are mutually exclusive` | Pick one. Set extra vars either as a Nix attrset (`environment`) or in a file (`environmentFile`), never both. |
| `nix flake check` fails with `opengym module check failed:` | Each line under it names a scenario and the expectation that did not hold (`defaults :: apiPort is 3000: expected 3000, got 4000`). Read the top line, open the scenario it names in `flake.nix`, and check the module against it — the check is data, so a failure points straight at the config and the predicate. A `docs ::` line means the option → environment table in this file no longer names a variable the module sets. |
| A package build fails with `a module the package ships does not resolve` | The staging is missing a file the package's sources import — `node-package.nix`'s build-time proof that the package would boot. If a new subdirectory appeared under `api/` or `mcp/`, the fix is in `api.nix`/`mcp.nix` (usually nothing: the staging copies every runtime directory; check `excludeDirs`), not in the package's sources. |
| You expected a binary cache | The flake builds from source; override `services.opengym.package` (or `packages.*` via a cache/overlay) to substitute binaries. |
| Exercise media licensing | © Aliaksandr Makatserchyk, Gym visual, licensed for use in openGym only and not covered by the AGPL. They ship at 180 px; don't re-host them on their own. See [`NOTICE.md`](../NOTICE.md) |
| `nix run .#opengym` serves a blank site | The app now serves frontend + API + media behind a local Caddy. If something's off, check the log line it prints (ports/`DATA_DIR`) and that nothing else already binds `:3000`/`:8080` — pass `OPENGYM_API_PORT`/`OPENGYM_WEB_PORT` to move them. |

## See also

- [`docs/SELF_HOSTING.md`](SELF_HOSTING.md) — the general self-hosting guide (Docker but the domain,
  passkey and admin/audit details apply unchanged).
- [`docs/MOBILE.md`](MOBILE.md) — the stand-alone Android app, an alternative to self-hosting.
- [`docs/DATA_IMPORTS.md`](DATA_IMPORTS.md) — importing from FitNotes/Strong/Hevy/Apple Health.
- [`NOTICE.md`](../NOTICE.md) — third-party notices, including the exercise-media licence.
