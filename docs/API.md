# HTTP API

The complete Gains HTTP API — every route of `api/server.js`, with auth,
request/response schemas and the env-dependent behavior — is documented as a
hand-written OpenAPI 3.1 spec:

- **Spec (source of truth):** [`api/openapi.yaml`](../api/openapi.yaml)
- **Browsing it:** paste the file into any OpenAPI viewer (Swagger Editor, Redoc, Scalar).

Lint it after changing routes:

```sh
npx --yes @redocly/cli lint api/openapi.yaml
```
