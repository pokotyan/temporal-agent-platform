#!/usr/bin/env node

/**
 * Status display hook — shows TAP service status on session start.
 * Outputs to stderr as a user message (exit code 3 = USER_MESSAGE_ONLY).
 */

async function run() {
  const { getStatus } = require('./tap-service-manager');

  const statuses = await getStatus();
  const lines = ['', '\x1b[1m[TAP] Temporal Agent Platform\x1b[0m', ''];

  for (const [name, status] of Object.entries(statuses)) {
    const icon = status.healthy ? '\x1b[32m●\x1b[0m' : '\x1b[31m○\x1b[0m';
    const state = status.healthy ? '\x1b[32mrunning\x1b[0m' : '\x1b[31mstopped\x1b[0m';
    const port = status.port ? ` :${status.port}` : '';
    const pid = status.pid ? ` (pid ${status.pid})` : '';
    lines.push(`  ${icon} ${name}${port} — ${state}${pid}`);
  }

  const anyHealthy = Object.values(statuses).some((s) => s.healthy);
  if (anyHealthy) {
    lines.push('');
    lines.push('  TAP UI: \x1b[4mhttp://localhost:8234\x1b[0m');
  }

  lines.push('');
  process.stderr.write(lines.join('\n'));

  // Exit code 3 = USER_MESSAGE_ONLY (display only, no hook processing)
  process.exit(3);
}

run().catch((err) => {
  console.error(`[TAP] Status check failed: ${err.message}`);
  process.exit(3);
});
