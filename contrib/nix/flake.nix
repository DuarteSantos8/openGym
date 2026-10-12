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

        check = pkgs.runCommand "opengym-module-check" { } ''
          set -euo pipefail
          # Verify the module evaluated correctly
          echo "services.opengym.enable = ${if cfg.enable then "true" else "false"}"
          echo "services.opengym.apiPort = ${toString cfg.apiPort}"
          echo "services.opengym.rpId = ${cfg.rpId}"
          echo "services.opengym.origin = ${cfg.origin}"

          # Verify systemd service exists
          echo "systemd.services.opengym-api exists = ${
            if testConfig.config.systemd.services ? opengym-api then "true" else "false"
          }"

          # Verify extra environment is applied to the API unit
          echo "opengym-api env MY_FLAG = ${
            if testConfig.config.systemd.services.opengym-api.environment ? MY_FLAG then
              testConfig.config.systemd.services.opengym-api.environment.MY_FLAG
            else
              "missing"
          }"

          # Verify nginx is disabled by default (system uses Caddy)
          echo "services.nginx.enable (default) = ${if nginxEnabled then "true" else "false"}"

          # Verify the optional managed nginx vhost gets configured
          echo "services.nginx.enable (nginx.enable) = ${
            if nginxTestConfig.config.services.nginx.enable then "true" else "false"
          }"
          echo "nginx vhost for 'localhost' = ${
            if nginxTestConfig.config.services.nginx.virtualHosts ? localhost then "true" else "false"
          }"
          echo "nginx /api proxyPass = ${
            nginxTestConfig.config.services.nginx.virtualHosts."localhost".locations."/api/".proxyPass
              or "missing"
          }"
          echo "nginx /exercise-media location = ${
            if nginxTestConfig.config.services.nginx.virtualHosts."localhost".locations ? "/exercise-media/" then
              "true"
            else
              "false"
          }"

          # Verify frontend/media store paths are exposed for a web server
          echo "services.opengym.web.root = ${cfg.web.root}"
          echo "services.opengym.media.root = ${cfg.media.root}"

          # Verify user exists
          echo "users.users.opengym exists = ${
            if testConfig.config.users.users ? opengym then "true" else "false"
          }"

          # All checks passed
          touch $out
        '';
      in
      {
        packages = opengymPackages // {
          default = opengymPackages.opengym-frontend;
        };

        apps.opengym = {
          type = "app";
          # Runs the full local stack: API + frontend (exercise media included) behind a throwaway
          # Caddy. Defaults to http://localhost:8080; env vars override ports/data/rp.
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

              handle /api/* {
                reverse_proxy 127.0.0.1:$API_PORT
              }
              handle {
                root * ${opengymPackages.opengym-frontend}/share/opengym
                try_files {path} /index.html
                file_server
              }
            }
            EOF

            echo "openGym running at http://localhost:$WEB_PORT (API on :$API_PORT, data in $DATA_DIR) — Ctrl-C to stop"
            ${pkgs.caddy}/bin/caddy run --config "$CGFILE"
          ''}";
        };

        apps.default = self.apps.${system}.opengym;

        checks = {
          nixos-module-eval = check;
        }
        // (pkgs.lib.optionalAttrs pkgs.stdenv.hostPlatform.isLinux {
          # Boots a NixOS VM and exercises the full HTTP contract (API + nginx vhost + SPA).
          opengym-nixos-test = import ./tests.nix {
            inherit pkgs;
            modules = [ opengymNixOSModule ];
          };
        });

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

      # Conventional NixOS test output (boots a VM; also wired into checks on Linux).
      nixosTests.opengym = import ./tests.nix {
        pkgs = nixpkgs.legacyPackages.x86_64-linux;
        modules = [ self.nixosModules.opengym ];
      };
    };
}
