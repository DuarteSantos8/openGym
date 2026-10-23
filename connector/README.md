# openGym Claude connector

A remote [MCP](https://modelcontextprotocol.io) server that lets a person connect their own Claude
(claude.ai or Claude Desktop) to their openGym account. Sign-in is the person's existing openGym
passkey; the connector then acts through openGym's API with that user's permissions. Irreversible
actions need a separate passkey confirmation in openGym, never just a "yes" in chat. Exercise
plans reach Claude as text only; the exercise images and clips are never sent.

It is a separate service. It does not touch `data/`, mounts no volume, and needs no change to the
openGym API. Grants and connections live in memory, so a restart signs everyone out of Claude (they
reconnect with their passkey).

> Public deployment is **not** performed by this change. Everything below is the local
> contract plus the manual steps someone with access must take. Nothing here starts a container,
> edits a tunnel, or publishes an image.

## Environment

| Variable | Required | Meaning |
|---|---|---|
| `CONNECTOR_PUBLIC_ORIGIN` | yes | Public HTTPS origin people use for openGym, e.g. `https://gym.example.com`. Bare origin: no path, query or credentials. Passkeys are bound to this host. |
| `CONNECTOR_ENCRYPTION_KEY` | yes | 32 random bytes, base64. Seals OAuth state and stored openGym bearers. Generate with `openssl rand -base64 32`. Missing, short, wrong-encoding or low-diversity placeholder values are refused; this cannot prove a key was generated randomly. Changing it signs everyone out. |
| `CONNECTOR_UPSTREAM_URL` | yes | openGym web origin the connector calls, `http://opengym-web-1` on the compose network. http(s) only, bare origin, no credentials. |
| `CONNECTOR_PREFIX` | no | Must be exactly `/connector` if set. It is fixed because the OAuth metadata, the tunnel rule and the service-worker exclusion all depend on it. |
| `CONNECTOR_HOST` | no | Listen address inside the process. Default `127.0.0.1`; the image sets `0.0.0.0` (its own interface) so the compose port mapping works. |
| `CONNECTOR_PORT` | no | Listen port. Default `8787`. |
| `CONNECTOR_BIND_PORT` | no | compose only: the host port, always bound to `127.0.0.1`. Default `8787`. |
| `OPENGYM_NETWORK` | no | compose only: name of the existing Docker network openGym runs on. Default `opengym_default`. |

The process exits with an error naming the variable (never its value) when any of these is invalid.

## Run locally, loopback only

Without Docker, against a reachable openGym web origin:

```bash
cd connector
export CONNECTOR_PUBLIC_ORIGIN=https://gym.example.com
export CONNECTOR_ENCRYPTION_KEY="$(openssl rand -base64 32)"
export CONNECTOR_UPSTREAM_URL=http://127.0.0.1:8090   # your openGym web port
node src/main.js                                      # listens on 127.0.0.1:8787
```

With Docker, joined to openGym's existing network (openGym's compose project is `opengym`, so its
network is `opengym_default`; `docker network ls` to confirm on your host):

```bash
cd connector
export CONNECTOR_PUBLIC_ORIGIN=https://gym.example.com
export CONNECTOR_ENCRYPTION_KEY="$(openssl rand -base64 32)"
docker compose up -d --build
curl -s http://127.0.0.1:8787/connector/.well-known/oauth-protected-resource
```

`compose.yaml` publishes only `127.0.0.1:<port>:8787`. Do not publish it on `0.0.0.0` and do not use
`docker run -p 8787:8787`; the tunnel on the same host is the only intended client. The container is
non-root, read-only, drops all capabilities and mounts nothing.

Tests need neither Docker nor a network: `npm test`.

## Manual steps for a public deployment

These are for the owner to do deliberately, after approving a deployment. None are done here.

1. **Patched web image.** openGym's service worker must not intercept `/connector/`. The prebuilt
   web image predates that exclusion (`frontend/public/sw.js` on this branch), so build the web
   image from this branch. The API image can stay prebuilt. Verify the deployed worker before
   anyone signs in.
2. **Cloudflare tunnel.** In Zero Trust, add public hostname path rules *before* the catch-all
   openGym rule, both pointing at `http://127.0.0.1:<CONNECTOR_BIND_PORT>`:
   - `^/connector(/|$)`
   - `^/\.well-known/(oauth-authorization-server|openid-configuration)/connector$`

   Everything else keeps going to openGym. The connector and openGym share one hostname because
   passkeys are bound to it.
3. **Start the connector** with the real `CONNECTOR_PUBLIC_ORIGIN` and a freshly generated key, as above.
4. **Connect Claude.** In Claude, Settings, Connectors, add a custom connector with the URL
   `https://gym.example.com/connector/mcp` (your origin plus `/connector/mcp`). Claude opens the
   openGym sign-in page; approve with your passkey. Each person connects their own Claude.

Revoking: disconnect in Claude, or disable the user in openGym; disabling permanently revokes the grant.

## License

AGPL-3.0-or-later, same as openGym: see [`../LICENSE`](../LICENSE) and [`../NOTICE.md`](../NOTICE.md).
The AGPL applies to this service as network software: if you run a modified copy for other people,
offer them its source.
