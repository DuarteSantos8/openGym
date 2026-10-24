import { loadConfig, ConfigError } from './config.js'
import { createServer } from './server.js'

let cfg
try { cfg = loadConfig(process.env) } catch (e) {
  console.error(e instanceof ConfigError ? e.message : 'invalid connector configuration')
  process.exit(1)
}

createServer({ origin: cfg.origin, prefix: cfg.prefix, apiBase: cfg.apiBase, key: cfg.key })
  .listen(cfg.port, cfg.host, () => console.log(`opengym-connector listening on ${cfg.host}:${cfg.port} for ${cfg.origin}${cfg.prefix}`))

// Nothing to flush (all state is in memory); exit promptly so `docker stop` does not wait out its timeout.
for (const s of ['SIGTERM', 'SIGINT']) process.on(s, () => process.exit(0))
