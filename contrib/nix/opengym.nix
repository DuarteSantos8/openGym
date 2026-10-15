{
  config,
  lib,
  pkgs,
  # Injected by the flake (see nixosModules.opengym in flake.nix) so module users get the
  # packages built from the flake's *locked* nixpkgs input. Falls back to this system's pkgs
  # (via _module.args below) when the module is imported directly (imports = [ …/opengym.nix ]).
  opengymPkgs,
  ...
}:

let
  cfg = config.services.opengym;

  hostOpengymPkgs = import ./default.nix { inherit pkgs; };

  defaultOpengymPkgs = if opengymPkgs != null then opengymPkgs else hostOpengymPkgs;

  packages = cfg.package;

  apiEnv = lib.filterAttrs (_: v: v != null) {
    PORT = toString cfg.apiPort;
    DATA_DIR = cfg.dataDir;
    RP_ID = cfg.rpId;
    ORIGIN = cfg.origin;
    RP_NAME = cfg.rpName;
    SESSION_DAYS = toString cfg.sessionDays;
    ALLOW_GUEST = if cfg.allowGuest then "1" else "0";
    INVITE_ONLY = if cfg.inviteOnly then "1" else "0";
    AUDIT_LOG = if cfg.auditLog then "1" else "0";
    AUDIT_MAX = toString cfg.auditMax;
    AUDIT_DAYS = toString cfg.auditDays;
    AUDIT_IP = cfg.auditIp;
    VAPID_SUBJECT = if cfg.vapidSubject != "" then cfg.vapidSubject else null;
    ADMIN_UIDS = if cfg.adminUids != "" then cfg.adminUids else null;
  };

  # Hardening shared by the API and MCP units. The MCP server reads the same data files,
  # so it gets the same sandbox.
  serviceHardening = {
    NoNewPrivileges = true;
    ProtectSystem = "strict";
    ProtectHome = true;
    PrivateTmp = true;
    PrivateDevices = true;
    ProtectKernelTunables = true;
    ProtectKernelModules = true;
    ProtectControlGroups = true;
    RestrictNamespaces = true;
    RestrictSUIDSGID = true;
    LockPersonality = true;
    SystemCallFilter = [
      "@system-service"
      "~@privileged"
    ];
  };

  # Options that only made sense while the exercise media were downloaded from a third-party
  # dataset. Since v1.4.0 the media ship in the source tree (catalogue/media) and inside the
  # frontend package, so there is nothing left to fetch or point a web server at separately.
  removedMedia =
    name: why:
    lib.mkRemovedOptionModule [
      "services"
      "opengym"
      "media"
      name
    ] why;

