# Self-hosting openGym on Kubernetes


openGym is pretty simple - a frontend and an API backend. The API keeps everything in a plain JSON file on a volume. The Docker Compose file also has a third container that syncs a bunch of media files. I only have a few resources to create:

- 2 PVCs: data and media
- 1 deployment for the API and web interface: I decided to keep them in a single pod for simplicity.
- An HTTPRoute or an Ingress - you really should be using an HTTPRoute nowadays.

There are example manifests available:

```bash
git clone https://github.com/DuarteSantos8/openGym   # or https://gitlab.com/DuarteSantos8/opengym — same repo
cd openGym 
# edit the soec.template.env.containers["api"].env with at least your URL
kubectl apply -k kubernetes/
```


You will also need an API Gateway, that is configured to work with TLS. It has been tested with [Envoy Gateway](https://gateway.envoyproxy.io) and [Cert-Manager](https://cert-manager.io).

One slight difference compared to the [Docker Compose example](./SELFHOSTING.md) is that the "media" container runs as an initContainer.


