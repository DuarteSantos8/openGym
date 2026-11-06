{
  description = "openGym — self-hosted gym & body-weight tracker";

  inputs = {
    # A release branch, not nixos-unstable: this flake is contributed packaging that has to
    # keep evaluating for self-hosters on a channel. unstable has moved on to 26.11, which
    # already dropped x86_64-darwin — one of the systems eachDefaultSystem evaluates.
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
      ...
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = nixpkgs.legacyPackages.${system};

        lib = nixpkgs.lib;

        opengymPackages = import ./default.nix { inherit pkgs; };

        opengymNixOSModule = self.nixosModules.opengym;

        # An expectation over one value: passes on equality, and reports both sides on
        # failure — the old check_eq's job without the shell.
        differs =
          expected: actual:
          if actual == expected then true else "expected ${toString expected}, got ${toString actual}";

        # A NixOS config that enables the module with the given options — one shape
        # every scenario uses, so a scenario is only its differences from the default.
        opengymConfig = attrs: {
          imports = [ opengymNixOSModule ];
          services.opengym = attrs // {
            enable = true;
          };
          system.stateVersion = "25.05";
        };

        # The module's eval-level checks, as scenarios. module-check.nix evaluates one
        # system per scenario and reports every failure together, which replaces three
        # hand-written system evaluations plus a ~20-stanza shell ladder of check_eq —
        # and covers what the ladder never reached: the MCP unit, environmentFile, the
        # hardening sandbox, a custom dataDir, the nginx TLS path, and the removed
        # media options.
        moduleCheck = import ./module-check.nix {
          inherit system;
          lib = nixpkgs.lib;
          pkgs = pkgs;
          name = "opengym-module-check";
          scenarios = [
            # The default config: every option left alone — the old smoke-test config's
            # job, plus the branches the ladder never reached.
            {
              label = "defaults";
              modules = [
                (opengymConfig {
                  rpId = "localhost";
                  origin = "http://localhost:8080";
                  apiPort = 3000;
                  environment.MY_FLAG = "1";
                })
              ];
              expect = [
                {
                  label = "enable round-trips";
                  ok = c: c.services.opengym.enable;
                }
                {
                  label = "apiPort is 3000";
                  ok = c: differs 3000 c.services.opengym.apiPort;
                }
                {
                  label = "rpId round-trips";
                  ok = c: differs "localhost" c.services.opengym.rpId;
                }
                {
                  label = "origin round-trips";
                  ok = c: differs "http://localhost:8080" c.services.opengym.origin;
                }
                {
                  label = "the api unit is created";
                  ok = c: c.systemd.services ? opengym-api;
                }
                {
                  label = "extra environment reaches the unit";
                  ok = c: differs "1" c.systemd.services.opengym-api.environment.MY_FLAG;
                }
                {
                  label = "TRUST_PROXY defaults on";
                  ok = c: differs "1" (c.systemd.services.opengym-api.environment.TRUST_PROXY or "<missing>");
                }
                {
                  label = "PASSWORD_LOGIN defaults off";
                  ok = c: differs "0" (c.systemd.services.opengym-api.environment.PASSWORD_LOGIN or "<missing>");
                }
                {
                  label = "uploads default on";
                  ok = c: differs "1" (c.systemd.services.opengym-api.environment.MEDIA_UPLOADS or "<missing>");
                }
                {
                  label = "the coach defaults on";
                  ok = c: differs "0" (c.systemd.services.opengym-api.environment.COACH_DISABLED or "<missing>");
                }
                {
                  label = "the opengym user exists";
                  ok = c: c.users.users ? opengym;
                }
                {
                  label = "web.root is the built frontend";
                  ok = c: differs "${opengymPackages.opengym-frontend}/share/opengym" c.services.opengym.web.root;
                }
                {
                  label = "media.root sits inside it";
                  ok =
                    c:
                    differs "${opengymPackages.opengym-frontend}/share/opengym/exercise-media" c.services.opengym.media.root;
                }
                {
                  label = "nginx is untouched unless asked";
                  ok = c: !c.services.nginx.enable;
                }
                {
                  label = "no mcp unit unless asked";
                  ok = c: !(c.systemd.services ? opengym-mcp);
                }
                {
                  label = "the api unit is sandboxed";
                  ok = c: c.systemd.services.opengym-api.serviceConfig.NoNewPrivileges == true;
                }
                {
                  label = "the sandbox caps the syscall set";
                  ok =
                    c:
                    builtins.elem "@system-service" c.systemd.services.opengym-api.serviceConfig.SystemCallFilter
                    && builtins.elem "~@privileged" c.systemd.services.opengym-api.serviceConfig.SystemCallFilter;
                }
                {
                  label = "the unit can only write dataDir";
                  ok =
                    c: builtins.elem "/var/lib/opengym" c.systemd.services.opengym-api.serviceConfig.ReadWritePaths;
                }
                {
                  label = "the default dataDir uses StateDirectory";
                  ok =
                    c: differs "opengym" (c.systemd.services.opengym-api.serviceConfig.StateDirectory or "<missing>");
                }
                {
                  label = "the tmpfiles rule creates dataDir too";
                  ok = c: builtins.elem "d /var/lib/opengym 0750 opengym opengym - -" c.systemd.tmpfiles.rules;
                }
              ];
            }

            # The docs' option → environment mapping must name every variable the
            # module sets. The env contract is restated in more places than any other
            # (module, `nix run` script, the API itself), and a stale table sends
            # readers to the wrong source of truth.
            {
              label = "docs";
              doc = ../../docs/NIX.md;
              # The optional variables only reach the unit when set, so this config
              # sets them: the table has to name those too.
              modules = [
                (opengymConfig {
                  defaultLang = "pt-BR";
                  vapidSubject = "mailto:test@example.com";
                  adminUids = [ "u-1" ];
                  # These two only reach the unit when set, so set them: the table must name
                  # their variables too.
                  coachJobTimeoutSeconds = 300;
                  allowedPrivateIps = [ "127.0.0.1" ];
                })
              ];
            }

            # The user-upload and coach knobs: the env-var render, including the seconds →
            # milliseconds job budget and the comma-joined private-IP list.
            {
              label = "uploads and coach";
              modules = [
                (opengymConfig {
                  uploads.enabled = false;
                  uploads.quotaMb = 500;
                  uploads.perHour = 100;
                  coachDisabled = true;
                  coachJobTimeoutSeconds = 120;
                  allowedPrivateIps = [
                    "10.0.0.0/8"
                    "192.168.1.0/24"
                  ];
                })
              ];
              expect = [
                {
                  label = "uploads are off";
                  ok = c: differs "0" c.systemd.services.opengym-api.environment.MEDIA_UPLOADS;
                }
                {
                  label = "the quota is rendered";
                  ok = c: differs "500" c.systemd.services.opengym-api.environment.MEDIA_QUOTA_MB;
                }
                {
                  label = "the throttle is rendered";
                  ok = c: differs "100" c.systemd.services.opengym-api.environment.MEDIA_UPLOADS_PER_HOUR;
                }
                {
                  label = "the coach is off";
                  ok = c: differs "1" c.systemd.services.opengym-api.environment.COACH_DISABLED;
                }
                {
                  label = "the timeout is seconds → ms";
                  ok = c: differs "120000" c.systemd.services.opengym-api.environment.COACH_JOB_TIMEOUT_MS;
                }
                {
                  label = "the allowed IPs are joined";
                  ok =
                    c:
                    differs "10.0.0.0/8,192.168.1.0/24" c.systemd.services.opengym-api.environment.ALLOWED_PRIVATE_IPS;
                }
              ];
            }

            # The optional managed vhost: the routes are the serving contract
            # (serving.nix), so what this pins is that both header rules render.
            {
              label = "nginx managed for you";
              modules = [ (opengymConfig { nginx.enable = true; }) ];
              expect = [
                {
                  label = "nginx is enabled with it";
                  ok = c: c.services.nginx.enable;
                }
                {
                  label = "the vhost defaults to rpId";
                  ok = c: c.services.nginx.virtualHosts ? localhost;
                }
                {
                  label = "/api proxies to the apiPort";
                  ok =
                    c:
                    differs "http://127.0.0.1:3000" c.services.nginx.virtualHosts.localhost.locations."/api/".proxyPass;
                }
                {
                  label = "/exercise-media has its own location";
                  ok = c: c.services.nginx.virtualHosts.localhost.locations ? "/exercise-media/";
                }
                {
                  label = "the SPA falls back to index.html";
                  ok =
                    c: differs "$uri $uri/ /index.html" c.services.nginx.virtualHosts.localhost.locations."/".tryFiles;
                }
                {
                  label = "media: a month of caching";
                  ok =
                    c:
                    lib.hasInfix "max-age=2592000, immutable"
                      c.services.nginx.virtualHosts.localhost.locations."/exercise-media/".extraConfig;
                }
                {
                  label = "media: same-origin only";
                  ok =
                    c:
                    lib.hasInfix "Cross-Origin-Resource-Policy \"same-origin\""
                      c.services.nginx.virtualHosts.localhost.locations."/exercise-media/".extraConfig;
                }
              ];
            }

            # A user who brings their own nginx: the module must leave it exactly as
            # configured — the regression that a force-disable caused once.
            {
              label = "a user's own nginx";
              modules = [
                (opengymConfig { })
                {
                  services.nginx = {
                    enable = true;
                    virtualHosts."gym.example.com".root = "/srv/gym";
                  };
                }
              ];
              expect = [
                {
                  label = "their nginx stays enabled";
                  ok = c: c.services.nginx.enable;
                }
                {
                  label = "their vhost survives";
                  ok = c: c.services.nginx.virtualHosts ? "gym.example.com";
                }
                {
                  label = "their root survives";
                  ok = c: differs "/srv/gym" c.services.nginx.virtualHosts."gym.example.com".root;
                }
              ];
            }

            # The optional MCP unit: never covered before. It reads the same dataDir
            # and runs under the same sandbox, with stdio pointed at the journal.
            {
              label = "mcp enabled";
              modules = [
                (opengymConfig {
                  mcp.enable = true;
                  mcp.uid = "u-1";
                })
              ];
              expect = [
                {
                  label = "the mcp unit is created";
                  ok = c: c.systemd.services ? opengym-mcp;
                }
                {
                  label = "it reads the same dataDir";
                  ok = c: differs "/var/lib/opengym" c.systemd.services.opengym-mcp.environment.OPENGYM_DATA;
                }
                {
                  label = "the serving uid is passed";
                  ok = c: differs "u-1" c.systemd.services.opengym-mcp.environment.OPENGYM_UID;
                }
                {
                  label = "stdio goes to the journal";
                  ok =
                    c:
                    c.systemd.services.opengym-mcp.serviceConfig.StandardInput == "null"
                    && c.systemd.services.opengym-mcp.serviceConfig.StandardOutput == "journal";
                }
                {
                  label = "it runs as the opengym user";
                  ok = c: differs "opengym" c.systemd.services.opengym-mcp.serviceConfig.User;
                }
                {
                  label = "it shares the api's sandbox";
                  ok = c: c.systemd.services.opengym-mcp.serviceConfig.NoNewPrivileges == true;
                }
              ];
            }

            # The environmentFile escape hatch — the module asserted its exclusivity
            # with environment, but nothing checked that it reaches the unit.
            {
              label = "environmentFile";
              modules = [ (opengymConfig { environmentFile = "/run/opengym/env"; }) ];
              expect = [
                {
                  label = "systemd reads the file";
                  ok = c: differs "/run/opengym/env" c.systemd.services.opengym-api.serviceConfig.EnvironmentFile;
                }
              ];
            }

            # A custom dataDir: systemd's StateDirectory only lives under /var/lib, so
            # the default and this branch are different mechanisms.
            {
              label = "custom dataDir";
              modules = [ (opengymConfig { dataDir = "/srv/opengym"; }) ];
              expect = [
                {
                  label = "StateDirectory is not misapplied";
                  ok = c: (c.systemd.services.opengym-api.serviceConfig.StateDirectory or null) == null;
                }
                {
                  label = "the tmpfiles rule creates it";
                  ok = c: builtins.elem "d /srv/opengym 0750 opengym opengym - -" c.systemd.tmpfiles.rules;
                }
                {
                  label = "the unit may write it";
                  ok = c: builtins.elem "/srv/opengym" c.systemd.services.opengym-api.serviceConfig.ReadWritePaths;
                }
              ];
            }

            # The nginx TLS path: enableACME pulls in the certificate and forceSSL.
            {
              label = "nginx with certificates";
              modules = [
                (opengymConfig {
                  nginx.enable = true;
                  nginx.enableACME = true;
                })
              ];
              expect = [
                {
                  label = "the vhost takes certificates";
                  ok = c: c.services.nginx.virtualHosts.localhost.enableACME == true;
                }
                {
                  label = "and forces TLS";
                  ok = c: c.services.nginx.virtualHosts.localhost.forceSSL == true;
                }
              ];
            }

            # Configurations that must NOT evaluate. The module guards its invariants
            # with assertions and removed-option modules; nothing checked either still
            # fires. The first three name a whole-system failure (the module's own
            # assertions, checked at the toplevel); the last four read a removed
            # option's value, which throws as soon as it is forced.
            {
              label = "environment and environmentFile are mutually exclusive";
              failsToEvaluate = true;
              modules = [
                (opengymConfig {
                  environment.FOO = "1";
                  environmentFile = "/run/opengym/env";
                })
              ];
            }
            {
              label = "enableACME without nginx";
              failsToEvaluate = true;
              modules = [ (opengymConfig { nginx.enableACME = true; }) ];
            }
            {
              label = "an empty nginx hostName";
              failsToEvaluate = true;
              modules = [
                (opengymConfig {
                  nginx.enable = true;
                  nginx.hostName = "";
                })
              ];
            }
            {
              label = "media.fetchAtBuild was removed";
              failsToEvaluate = [
                "media"
                "fetchAtBuild"
              ];
              modules = [ (opengymConfig { media.fetchAtBuild = true; }) ];
            }
            {
              label = "media.dataDir was removed";
              failsToEvaluate = [
                "media"
                "dataDir"
              ];
              modules = [ (opengymConfig { media.dataDir = "/removed"; }) ];
            }
            {
              label = "media.imageRoot was removed";
              failsToEvaluate = [
                "media"
                "imageRoot"
              ];
              modules = [ (opengymConfig { media.imageRoot = "/removed"; }) ];
            }
            {
              label = "media.gifRoot was removed";
              failsToEvaluate = [
                "media"
                "gifRoot"
              ];
              modules = [ (opengymConfig { media.gifRoot = "/removed"; }) ];
            }
          ];
        };
      in
      {
        packages = opengymPackages // {
          default = opengymPackages.opengym-frontend;
        };

        apps.opengym = {
          type = "app";
          meta.description = "Run the full openGym local stack (API + frontend + media behind a throwaway Caddy)";
          # Runs the full local stack: API + frontend (exercise media included) behind a throwaway
          # Caddy. Defaults to http://localhost:8080; env vars override ports/data/rp.
          # The routes and their headers come from the serving contract (serving.nix) — the same
          # one the module's nginx vhost renders.
          program = "${pkgs.writeShellScript "opengym" ''
            set -euo pipefail

            DATA_DIR=''${OPENGYM_DATA_DIR:-/tmp/opengym-data}
            API_PORT=''${OPENGYM_API_PORT:-3000}
            WEB_PORT=''${OPENGYM_WEB_PORT:-8080}
            mkdir -p "$DATA_DIR"

            export PORT="$API_PORT"
            export DATA_DIR
            export RP_ID=''${OPENGYM_RP_ID:-localhost}
            export ORIGIN=''${OPENGYM_ORIGIN:-http://localhost:$WEB_PORT}
            export TRUST_PROXY=''${TRUST_PROXY:-1}
            export ALLOW_GUEST=''${ALLOW_GUEST:-1}

            ${opengymPackages.opengym-api}/bin/opengym-api &
            API_PID=$!

            CFGDIR=$(mktemp -d)
            CGFILE="$CFGDIR/Caddyfile"
            cleanup() {
              rm -rf "$CFGDIR"
              kill "$API_PID" 2>/dev/null || true
            }
            trap cleanup EXIT

            cat > "$CGFILE" <<EOF
            {
              admin off
            }

            :$WEB_PORT {
              encode zstd gzip

            ${(import ./serving.nix {
              webRoot = "${opengymPackages.opengym-frontend}/share/opengym";
              apiPort = "$API_PORT";
            }).caddySite
            }
            }
            EOF

            echo "openGym running at http://localhost:$WEB_PORT (API on :$API_PORT, data in $DATA_DIR) — Ctrl-C to stop"
            ${pkgs.caddy}/bin/caddy run --config "$CGFILE"
          ''}";
        };

        apps.default = self.apps.${system}.opengym;

        checks = pkgs.lib.optionalAttrs pkgs.stdenv.hostPlatform.isLinux {
          # Evaluates the module against a smoke-test config and asserts the resulting
          # services/users/nginx state and extra environment.
          nixos-module-eval = moduleCheck;
          # Boots a NixOS VM and exercises the full HTTP contract (API + nginx vhost + SPA).
          opengym-nixos-test = import ./tests.nix {
            inherit pkgs;
            modules = [ opengymNixOSModule ];
          };
        };

        formatter = pkgs.nixfmt;

        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            nodejs_22
            coreutils
            git
          ];
          shellHook = ''
            echo "openGym dev shell (Node.js $(node --version))"
            echo "  cd frontend && npm install && npm run dev"
            echo "  cd api && npm install && node server.js"
          '';
        };
      }
    )
    // {
      # Wraps the module so NixOS configurations using it get openGym packages built from this
      # flake's LOCKED nixpkgs input. Importing contrib/nix/opengym.nix directly falls back to
      # the importing system's nixpkgs.
      nixosModules.opengym =
        { pkgs, ... }:
        {
          imports = [ ./opengym.nix ];
          _module.args.opengymPkgs = self.packages.${pkgs.stdenv.hostPlatform.system} or null;
        };
      nixosModules.default = self.nixosModules.opengym;

      # The VM integration test is exposed per-system as `checks.opengym-nixos-test` (Linux),
      # not as a top-level `nixosTests` output — Nix does not recognise that output name and
      # emits a warning for it.
    };
}
