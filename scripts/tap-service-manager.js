#!/usr/bin/env node

/**
 * TAP Service Manager — manages Temporal dev server and worker processes.
 *
 * Usage:
 *   node tap-service-manager.js start [service]
 *   node tap-service-manager.js stop [service]
 *   node tap-service-manager.js restart [service]
 *   node tap-service-manager.js status
 *
 * If no service name is given, operates on all services.
 */

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const {
  DATA_DIR,
  ensureDir,
  findCommand,
  isProcessAlive,
  isDockerContainerRunning,
  readPidFile,
  writePidFile,
  removePidFile,
  isServiceHealthy,
  waitForPort,
  waitForProcessSettle,
} = require('./health-check');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const LOGS_DIR = path.join(DATA_DIR, 'logs');

const SERVICES = {
  'temporal-server': {
    type: 'docker',
    image: 'temporalio/temporal:latest',
    containerName: 'tap-temporal-server',
    dockerRunArgs: [
      '-p',
      '7233:7233',
      '-p',
      '8233:8233',
      // Host directory mount for SQLite persistence across container restarts
      '-v',
      `${path.join(PROJECT_ROOT, '.temporal')}:/data`,
    ],
    // `temporal server start-dev` with SQLite persistence, bound to all interfaces
    dockerCmd: ['server', 'start-dev', '--ip', '0.0.0.0', '-f', '/data/temporal.db'],
    port: 7233,
    dependsOn: [],
    startupTimeoutMs: 60000, // 初回はimage pullが走るため余裕を持たせる
    env: {},
  },
  'orchestrator-worker': {
    command: 'node',
    args: [path.join(PROJECT_ROOT, 'packages/workers/dist/orchestrator-worker.js')],
    port: null,
    dependsOn: ['temporal-server'],
    startupTimeoutMs: 10000,
    env: {},
  },
  'agent-worker': {
    command: 'node',
    args: [path.join(PROJECT_ROOT, 'packages/workers/dist/agent-worker.js')],
    port: null,
    dependsOn: ['temporal-server'],
    startupTimeoutMs: 10000,
    env: {},
  },
  'tap-ui': {
    command: 'node',
    args: [path.join(PROJECT_ROOT, 'scripts/tap-ui-server.js')],
    port: 8234,
    dependsOn: ['temporal-server'],
    startupTimeoutMs: 10000,
    env: {},
  },
};

const SERVICE_ORDER = ['temporal-server', 'orchestrator-worker', 'agent-worker', 'tap-ui'];

function today() {
  return new Date().toISOString().slice(0, 10);
}

function logFile(serviceName) {
  ensureDir(LOGS_DIR);
  return path.join(LOGS_DIR, `${serviceName}-${today()}.log`);
}

/**
 * Start a Docker-managed service.
 */
async function startDockerService(name, config) {
  if (isDockerContainerRunning(config.containerName)) {
    console.log(`[TAP] ${name} already running (container ${config.containerName})`);
    return { started: false, alreadyRunning: true };
  }

  // Remove stale stopped container to avoid name conflict
  try {
    execSync(`docker rm -f ${config.containerName}`, { stdio: 'pipe' });
  } catch {}

  // Ensure any host-directory volumes exist before docker run
  for (const arg of config.dockerRunArgs || []) {
    const m = arg.match(/^([^:]+):\/data/);
    if (m) ensureDir(m[1]);
  }

  const logStream = fs.openSync(logFile(name), 'a');
  const child = spawn(
    'docker',
    ['run', '-d', '--name', config.containerName, ...config.dockerRunArgs, config.image, ...(config.dockerCmd || [])],
    { detached: true, stdio: ['ignore', logStream, logStream] },
  );
  child.unref();
  fs.closeSync(logStream);

  writePidFile(name, {
    type: 'docker',
    containerName: config.containerName,
    startedAt: new Date().toISOString(),
    port: config.port,
  });

  console.log(`[TAP] ${name} started (container ${config.containerName})`);

  const ready = await waitForPort('127.0.0.1', config.port, config.startupTimeoutMs);
  if (!ready) {
    console.error(`[TAP] ${name} failed to become ready on port ${config.port}`);
    return { started: true, ready: false };
  }
  console.log(`[TAP] ${name} ready on port ${config.port}`);
  return { started: true, ready: true };
}

/**
 * Stop a Docker-managed service.
 */
async function stopDockerService(name, info) {
  if (!isDockerContainerRunning(info.containerName)) {
    console.log(`[TAP] ${name} not running`);
    removePidFile(name);
    return;
  }
  try {
    execSync(`docker stop ${info.containerName}`, { stdio: 'pipe' });
    console.log(`[TAP] ${name} stopped (container ${info.containerName})`);
  } catch (err) {
    console.error(`[TAP] Failed to stop ${name}: ${err.message}`);
  }
  removePidFile(name);
}

/**
 * Start a single service if not already running.
 */
