#!/usr/bin/env node
/* Kept as an alias so existing CI steps and habits keep working. The generator now also
 * produces the prompt module and lives in build-coach-assets.mjs; both flags pass through. */
await import('./build-coach-assets.mjs');
