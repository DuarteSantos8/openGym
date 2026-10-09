# openGym Helm chart

Installs openGym on Kubernetes: the API and the web container in a single pod, a PVC for the data, a
Service, and optionally an Ingress or a Gateway API HTTPRoute with a cert-manager certificate. It
deploys the same thing as the plain manifests in [`kubernetes/`](../kubernetes), but lets you set
everything from values.

Read [docs/SELF_HOSTING.md](../docs/SELF_HOSTING.md) first. The passkey requirements (HTTPS, and
`RP_ID`/`ORIGIN` matching the hostname people open) and the settings in
[`.env.example`](../.env.example) apply here unchanged. Kubernetes-specific notes are in
[docs/SELF_HOSTING_KUBERNETES.md](../docs/SELF_HOSTING_KUBERNETES.md).

## Install

```bash
git clone https://github.com/DuarteSantos8/openGym
cd openGym

helm install opengym ./helm -n fitness --create-namespace \
  --set api.env.RP_ID=gym.example.com \
  --set api.env.ORIGIN=https://gym.example.com \
  --set ingress.enabled=true \
  --set ingress.hosts[0].host=gym.example.com \
  --set ingress.hosts[0].paths[0].path=/ \
  --set ingress.hosts[0].paths[0].pathType=Prefix
```

For anything more than a quick test, put your settings in a values file:

```bash
helm install opengym ./helm -n fitness --create-namespace -f my-values.yaml
helm upgrade opengym ./helm -n fitness -f my-values.yaml
helm test opengym -n fitness          # calls /api/health through the web container
```

Pods restart on their own when the ConfigMap or Secret changes.

## Exposing it

Pick one of the two routing options. Both send traffic to the Service on port 80.

### Ingress

```yaml
ingress:
  enabled: true
  className: nginx
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt
    # ingress-nginx allows 1m request bodies by default. Photo and video uploads need more:
    nginx.ingress.kubernetes.io/proxy-body-size: 48m
  hosts:
    - host: gym.example.com
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: opengym-tls
      hosts:
        - gym.example.com
```

### Gateway API (HTTPRoute)

This is the setup the plain manifests use: Envoy Gateway, with a cert-manager Certificate.

```yaml
httpRoute:
  enabled: true
  parentRefs:
    - name: eg
      namespace: envoy-gateway-system
      sectionName: https
  hostnames:
    - gym.example.com

certificate:
  enabled: true
  secretName: opengym-tls
  issuerRef:
    kind: ClusterIssuer
    name: letsencrypt
  dnsNames:
    - gym.example.com
  referenceGrant:
    enabled: true          # lets the Gateway in another namespace read the certificate Secret
    gatewayNamespace: envoy-gateway-system
```

### Neither (local test)

```bash
helm install opengym ./helm --set api.env.RP_ID=localhost --set api.env.ORIGIN=http://localhost:8080
kubectl port-forward svc/opengym 8080:80
```

Browsers allow passkeys over plain `http://` only on `localhost`.

## Configuration

### App settings

| Values key | Ends up in | Notes |
|---|---|---|
| `api.env.*` | ConfigMap `<release>-api` | Every setting from `.env.example`, under the same name. An empty value is left out, so the app default applies. `PORT` comes from `api.service.port`. |
| `api.secretEnv.*` | Secret `<release>-api` | `ADMIN_UIDS`. You can add more keys; each becomes an env var. |
| `web.env.*` | ConfigMap `<release>-web` | `BASE_PATH`, `MEDIA_UPLOAD_MAX`, `CF_CONNECTING_IP`. The chart sets `NGINX_PORT`, `PORT` and `BACKEND=127.0.0.1` itself; `NGINX_PORT` is `web.service.port`, 8080 (the image runs as uid 101, which cannot bind 80 on most Kubernetes runtimes). |

`TRUST_PROXY` stays off on purpose. The web container overwrites `X-Forwarded-For` with the
address it was reached from, which here is the ingress or gateway pod. Turning `TRUST_PROXY` on
changes nothing for the sign-in throttle, but any pod that reaches port 3000 directly could then
choose the address that gets recorded.

### Storage

| Key | Default | |
|---|---|---|
| `persistence.data.size` | `2Gi` | Accounts, passkeys, workouts, uploads, session secret. **Back this up.** |
| `persistence.data.storageClass` | `""` | `""` uses the cluster default. |
| `persistence.data.existingClaim` | `""` | Uses a PVC you already have instead of creating one. |

The chart keeps the PVC on `helm uninstall` (`helm.sh/resource-policy: keep`). To get rid of
the data, delete it by hand.

The exercise stills and animations are part of the web image, so there is no media volume. Charts
before openGym 1.4.0 created a `<release>-media` PVC for a download; after upgrading it is no
longer mounted, and since Helm keeps it, delete it by hand once the new pod runs.

### Images

`api.image.tag` and `web.image.tag` default to `1.4.0`. Change them together: an API and a web
image from different releases aren't meant to run side by side.

### Other values

`imagePullSecrets`, `serviceAccount`, `podAnnotations`, `podLabels`, `podSecurityContext`,
`securityContext`, `nodeSelector`, `tolerations`, `affinity`, `api/web.resources`
and `api/web.livenessProbe`/`readinessProbe` work the way they do in any Helm chart. See [`values.yaml`](values.yaml) for the full list.

## Always one replica

The API stores its data in JSON files on a single `ReadWriteOnce` volume, so the chart always runs
one replica with the `Recreate` strategy, and there is no autoscaler. A second API process would be
a second writer to the same files.

## Moving from `kubectl apply -k kubernetes/`

Helm refuses to take over resources it didn't create. Remove the old Deployment, Service,
HTTPRoute, Certificate and ReferenceGrant, but **keep the `opengym-data` PVC**: deleting it deletes
the data. Point the chart at the existing claim instead:

```bash
kubectl -n fitness delete deployment/opengym service/opengym httproute/opengym \
  certificate/opengym-tls referencegrant/allow-gateway
helm install opengym ./helm -n fitness -f my-values.yaml \
  --set persistence.data.existingClaim=opengym-data
```

The old `opengym-media` claim is not needed any more; delete it after the move.

The site is unreachable between the delete and the moment the new pod is ready.
