#!/usr/bin/env node

/**
 * Stop hook — gracefully shuts down TAP dev services.
 *
 * Shutdown order (reverse dependency):
 *   1. agent-worker
 *   2. orchestrator-worker
 *   3. temporal-server (unless keepTemporalOnStop is set)
 */

async function run() {
  const { stopAll, loadSettings } = require('./tap-service-manager');
  const settings = loadSettings();
  const keepTemporal = settings.keepTemporalOnStop || false;

  try {
    await stopAll(keepTemporal);
  } catch (err) {
    console.error(`[TAP] Shutdown error: ${err.message}`);
  }

  console.log(JSON.stringify({ continue: true }));
}

run().catch((err) => {
  console.error(`[TAP] Unexpected error: ${err.message}`);
  console.log(JSON.stringify({ continue: true }));
  process.exit(0);
});
