# openGym CD on Proxmox

## Existing installation

Proxmox node `my` runs the unprivileged Debian LXC **105**, `saitama`
(`192.168.178.72`). Docker Compose project `opengym` lives in `/opt/opengym`.
The public origin stays **https://gym.niichavo.pp.ua**; the existing Cloudflare
path and nginx `/api` proxy are unchanged. Only web publishes `8080:80`.
Node (`3000`) and Nutrition (`8080`) are internal to the Compose network.

Keep `.env`, `data/` (including the session signing key and passkeys), `media/`
and `coach-auth/` in place. Nutrition has no user store or volume. Do not run
the CI registration smoke against production or enable password login for a probe.

Management was verified through the local Proxmox MCP: SSH alias `proxmox-ai`,
host `ssh.niichavo.pp.ua`, user `codexops`, Cloudflare Access ProxyCommand,
strict SSH host-key checking, then `sudo -n` and `pct exec 105`. There is no
new inbound webhook, runner, SSH port, registry token or GitHub deployment secret.

## Release selection and health

`opengym-deploy.timer` invokes `/usr/local/sbin/opengym-deploy` ten minutes
after the preceding run finishes. The script reads the current `main` SHA and
requires a successful **push** run of `.github/workflows/ci.yml` for that exact
SHA. This workflow tests and smoke-checks the containers before publishing
**all three** images. Failed/incomplete CI, partial publication or a missing
image never changes the running release. `latest` is not used by CD.

All images use `sha-<full SHA>` and must have that SHA in their OCI revision
label. The script compares actual running image IDs, serializes deployments
with `flock`, and snapshots configuration and exact old IDs before switching.
Readiness checks retry for 120 seconds and cover:

- actual running image IDs for all three services;
- `/api/health`, home HTML and the local assets referenced by it, including
  Content-Type checks to reject HTML fallbacks;
- internal Nutrition `/health` returning `ok:true`;
- internal Nutrition rejecting spoofed identity with 401;
- public nginx → Node Nutrition endpoint returning 401 without credentials.

No user is registered or modified. Valid-session greeting and revocation are
covered in CI with disposable users; production probes do not impersonate users.
Deployments briefly recreate containers; this single-host setup is not zero downtime.

## Installation/update of CD files

The tracked `deploy/compose.prod.yml` preserves this host's existing mounts,
port and settings. It is separate from the source-build Compose file.
Run as root **inside LXC 105**, with this repository checkout as the current
directory. Do not replace the existing `.env` with `.env.example`.

```sh
bash -n deploy/opengym-deploy
python3 deploy/test_deploy.py                 # fake Docker/HTTP, no production access
systemctl stop opengym-deploy.timer
systemctl is-active opengym-deploy.service    # must be inactive; do not interrupt a deployment
test ! -d /var/lib/opengym-deploy/pending     # recover any old transaction first
backup=/opt/opengym/cd-backups/$(date -u +%Y%m%dT%H%M%SZ)
install -d -m 700 "$backup" /var/lib/opengym-deploy
cp -p /opt/opengym/.env /opt/opengym/compose.prod.yml /usr/local/sbin/opengym-deploy "$backup/"
cp -p /etc/systemd/system/opengym-deploy.{service,timer} "$backup/"
tar -C /opt/opengym -czf "$backup/data.tar.gz" data  # protect this backup; contains secrets
test -f /var/lib/opengym-deploy/legacy-compose || cp -p /opt/opengym/compose.prod.yml /var/lib/opengym-deploy/legacy-compose
install -m 600 deploy/compose.prod.yml /var/lib/opengym-deploy/release-compose
cd /opt/opengym
docker compose --env-file .env -f /var/lib/opengym-deploy/release-compose config --quiet
```

Then, back in the checkout, install `deploy/opengym-deploy` with mode 755
to `/usr/local/sbin/opengym-deploy`, install the two units with mode 644 to
`/etc/systemd/system/`, and copy `deploy/compose.prod.yml` to
`/opt/opengym/compose.prod.yml` (mode 644). Reload systemd and run:

```sh
systemctl daemon-reload
systemctl enable --now opengym-deploy.timer
systemctl start opengym-deploy.service
systemctl show opengym-deploy.service -p Result
journalctl -u opengym-deploy.service -n 60 --no-pager
systemctl list-timers opengym-deploy.timer
```

Installing configuration does not itself deploy unverified images. The first
Nutrition deployment waits for successful main publication. Failed `main` CI
leaves the former two-service release running, even after CD installation.

Remote MCP is opt-in inside the API image, not a fourth image. See
[MCP setup](../mcp/README.md) for the existing-origin HTTPS/OAuth configuration.
With MCP enabled, the updated script also checks protected-resource discovery
and a `401` authentication challenge through nginx before declaring readiness;
it creates no grants or diary records. Install the updated script when releasing
this feature. Configuration and script changes in a `dev` checkout do not enable
MCP or update this host automatically.

## Rollback and pause

On startup/update failure the script restores the prior `.env`, Compose file
and exact image IDs, verifies readiness, and blocks the failed SHA in
`/var/lib/opengym-deploy/failed-releases`. A pending transaction is recovered
before consulting GitHub, including after SIGKILL or reboot. Failed recovery
retains the snapshot and logs `CRITICAL`; investigate before clearing it.

After a successful update, the `previous` link points at the last snapshot:

```sh
systemctl stop opengym-deploy.timer
/usr/local/sbin/opengym-deploy --rollback
```

This sets a persistent `hold`, restores and verifies the previous release,
and blocks the release just reverted. On the first Nutrition update rollback
removes only the newly introduced, stateless Nutrition container; old api/web,
all user data, media and authentication remain. No volumes are removed.
Before the first successful update there is no `previous` release snapshot:
use the installation backup if the CD files themselves must be reverted.

Once investigated, resume automatic checks:

```sh
/usr/local/sbin/opengym-deploy --resume
systemctl enable --now opengym-deploy.timer
```

The failed SHA remains blocked; prefer a new fixed main commit. To retry the
same SHA deliberately, remove only its exact line from `failed-releases` after
investigation. Protect state/backup directories (root-only); do not prune old
Docker images while their IDs are needed for rollback. Snapshot rollback is
an application/configuration rollback, **not a database restore**. Future
schema migrations need a separate compatible data-backup/restore plan.

## Verification scope

`python3 deploy/test_deploy.py` checks the actual Bash transaction using fake
Docker and HTTP: first upgrade/idempotency, three-image rollback, pre-Nutrition
rollback, manual pause/resume, CI gating, OCI mismatch and interrupted recovery.
Run production HTTP probes separately; the unit harness mocks those boundaries.
Do not treat these checks as an authenticated production-user acceptance test.
