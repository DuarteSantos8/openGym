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

        opengymPackages = import ./default.nix { inherit pkgs; };

        opengymNixOSModule = self.nixosModules.opengym;

        testConfig = nixpkgs.lib.nixosSystem {
          inherit system;
          modules = [
            opengymNixOSModule
            {
              services.opengym = {
                enable = true;
                rpId = "localhost";
                origin = "http://localhost:8080";
                apiPort = 3000;
                environment = {
                  MY_FLAG = "1";
                };
              };
              system.stateVersion = "25.05";
            }
          ];
        };

        cfg = testConfig.config.services.opengym;

        nginxEnabled = testConfig.config.services.nginx.enable;

        # Variant with the optional managed nginx vhost switched on.
        nginxTestConfig = nixpkgs.lib.nixosSystem {
          inherit system;
          modules = [
            opengymNixOSModule
            {
              services.opengym = {
                enable = true;
                nginx.enable = true;
              };
              system.stateVersion = "25.05";
            }
          ];
        };

        # A user who runs their own nginx: the module must leave services.nginx as it found
        # it rather than force it off. Regression guard for the removed mkForce.
        ownNginxConfig = nixpkgs.lib.nixosSystem {
          inherit system;
          modules = [
            opengymNixOSModule
            {
              services.opengym.enable = true;
              services.nginx = {
                enable = true;
                virtualHosts."gym.example.com".root = "/srv/gym";
              };
              system.stateVersion = "25.05";
            }
          ];
        };

        check = pkgs.runCommand "opengym-module-check" { } ''
          set -euo pipefail

          # Compare an actual against an expected value, or fail: a check that only echoes
          # its results passes a build that has silently stopped asserting anything.
          check_eq() {
            if [ "$2" != "$3" ]; then
              echo "FAIL: $1: expected '$3', got '$2'" >&2
              exit 1
            fi
          }

          # Module options round-trip into the evaluated system.
          check_eq "services.opengym.enable" "${if cfg.enable then "1" else "0"}" "1"
          check_eq "services.opengym.apiPort" "${toString cfg.apiPort}" "3000"
          check_eq "services.opengym.rpId" "${cfg.rpId}" "localhost"
          check_eq "services.opengym.origin" "${cfg.origin}" "http://localhost:8080"

          # systemd unit is created, and extra environment reaches it.
          check_eq "systemd opengym-api exists" "${
            if testConfig.config.systemd.services ? opengym-api then "1" else "0"
          }" "1"
          check_eq "opengym-api env MY_FLAG" "${
            testConfig.config.systemd.services.opengym-api.environment.MY_FLAG or "missing"
          }" "1"
          check_eq "opengym-api env TRUST_PROXY (default)" "${
            testConfig.config.systemd.services.opengym-api.environment.TRUST_PROXY or "missing"
          }" "1"
          check_eq "opengym-api env PASSWORD_LOGIN (default)" "${
            testConfig.config.systemd.services.opengym-api.environment.PASSWORD_LOGIN or "missing"
          }" "0"

          # nginx is untouched unless the module is asked to manage a vhost (the module owns no
          # web server of its own, so a user's services.nginx must never be forced off).
          check_eq "services.nginx.enable (default)" "${if nginxEnabled then "1" else "0"}" "0"
          check_eq "services.nginx.enable (nginx.enable)" "${
            if nginxTestConfig.config.services.nginx.enable then "1" else "0"
          }" "1"
          check_eq "services.nginx.enable (user's own)" "${
            if ownNginxConfig.config.services.nginx.enable then "1" else "0"
          }" "1"
          check_eq "user's own nginx vhost survives" "${
            if ownNginxConfig.config.services.nginx.virtualHosts ? "gym.example.com" then "1" else "0"
          }" "1"
          check_eq "nginx vhost for localhost" "${
            if nginxTestConfig.config.services.nginx.virtualHosts ? localhost then "1" else "0"
          }" "1"
          check_eq "nginx /api proxyPass" "${
            nginxTestConfig.config.services.nginx.virtualHosts."localhost".locations."/api/".proxyPass
              or "missing"
          }" "http://127.0.0.1:3000"
          check_eq "nginx /exercise-media location" "${
            if
              nginxTestConfig.config.services.nginx.virtualHosts."localhost".locations ? "/exercise-media/"
            then
              "1"
            else
              "0"
          }" "1"

          # Store paths exposed for a web server, and the system user exists.
          check_eq "services.opengym.web.root" "${cfg.web.root}" "${opengymPackages.opengym-frontend}/share/opengym"
          check_eq "services.opengym.media.root" "${cfg.media.root}" "${opengymPackages.opengym-frontend}/share/opengym/exercise-media"
          check_eq "users.users.opengym exists" "${
            if testConfig.config.users.users ? opengym then "1" else "0"
          }" "1"

          touch $out
        '';
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
          nixos-module-eval = check;
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
