# Self-hosting openGym on Kubernetes

Example manifests for a small cluster, contributed from a K3s setup with the Gateway API and
cert-manager. Read [SELF_HOSTING.md](SELF_HOSTING.md) first: the passkey requirement (HTTPS,
`RP_ID`, `ORIGIN`), the settings in `.env.example` and the backup advice apply here unchanged.

openGym is pretty simple — a frontend and an API backend. The API keeps everything in plain JSON
files on a volume. The exercise pictures and animations are part of the web image, so nothing is
downloaded at start-up. There are only a few resources to create:

- 1 PVC: `opengym-data` (users, passkeys, workouts, uploads, **back this one up**).
- 1 Deployment running the API and the web container in a single pod, for simplicity. It stays at
  one replica with the `Recreate` strategy: the API's data is files on a `ReadWriteOnce` volume,
  and two API processes must never write them at once.
- An HTTPRoute (the example uses the Gateway API; an Ingress to the `opengym` Service on port 80
  works as well), plus a cert-manager Certificate for the hostname.

```bash
git clone https://github.com/DuarteSantos8/openGym   # or https://gitlab.com/DuarteSantos8/opengym — same repo
cd openGym
# In kubernetes/deployment.yaml, set RP_ID and ORIGIN in spec.template.spec.containers[api].env
# to your hostname, and the hostname in kubernetes/httproute.yaml.
kubectl apply -k kubernetes/
```

Notes:

- The web container listens on 8080 (`NGINX_PORT`), not on the image's default 80: it runs as
  uid 101, which can bind a port below 1024 only where the runtime sets
  `net.ipv4.ip_unprivileged_port_start=0`, as Docker does and most Kubernetes runtimes do not.
  The Service still answers on port 80 and targets the container's `web` port by name. Writing
  your own manifests, keep `NGINX_PORT` at 1024 or higher, or set that sysctl on the pod.
- The manifests create and use the `fitness` namespace (`kubernetes/namespace.yaml`, set on every
  resource by `kubernetes/kustomization.yaml`; rename it in both), and a Gateway
  called `eg` in `envoy-gateway-system` with an `https` listener; change both to match your
  cluster. The Gateway has to terminate TLS; this was tested with
  [Envoy Gateway](https://gateway.envoyproxy.io) and [cert-manager](https://cert-manager.io).
- The images are the published `ghcr.io/duartesantos8/opengym-api` and `opengym-web`. The AI
  Coach with an API key works on that same API image; the Claude and Codex sign-in providers
  need the `coach` build target, which is not published — build it yourself (see
  [AI_COACH.md](AI_COACH.md)).
- The images are pinned to a release (`1.4.0`), the API and the web image always to the same
  one. To update, read the release notes, set the new version on both and apply again; pinning
  to `latest` instead means a restarted pod can come back on a version you never chose.
- Coming from a version before 1.4.0: the `media-download` initContainer and the `opengym-media`
  PVC are gone, since the media now ship in the web image. Once the new pod runs, delete the old
  claim with `kubectl delete pvc opengym-media -n fitness` (`kubectl apply -k` leaves it in place).
- Settings are environment variables on the `api` container, named as in `.env.example`. Keep
  secrets such as the push keys in a Kubernetes Secret and load them with `envFrom`.
- **Client addresses.** The web container overwrites `X-Forwarded-For` with the address it was
  reached from (see `web/nginx.conf.template`), and behind a Gateway that is the gateway's pod,
  not the visitor. So the sign-in throttle, which counts attempts per address, acts on the whole
  instance at once, and the activity log records the gateway's address. `TRUST_PROXY` is left
  off because it would not change that: the API would read the same gateway address from the
  header — and any pod that reaches port 3000 directly could put its own address there. Getting
  real visitor addresses needs the gateway to preserve them (for example
  `externalTrafficPolicy: Local` on its LoadBalancer Service) and to set a header of its own that
  overwrites whatever a client sent; pass that through with `CF_CONNECTING_IP` on the `web`
  container (as `.env.example` describes for Cloudflare), turn on `TRUST_PROXY=1` on the `api`
  container, and add a NetworkPolicy so only the web container's pod reaches port 3000.
