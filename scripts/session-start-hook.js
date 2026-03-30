#!/usr/bin/env node

/**
 * SessionStart hook — auto-starts TAP dev services.
 *
 * Execution flow:
 *   1. Validate environment (temporal CLI, built dist/)
 *   2. Start Temporal dev server (if not already running)
 *   3. Wait for Temporal readiness on port 7233
 *   4. Start workers in parallel
 *   5. Output hook result JSON
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { isDockerAvailable } = require('./health-check');

const PROJECT_ROOT = path.resolve(__dirname, '..');

function isBuilt() {
  return fs.existsSync(path.join(PROJECT_ROOT, 'packages/workers/dist/orchestrator-worker.js'));
}

async function run() {
  const errors = [];
  const warnings = [];

  // Step 1: Validate environment
  if (!isDockerAvailable()) {
    errors.push('Docker not running. Start Docker Desktop: https://www.docker.com/products/docker-desktop/');
    outputResult(errors, warnings);
    return;
  }

  if (!isBuilt()) {
    console.error('[TAP] dist/ not found, running npm run build...');
    try {
      execSync('npm run build', { cwd: PROJECT_ROOT, timeout: 30000, stdio: 'pipe' });
      console.error('[TAP] Build completed.');
    } catch (err) {
      errors.push(`Build failed: ${err.message}. Run 'npm run build' manually.`);
      outputResult(errors, warnings);
      return;
    }
  }

  // Step 2-4: Start services
  try {
    const { startAll } = require('./tap-service-manager');
    await startAll();
  } catch (err) {
    errors.push(`Service startup error: ${err.message}`);
  }

  outputResult(errors, warnings);
}

function outputResult(errors, warnings) {
  // Log to stderr (visible in hook output)
  for (const w of warnings) {
    console.error(`[TAP] Warning: ${w}`);
  }
  for (const e of errors) {
    console.error(`[TAP] Error: ${e}`);
  }

  // Output hook result to stdout
  console.log(JSON.stringify({ continue: true, suppressOutput: true }));
}

run().catch((err) => {
  console.error(`[TAP] Unexpected error: ${err.message}`);
  // Always continue the session even if hook fails
  console.log(JSON.stringify({ continue: true, suppressOutput: true }));
  process.exit(0);
});