async function startService(name) {
  const config = SERVICES[name];
  if (!config) throw new Error(`Unknown service: ${name}`);

  if (config.type === 'docker') {
    return startDockerService(name, config);
  }

  const health = await isServiceHealthy(name, config.port);
  if (health.healthy) {
    console.log(`[TAP] ${name} already running (pid ${health.pid})`);
    return { started: false, pid: health.pid, alreadyRunning: true };
  }

  removePidFile(name);

  const depChecks = config.dependsOn.map((dep) =>
    isServiceHealthy(dep, SERVICES[dep].port).then((h) => {
      if (!h.healthy) throw new Error(`Dependency ${dep} is not running. Start it first.`);
    }),
  );
  await Promise.all(depChecks);

  const cmdPath = findCommand(config.command);
  if (!cmdPath && config.command !== 'node') {
    throw new Error(`Command not found: ${config.command}. Install it and ensure it's in PATH.`);
  }

  const env = {
    ...process.env,
    ...config.env,
    TEMPORAL_ADDRESS: process.env.TEMPORAL_ADDRESS || 'localhost:7233',
  };

  const logStream = fs.openSync(logFile(name), 'a');
  const child = spawn(cmdPath || config.command, config.args, {
    detached: true,
    stdio: ['ignore', logStream, logStream],
    env,
    cwd: PROJECT_ROOT,
  });

  child.unref();
  fs.closeSync(logStream);

  writePidFile(name, {
    pid: child.pid,
    startedAt: new Date().toISOString(),
    command: config.command,
    args: config.args,
    port: config.port,
  });

  console.log(`[TAP] ${name} started (pid ${child.pid})`);

  if (config.port) {
    const ready = await waitForPort('127.0.0.1', config.port, config.startupTimeoutMs);
    if (!ready) {
      console.error(`[TAP] ${name} failed to become ready on port ${config.port}`);
      return { started: true, pid: child.pid, ready: false };
    }
    console.log(`[TAP] ${name} ready on port ${config.port}`);
  } else {
    const alive = await waitForProcessSettle(child.pid);
    if (!alive) {
      console.error(`[TAP] ${name} crashed shortly after start. Check logs: ${logFile(name)}`);
      removePidFile(name);
      return { started: true, pid: child.pid, ready: false };
    }
  }

  return { started: true, pid: child.pid, ready: true };
}

/**
 * Stop a single service.
 */
async function stopService(name) {
  const info = readPidFile(name);

  if (info?.type === 'docker') {
    return stopDockerService(name, info);
  }

  if (!info || !info.pid) {
    console.log(`[TAP] ${name} not running (no PID file)`);
    removePidFile(name);
    return;
  }

  if (!isProcessAlive(info.pid)) {
    console.log(`[TAP] ${name} not running (process dead)`);
    removePidFile(name);
    return;
  }

  try {
    process.kill(info.pid, 'SIGTERM');
  } catch {
    removePidFile(name);
    return;
  }

  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && isProcessAlive(info.pid)) {
    await new Promise((r) => setTimeout(r, 200));
  }

  if (isProcessAlive(info.pid)) {
    try {
      process.kill(info.pid, 'SIGKILL');
    } catch {}
    console.log(`[TAP] ${name} force-killed (pid ${info.pid})`);
  } else {
    console.log(`[TAP] ${name} stopped (pid ${info.pid})`);
  }

  removePidFile(name);
}

/**
 * Start all services in dependency order.
 */
async function startAll() {
  // Start temporal-server first
  const tsResult = await startService('temporal-server');
  if (tsResult.ready === false && !tsResult.alreadyRunning) {
    console.error('[TAP] Temporal server failed to start. Aborting worker startup.');
    return;
  }

  // Start workers + UI in parallel
  const dependents = ['orchestrator-worker', 'agent-worker', 'tap-ui'];
  const results = await Promise.allSettled(
    dependents.map(async (name) => {
      return { name, ...(await startService(name)) };
    }),
  );

  for (const result of results) {
    if (result.status === 'rejected') {
      console.error(`[TAP] Service start failed: ${result.reason}`);
    }
  }
}

/**
 * Stop all services in reverse dependency order.
 */
async function stopAll(keepTemporal = false) {
  // Stop workers first (parallel)
  await Promise.allSettled([stopService('tap-ui'), stopService('agent-worker'), stopService('orchestrator-worker')]);

  // Then stop temporal server
  if (!keepTemporal) {
    await stopService('temporal-server');
  } else {
    console.log('[TAP] Keeping temporal-server running (keepTemporalOnStop=true)');
  }
}

/**
 * Get status of all services.
 */
async function getStatus() {
  const entries = await Promise.all(
    SERVICE_ORDER.map(async (name) => {
      const config = SERVICES[name];
      const health = await isServiceHealthy(name, config.port);
      return [name, { ...health, port: config.port }];
    }),
  );
  return Object.fromEntries(entries);
}

/**
 * Load settings from ~/.tap/settings.json
 */
function loadSettings() {
  const settingsPath = path.join(DATA_DIR, 'settings.json');
  try {
    return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch {
    return {};
  }
}

// CLI interface
async function main() {
  const [, , command, serviceName] = process.argv;

  switch (command) {
    case 'start':
      if (serviceName) {
        await startService(serviceName);
      } else {
        await startAll();
      }
      break;

    case 'stop': {
      const settings = loadSettings();
      if (serviceName) {
        await stopService(serviceName);
      } else {
        await stopAll(settings.keepTemporalOnStop || false);
      }
      break;
    }

    case 'restart':
      if (serviceName) {
        await stopService(serviceName);
        await startService(serviceName);
      } else {
        await stopAll(false);
        await startAll();
      }
      break;

    case 'status': {
      const statuses = await getStatus();
      for (const [name, status] of Object.entries(statuses)) {
        const icon = status.healthy ? '\u2705' : '\u274C';
        const pid = status.pid ? ` (pid ${status.pid})` : '';
        const port = status.port ? ` :${status.port}` : '';
        console.log(`${icon} ${name}${port}${pid}`);
      }
      break;
    }

    default:
      console.log('Usage: tap-service-manager.js <start|stop|restart|status> [service]');
      console.log('Services: temporal-server, orchestrator-worker, agent-worker');
      process.exit(1);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[TAP] Error:', err.message);
    process.exit(1);
  });
}

module.exports = { startService, stopService, startAll, stopAll, getStatus, loadSettings, SERVICES, SERVICE_ORDER };
