/**
 * Tests for scripts/tap-service-manager.js
 *
 * Run: node --test scripts/__tests__/service-manager.test.js
 *
 * NOTE: The full start/stop integration cycle requires the `temporal` CLI
 * (~30s) and is gated behind TAP_INTEGRATION_TESTS=1.
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Isolate ~/.tap writes to a temp dir
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tap-sm-test-'));
process.env.HOME = TMP_DIR;

process.on('exit', () => {
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch {}
});

const hc = require('../health-check');
const sm = require('../tap-service-manager');

// ─── loadSettings ─────────────────────────────────────────────────────────

describe('loadSettings', () => {
  test('returns empty object when settings file missing', () => {
    const result = sm.loadSettings();
    assert.deepEqual(result, {});
  });

  test('returns parsed settings from file', () => {
    const settingsPath = path.join(TMP_DIR, '.tap', 'settings.json');
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify({ keepTemporalOnStop: true }));

    const result = sm.loadSettings();
    assert.equal(result.keepTemporalOnStop, true);

    fs.rmSync(settingsPath);
  });

  test('returns empty object on malformed JSON', () => {
    const settingsPath = path.join(TMP_DIR, '.tap', 'settings.json');
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, 'not-json{{{');

    const result = sm.loadSettings();
    assert.deepEqual(result, {});
  });
});

// ─── getStatus ─────────────────────────────────────────────────────────────

describe('getStatus', () => {
  test('returns all three services', async () => {
    const statuses = await sm.getStatus();
    assert.ok('temporal-server' in statuses);
    assert.ok('orchestrator-worker' in statuses);
    assert.ok('agent-worker' in statuses);
  });

  test('all services stopped when no PID files exist', async () => {
    // Ensure PID files are absent (fresh TMP_DIR)
    const statuses = await sm.getStatus();
    for (const [, s] of Object.entries(statuses)) {
      assert.equal(s.healthy, false);
    }
  });

  test('runs health checks in parallel (all resolve)', async () => {
    // Just verify it completes without error even if some checks time out
    const start = Date.now();
    await sm.getStatus();
    const elapsed = Date.now() - start;
    // Parallel: should finish well under 3 × checkTcp timeout
    assert.ok(elapsed < 5000, `getStatus took ${elapsed}ms, expected < 5000ms`);
  });

  test('reports healthy for a service with alive PID and no port', async () => {
    hc.writePidFile('orchestrator-worker', {
      pid: process.pid,
      startedAt: new Date().toISOString(),
      port: null,
    });

    const statuses = await sm.getStatus();
    assert.equal(statuses['orchestrator-worker'].healthy, true);

    hc.removePidFile('orchestrator-worker');
  });
});

// ─── stopService (with real spawned process) ───────────────────────────────

describe('stopService', () => {
  test('stops a running process and removes PID file', async () => {
    // Spawn a long-lived dummy process
    const child = spawn('node', ['-e', 'setTimeout(()=>{},60000)'], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();

    hc.writePidFile('orchestrator-worker', {
      pid: child.pid,
      startedAt: new Date().toISOString(),
    });

    assert.equal(hc.isProcessAlive(child.pid), true);

    await sm.stopService('orchestrator-worker');

    // Allow OS to reap
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(hc.isProcessAlive(child.pid), false);
    assert.equal(hc.readPidFile('orchestrator-worker'), null);
  });

  test('no-ops gracefully when service is not running', async () => {
    // No PID file present
    await assert.doesNotReject(() => sm.stopService('agent-worker'));
  });
});

// ─── startService (already-running path) ──────────────────────────────────

describe('startService (already-running path)', () => {
  test('skips start and returns alreadyRunning when service is healthy', async () => {
    // Simulate orchestrator-worker already running (no port check needed)
    hc.writePidFile('orchestrator-worker', {
      pid: process.pid,
      startedAt: new Date().toISOString(),
      port: null,
    });

    const result = await sm.startService('orchestrator-worker');
    assert.equal(result.alreadyRunning, true);
    assert.equal(result.started, false);

    hc.removePidFile('orchestrator-worker');
  });

  test('throws for unknown service name', async () => {
    await assert.rejects(
      () => sm.startService('unknown-svc'),
      /Unknown service/,
    );
  });
});

// ─── SERVICE_ORDER and SERVICES constants ─────────────────────────────────

describe('SERVICES and SERVICE_ORDER exports', () => {
  test('SERVICE_ORDER contains the three expected services in order', () => {
    assert.deepEqual(sm.SERVICE_ORDER, [
      'temporal-server',
      'orchestrator-worker',
      'agent-worker',
    ]);
  });

  test('SERVICES has correct port for temporal-server', () => {
    assert.equal(sm.SERVICES['temporal-server'].port, 7233);
  });

  test('SERVICES workers have no port', () => {
    assert.equal(sm.SERVICES['orchestrator-worker'].port, null);
    assert.equal(sm.SERVICES['agent-worker'].port, null);
  });

  test('agent-worker depends on temporal-server', () => {
    assert.ok(sm.SERVICES['agent-worker'].dependsOn.includes('temporal-server'));
  });
});

// ─── require.main guard ────────────────────────────────────────────────────

describe('require.main guard', () => {
  test('requiring tap-service-manager as module does not invoke CLI', async () => {
    // If the guard is broken, requiring the module would try to run the CLI
    // and likely fail (or log output). We verify no error is thrown on require.
    // (The module is already loaded above, so this is effectively a no-op assertion.)
    assert.ok(typeof sm.startService === 'function');
    assert.ok(typeof sm.stopService === 'function');
    assert.ok(typeof sm.getStatus === 'function');
  });
});

// ─── Integration: full start → stop cycle ─────────────────────────────────

if (process.env.TAP_INTEGRATION_TESTS === '1') {
  describe('Integration: temporal-server start/stop cycle', () => {
    after(async () => {
      // Always stop to clean up
      try { await sm.stopService('temporal-server'); } catch {}
    });

    test('starts temporal-server and marks it healthy', async () => {
      const result = await sm.startService('temporal-server');
      assert.ok(result.started || result.alreadyRunning);
      assert.equal(result.ready, true);

      const statuses = await sm.getStatus();
      assert.equal(statuses['temporal-server'].healthy, true);
    }, { timeout: 35000 });

    test('stops temporal-server cleanly', async () => {
      await sm.stopService('temporal-server');
      await new Promise((r) => setTimeout(r, 500));
      const statuses = await sm.getStatus();
      assert.equal(statuses['temporal-server'].healthy, false);
    }, { timeout: 10000 });
  });
}
