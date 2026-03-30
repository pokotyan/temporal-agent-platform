/**
 * Tests for scripts/health-check.js
 *
 * Run: node --test scripts/__tests__/health-check.test.js
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Use a temp dir for PID files so tests don't pollute ~/.tap
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tap-test-'));
process.env.HOME = TMP_DIR; // health-check.js uses os.homedir()

// Re-require AFTER patching HOME so DATA_DIR resolves to tmp
const hc = require('../health-check');

// Cleanup after all tests
process.on('exit', () => {
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch {}
});

// ─── PID file operations ────────────────────────────────────────────────────

describe('PID file operations', () => {
  const SERVICE = `test-svc-${Date.now()}`;

  test('readPidFile returns null for missing file', () => {
    const result = hc.readPidFile(SERVICE);
    assert.equal(result, null);
  });

  test('writePidFile + readPidFile round-trip', () => {
    const info = { pid: 12345, startedAt: '2026-01-01T00:00:00.000Z', port: 7233 };
    hc.writePidFile(SERVICE, info);
    const back = hc.readPidFile(SERVICE);
    assert.deepEqual(back, info);
  });

  test('removePidFile removes the file', () => {
    hc.removePidFile(SERVICE);
    assert.equal(hc.readPidFile(SERVICE), null);
  });

  test('removePidFile on missing file does not throw', () => {
    assert.doesNotThrow(() => hc.removePidFile(`nonexistent-${Date.now()}`));
  });
});

// ─── isProcessAlive ─────────────────────────────────────────────────────────

describe('isProcessAlive', () => {
  test('current process is alive', () => {
    assert.equal(hc.isProcessAlive(process.pid), true);
  });

  test('invalid PID is not alive', () => {
    // PID 0 is the kernel on macOS; process.kill(0, 0) throws EPERM not "not found"
    // Use a very large PID that almost certainly doesn't exist
    assert.equal(hc.isProcessAlive(9999999), false);
  });
});

// ─── ensureDir ───────────────────────────────────────────────────────────────

describe('ensureDir', () => {
  test('creates nested directory', () => {
    const nested = path.join(TMP_DIR, 'a', 'b', 'c');
    hc.ensureDir(nested);
    assert.equal(fs.existsSync(nested), true);
  });

  test('calling ensureDir twice does not throw', () => {
    const dir = path.join(TMP_DIR, 'idempotent');
    assert.doesNotThrow(() => {
      hc.ensureDir(dir);
      hc.ensureDir(dir); // second call: memoized
    });
  });
});

// ─── findCommand ─────────────────────────────────────────────────────────────

describe('findCommand', () => {
  test('finds node (must be in PATH)', () => {
    const result = hc.findCommand('node');
    assert.ok(result, 'node should be found in PATH');
    assert.match(result, /node/);
  });

  test('returns null for nonexistent command', () => {
    const result = hc.findCommand('__tap_nonexistent_cmd_xyz__');
    assert.equal(result, null);
  });

  test('caches results (calling twice returns same value)', () => {
    const first = hc.findCommand('node');
    const second = hc.findCommand('node');
    assert.equal(first, second);
  });
});

// ─── checkTcp ────────────────────────────────────────────────────────────────

describe('checkTcp', () => {
  let server;
  let serverPort;

  before(() => new Promise((resolve, reject) => {
    server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      serverPort = server.address().port;
      resolve();
    });
    server.on('error', reject);
  }));

  after(() => new Promise((resolve) => server.close(resolve)));

  test('returns true when port is open', async () => {
    const result = await hc.checkTcp('127.0.0.1', serverPort, 2000);
    assert.equal(result, true);
  });

  test('returns false when port is closed', async () => {
    // Pick a port that is almost certainly not in use
    const result = await hc.checkTcp('127.0.0.1', 19999, 500);
    assert.equal(result, false);
  });
});

// ─── waitForPort ─────────────────────────────────────────────────────────────

describe('waitForPort', () => {
  test('times out quickly when port is closed', async () => {
    const start = Date.now();
    const result = await hc.waitForPort('127.0.0.1', 19998, 800, 200);
    const elapsed = Date.now() - start;
    assert.equal(result, false);
    // Should have taken ~800ms (timeout), not much more
    assert.ok(elapsed < 2000, `Took ${elapsed}ms, expected < 2000ms`);
  });

  test('returns true as soon as port becomes available', async () => {
    const srv = net.createServer();
    let openPort;

    // Open server after a short delay
    const openDelay = new Promise((resolve) => {
      setTimeout(() => {
        srv.listen(0, '127.0.0.1', () => {
          openPort = srv.address().port;
          resolve();
        });
      }, 300);
    });

    // Wait for port concurrently
    await openDelay; // need port before calling waitForPort
    const result = await hc.waitForPort('127.0.0.1', openPort, 3000, 200);
    srv.close();

    assert.equal(result, true);
  });
});

// ─── isServiceHealthy ────────────────────────────────────────────────────────

describe('isServiceHealthy', () => {
  const SVC = `health-test-${Date.now()}`;

  test('returns unhealthy when no PID file', async () => {
    const result = await hc.isServiceHealthy(SVC, null);
    assert.equal(result.healthy, false);
    assert.equal(result.reason, 'no-pid-file');
  });

  test('returns unhealthy when PID is dead', async () => {
    hc.writePidFile(SVC, { pid: 9999999, startedAt: new Date().toISOString() });
    const result = await hc.isServiceHealthy(SVC, null);
    assert.equal(result.healthy, false);
    assert.equal(result.reason, 'process-dead');
    hc.removePidFile(SVC);
  });

  test('returns healthy when PID is alive and no port required', async () => {
    hc.writePidFile(SVC, { pid: process.pid, startedAt: new Date().toISOString() });
    const result = await hc.isServiceHealthy(SVC, null);
    assert.equal(result.healthy, true);
    assert.equal(result.pid, process.pid);
    hc.removePidFile(SVC);
  });

  test('returns unhealthy when port is not open', async () => {
    hc.writePidFile(SVC, { pid: process.pid, startedAt: new Date().toISOString() });
    // Use a port that is very unlikely to be open
    const result = await hc.isServiceHealthy(SVC, 19997);
    assert.equal(result.healthy, false);
    assert.equal(result.reason, 'port-not-ready');
    hc.removePidFile(SVC);
  });

  test('returns healthy when PID alive and port is open', async () => {
    const srv = net.createServer();
    await new Promise((res) => srv.listen(0, '127.0.0.1', res));
    const port = srv.address().port;

    hc.writePidFile(SVC, { pid: process.pid, startedAt: new Date().toISOString() });
    const result = await hc.isServiceHealthy(SVC, port);
    assert.equal(result.healthy, true);

    srv.close();
    hc.removePidFile(SVC);
  });

  test('returns unhealthy for docker type when container not running', async () => {
    hc.writePidFile(SVC, {
      type: 'docker',
      containerName: '__tap_nonexistent_container__',
      startedAt: new Date().toISOString(),
    });
    const result = await hc.isServiceHealthy(SVC, null);
    assert.equal(result.healthy, false);
    assert.equal(result.reason, 'container-not-running');
    hc.removePidFile(SVC);
  });
});

// ─── Docker utilities ─────────────────────────────────────────────────────

describe('isDockerAvailable', () => {
  test('returns a boolean', () => {
    const result = hc.isDockerAvailable();
    assert.equal(typeof result, 'boolean');
  });
});

describe('isDockerContainerRunning', () => {
  test('returns false for nonexistent container', () => {
    const result = hc.isDockerContainerRunning('__tap_nonexistent_container_xyz__');
    assert.equal(result, false);
  });
});