in
{
  imports = [
    (removedMedia "fetchAtBuild" "The exercise media are part of the frontend package now; nothing is fetched.")
    (removedMedia "dataDir" "The exercise media are part of the frontend package now; there is no runtime media directory.")
    (removedMedia "imageRoot" "Use services.opengym.media.root (stills in still/, animations in clip/).")
    (removedMedia "gifRoot" "Use services.opengym.media.root (stills in still/, animations in clip/).")
  ];

  options.services.opengym = {
    enable = lib.mkEnableOption "openGym self-hosted gym tracker";

    package = lib.mkOption {
      type = lib.types.attrsOf lib.types.package;
      default = defaultOpengymPkgs;
      defaultText = lib.literalExpression ''
        the flake's packages (built from its locked nixpkgs) when the module comes from the
        flake; otherwise built from this system's nixpkgs
      '';
      description = "openGym package set (typically the flake output).";
    };

    dataDir = lib.mkOption {
      type = lib.types.path;
      default = "/var/lib/opengym";
      description = "Persistent data directory (db.json, state files, secrets).";
    };

    apiPort = lib.mkOption {
      type = lib.types.port;
      default = 3000;
      description = "Port the API listens on (internal, proxied by nginx).";
    };

    rpId = lib.mkOption {
      type = lib.types.str;
      default = "localhost";
      description = "WebAuthn Relying Party ID (bare hostname, must match address bar).";
    };

    origin = lib.mkOption {
      type = lib.types.str;
      default = "http://localhost:8080";
      description = "Full origin URL for CSRF validation (must match address bar).";
    };

    rpName = lib.mkOption {
      type = lib.types.str;
      default = "openGym";
      description = "Display name for passkey registration prompts.";
    };

    sessionDays = lib.mkOption {
      type = lib.types.ints.unsigned;
      default = 90;
      description = "Session cookie lifetime in days.";
    };

    adminUids = lib.mkOption {
      type = lib.types.str;
      default = "";
      description = "Comma-separated user IDs granted admin access.";
    };

    inviteOnly = lib.mkEnableOption "require invite code for new signups";

    allowGuest = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = "Allow 'Continue without account' (guest mode).";
    };

    auditLog = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = "Enable activity audit log.";
    };

    auditMax = lib.mkOption {
      type = lib.types.ints.unsigned;
      default = 5000;
      description = "Max audit events kept (0 = unlimited).";
    };

    auditDays = lib.mkOption {
      type = lib.types.ints.unsigned;
      default = 90;
      description = "Max days of audit events kept.";
    };

    auditIp = lib.mkOption {
      type = lib.types.enum [
        "off"
        "net"
        "full"
      ];
      default = "off";
      description = "IP recording mode: off, net (masked), full.";
    };

    vapidSubject = lib.mkOption {
      type = lib.types.str;
      default = "";
      description = "VAPID subject for push notifications (defaults to ORIGIN).";
    };

    environment = lib.mkOption {
      type = lib.types.attrsOf lib.types.str;
      default = { };
      description = ''
        Extra environment variables set on the opengym-api systemd unit. Useful for variables the
        module does not manage yet. Variables this module already derives from its own options take
        precedence. Mutually exclusive with environmentFile.
      '';
    };

    environmentFile = lib.mkOption {
      type = lib.types.str;
      default = "";
      description = ''
        Path to an env file (KEY=VALUE per line) read by the opengym-api systemd unit. Mutually
        exclusive with environment.
      '';
    };

    nginx = {
      enable = lib.mkEnableOption "an nginx virtualHost for openGym, managed via services.nginx";

      hostName = lib.mkOption {
        type = lib.types.str;
        default = cfg.rpId;
        description = "Server name the nginx virtualHost listens on (defaults to rpId).";
      };

      enableACME = lib.mkOption {
        type = lib.types.bool;
        default = false;
        description = ''
          Serve openGym over TLS with a Let's Encrypt certificate (services.nginx enableACME +
          forceSSL). Also requires security.acme.acceptTerms = true in your configuration.
        '';
      };
    };

    media = {
      root = lib.mkOption {
        type = lib.types.path;
        readOnly = true;
        description = ''
          Directory with the exercise stills (still/<id>.webp) and animations (clip/<id>.mp4).
          It is the exercise-media/ directory inside web.root, so a web server serving web.root
          already serves it; the option is only there for setups that need the path on its own.
        '';
      };
    };

    web = {
      root = lib.mkOption {
        type = lib.types.path;
        readOnly = true;
        description = "Built frontend directory (static SPA). For use by a web server.";
      };
    };

    mcp = {
      enable = lib.mkEnableOption "openGym MCP server (stdio bridge for LLM clients)";

      uid = lib.mkOption {
        type = lib.types.nullOr lib.types.str;
        default = null;
        description = ''
          The openGym user ID (from db.json "users"[].id) the MCP server serves.
          When null, the server auto-picks when exactly one user exists; with multiple
          users this option must be set. Use the `environment` escape hatch for the
          same effect.
        '';
      };
    };
  };

  config = lib.mkMerge [
    {
      # Fallback for `opengymPkgs` when the module is imported directly (no flake wrapper):
      # build the packages from this system's pkgs. The flake's wrapper supplies the same
      # argument at higher priority with packages from its locked nixpkgs.
      _module.args.opengymPkgs = lib.mkDefault hostOpengymPkgs;

      assertions = [
        {
          assertion = cfg.environment == { } || cfg.environmentFile == "";
          message = "services.opengym.environment and services.opengym.environmentFile are mutually exclusive; use only one.";
        }
        {
          assertion = !cfg.nginx.enable || cfg.nginx.hostName != "";
          message = "services.opengym.nginx.hostName must be set when services.opengym.nginx.enable is true.";
        }
        {
          assertion = !cfg.nginx.enableACME || cfg.nginx.enable;
          message = "services.opengym.nginx.enable must be true to use services.opengym.nginx.enableACME.";
        }
      ];
    }
    (lib.mkIf cfg.enable (
      lib.mkMerge [
        {
          users.users.opengym = {
            isSystemUser = true;
            group = "opengym";
            description = "openGym service user";
          };

          users.groups.opengym = { };

          systemd.tmpfiles.rules = [
            "d ${cfg.dataDir} 0750 opengym opengym - -"
          ];

          systemd.services.opengym-api = {
            description = "openGym API server";
            after = [ "network.target" ];
            wantedBy = [ "multi-user.target" ];
            environment = cfg.environment // apiEnv;
            serviceConfig = lib.mkMerge [
              {
                ExecStart = "${packages.opengym-api}/bin/opengym-api";
                User = "opengym";
                Group = "opengym";
                Restart = "on-failure";
                RestartSec = 5;
                EnvironmentFile = lib.mkIf (cfg.environmentFile != "") cfg.environmentFile;
                ReadWritePaths = [ cfg.dataDir ];
              }
              serviceHardening
              # systemd's StateDirectory= only lives under /var/lib, so use it for the default
              # dataDir; a custom dataDir is created by the tmpfiles rule instead.
              (lib.mkIf (builtins.toString cfg.dataDir == "/var/lib/opengym") {
                StateDirectory = "opengym";
                StateDirectoryMode = "0750";
              })
            ];
          };

          services.opengym.web.root = "${packages.opengym-frontend}/share/opengym";
          services.opengym.media.root = "${cfg.web.root}/exercise-media";

          systemd.services.opengym-mcp = lib.mkIf cfg.mcp.enable {
            description = "openGym MCP server";
            after = [ "network.target" ];
            wantedBy = [ "multi-user.target" ];
            environment = {
              # The MCP server reads OPENGYM_DATA (not DATA_DIR) to locate the data files.
              OPENGYM_DATA = cfg.dataDir;
            } // lib.optionalAttrs (cfg.mcp.uid != null) {
              OPENGYM_UID = cfg.mcp.uid;
            };
            serviceConfig = lib.mkMerge [
              {
                ExecStart = "${packages.opengym-mcp}/bin/opengym-mcp";
                StandardInput = "null";
                StandardOutput = "journal";
                User = "opengym";
                Group = "opengym";
                Restart = "on-failure";
              }
              serviceHardening
            ];
          };
        }
        # Optional: let the module configure an nginx virtualHost for openGym itself.
        (lib.mkIf cfg.nginx.enable {
          services.nginx = {
            enable = true;
            recommendedOptimisation = true;
            recommendedGzipSettings = true;
            virtualHosts.${cfg.nginx.hostName} =
              {
                root = cfg.web.root;
                locations = {
                  "/" = {
                    tryFiles = "$uri $uri/ /index.html";
                  };
                  "/api/" = {
                    # services.nginx renders this as `proxy_pass <value>;`, so the value
                    # must not carry its own semicolon (nginx rejects `;;`).
                    proxyPass = "http://127.0.0.1:${toString cfg.apiPort}";
                    extraConfig = ''
                      proxy_http_version 1.1;
                      proxy_set_header Host $host;
                      proxy_set_header X-Real-IP $remote_addr;
                      proxy_set_header X-Forwarded-For $remote_addr;
                      proxy_set_header X-Forwarded-Proto $scheme;
                    '';
                  };
                  # exercise-media/ is served from root like the rest of the app. The files
                  # are named after the exercise and never change within a build, so let
                  # browsers keep them. They are licensed for openGym only (NOTICE.md):
                  # Cross-Origin-Resource-Policy keeps other sites from embedding them.
                  "/exercise-media/" = {
                    extraConfig = ''
                      expires 30d;
                      add_header Cache-Control "public";
                      add_header Cross-Origin-Resource-Policy "same-origin" always;
                    '';
                  };
                };
              }
              // lib.optionalAttrs cfg.nginx.enableACME {
                enableACME = true;
                forceSSL = true;
              };
          };
        })
        # Caddy-native default: this module owns no web server of its own.
        (lib.mkIf (!cfg.nginx.enable) {
          services.nginx.enable = lib.mkForce false;
        })
      ]
    ))
];
}
