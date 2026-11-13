# Where openGym's web-facing contract is stated — once.
#
# One openGym instance behind a web server is: the built SPA from a store path with an
# index.html fallback, the API on one path prefix, and the exercise media served from
# that same root — files licensed for openGym only (NOTICE.md), so browsers may keep
# them for a month but no other site may embed them. Every deployment states this
# contract in its own web server's dialect. The two openGym ships — the NixOS
# module's nginx vhost and the `nix run` stack's Caddyfile — used to state it
# separately, and they had already drifted: the Caddyfile set no cache and no CORP
# header at all, so `nix run` served the licensed media open to embedding. Here the
# contract is one module and each renderer is a spelling of it, so a header cannot
# reach one server and miss the other.
#
# The interface is the contract's two inputs: where the frontend lives, and which port
# the API listens on — a string, because the `nix run` script wires its port at
# runtime while the module writes its option into the config. The output is the same
# routes rendered for nginx and for Caddy.
{
  webRoot,
  apiPort,
}:

{
  # nginx: the virtualHost's locations. The module wraps them with the vhost's own
  # concerns (hostName, root, ACME, gzip settings); what is here is the contract.
  nginxLocations = {
    "/" = {
      tryFiles = "$uri $uri/ /index.html";
    };

    "/api/" = {
      # services.nginx renders this as `proxy_pass <value>;`, so the value must not
      # carry its own semicolon (nginx rejects `;;`).
      proxyPass = "http://127.0.0.1:${apiPort}";
      extraConfig = ''
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
      '';
    };

    # The media are served from root like the rest of the app. The files are named
    # after the exercise and never change within a build, so browsers may keep them:
    # the same spelling the Docker image's nginx template uses, where a test
    # (frontend/src/lib/api-base.test.js) forbids `expires`, because it adds a
    # Cache-Control of its own and this header set has to stay exact. They are
    # licensed for openGym only: Cross-Origin-Resource-Policy is what keeps another
    # site from embedding them, which is why both renderers — not just the module
    # path — carry it.
    "/exercise-media/" = {
      extraConfig = ''
        add_header Cache-Control "public, max-age=2592000, immutable";
        add_header Cross-Origin-Resource-Policy "same-origin" always;
      '';
    };
  };

  # Caddy: the site body, without the site address or the app's own compression
  # settings (Caddy sets the X-Forwarded-* headers itself, so that row of the nginx
  # spelling has no counterpart here). The `nix run` script wraps this in its port.
  caddySite = ''
    handle /exercise-media/* {
      header {
        Cache-Control "public, max-age=2592000, immutable"
        Cross-Origin-Resource-Policy same-origin
      }
    }

    handle /api/* {
      reverse_proxy 127.0.0.1:${apiPort}
    }

    handle {
      root * ${webRoot}
      try_files {path} /index.html
      file_server
    }
  '';
}
