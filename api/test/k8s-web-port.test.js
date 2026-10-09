/* The web image runs as uid 101. Docker lets it bind port 80 (ip_unprivileged_port_start=0 in
   the container); most Kubernetes runtimes do not, and nginx then dies on bind(). The image's
   own default stays 80 so compose setups keep working, and the Helm chart and the example
   manifests set an unprivileged port themselves — the container port, the probes and the
   Service following it. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('the image keeps NGINX_PORT=80 for Docker', () => {
  assert.match(read('web/Dockerfile'), /^ENV NGINX_PORT=80$/m);
});

test('kubernetes/: the web container listens on an unprivileged port, and everything follows it', () => {
  const dep = read('kubernetes/deployment.yaml');
  const web = dep.slice(dep.indexOf('- name: web'));
  const port = Number(/- name: NGINX_PORT\s+value: "(\d+)"/.exec(web)?.[1]);
  assert.ok(port >= 1024, 'NGINX_PORT ' + port);
  assert.match(web, new RegExp(`- containerPort: ${port}\\s+name: web`));
  for (const probe of ['readinessProbe', 'livenessProbe']) {
    const block = web.slice(web.indexOf(probe), web.indexOf(probe) + 120);
    assert.match(block, /port: web\b/, probe);
  }
  assert.match(read('kubernetes/service.yaml'), /targetPort: web\b/);
});

test('helm/: NGINX_PORT and the container port are web.service.port, unprivileged by default', () => {
  const values = read('helm/values.yaml');
  const webBlock = values.slice(values.indexOf('\nweb:'));
  const port = Number(/\n  service:[\s\S]*?\n    port: (\d+)/.exec(webBlock)?.[1]);
  assert.ok(port >= 1024, 'web.service.port ' + port);
  assert.match(read('helm/templates/configmap.yaml'), /NGINX_PORT: \{\{ \.Values\.web\.service\.port \| quote \}\}/);
  const dep = read('helm/templates/deployment.yaml');
  assert.match(dep, /- name: web\s+containerPort: \{\{ \.Values\.web\.service\.port \}\}/);
  assert.match(read('helm/templates/service.yaml'), /targetPort: web\b/);
  for (const probe of ['livenessProbe', 'readinessProbe']) {
    const block = webBlock.slice(webBlock.indexOf(probe), webBlock.indexOf(probe) + 80);
    assert.match(block, /port: web\b/, probe);
  }
});
