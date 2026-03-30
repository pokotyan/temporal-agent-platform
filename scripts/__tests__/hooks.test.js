/**
 * Tests for SessionStart/Stop/StatusDisplay hooks.
 *
 * Each hook is executed as a subprocess so its process.exit() calls don't
 * kill the test runner.
 *
 * Run: node --test scripts/__tests__/hooks.test.js
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPTS_DIR = path.resolve(__dirname, '..');
const PROJECT_ROOT = path.resolve(SCRIPTS_DIR, '..');

// Shared temp dir for hook subprocesses — cleaned up on exit
const HOOK_TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tap-hook-test-'));
process.on('exit', () => {
  try { fs.rmSync(HOOK_TMP, { recursive: true, force: true }); } catch {}
});

/** Helper: run a hook script as a subprocess with controlled env */
function runHook(scriptName, extraEnv = {}, timeoutMs = 15000) {
  return spawnSync(
    process.execPath,
    [path.join(SCRIPTS_DIR, scriptName)],
    {
      encoding: 'utf8',
      timeout: timeoutMs,
      env: {
        ...process.env,
        HOME: HOOK_TMP,
        ...extraEnv,
      },
      cwd: PROJECT_ROOT,
    },
  );
}

/** Parse the last JSON line from stdout (hooks output JSON on the final line) */
function parseHookOutput(stdout) {
  const lines = stdout.trim().split('\n').filter(Boolean);
  assert.ok(lines.length > 0, 'Hook produced no stdout');
  return JSON.parse(lines[lines.length - 1]);
}

// ─── session-stop-hook ────────────────────────────────────────────────────

describe('session-stop-hook', () => {
  test('outputs {"continue":true} and exits 0', () => {
    const result = runHook('session-stop-hook.js');
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    const json = parseHookOutput(result.stdout);
    assert.equal(json.continue, true);
  });

  test('does not crash when no services are running', () => {
    const result = runHook('session-stop-hook.js');
    assert.equal(result.status, 0);
    assert.doesNotThrow(() => parseHookOutput(result.stdout));
  });
});

// ─── session-start-hook ───────────────────────────────────────────────────

describe('session-start-hook', () => {
  test('outputs {"continue":true,"suppressOutput":true} even when Docker is unavailable', () => {
    // PATH=/usr/bin:/bin means `docker info` will fail → isDockerAvailable() = false
    const result = runHook('session-start-hook.js', {
      PATH: '/usr/bin:/bin',
    }, 10000);

    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    const json = parseHookOutput(result.stdout);
    assert.equal(json.continue, true);
    assert.equal(json.suppressOutput, true);
  });

  test('logs error to stderr when Docker is unavailable', () => {
    const result = runHook('session-start-hook.js', {
      PATH: '/usr/bin:/bin',
    }, 10000);

    assert.ok(
      result.stderr.includes('[TAP]'),
      `Expected [TAP] in stderr, got: ${result.stderr}`,
    );
  });

  test('continues when Docker is unavailable', () => {
    const result = runHook('session-start-hook.js', {
      PATH: '/usr/bin:/bin', // Docker unavailable → early exit after error
    }, 10000);

    assert.equal(result.status, 0);
    const json = parseHookOutput(result.stdout);
    assert.equal(json.continue, true);
  });

  test('never crashes the session (exit code always 0)', () => {
    const result = runHook('session-start-hook.js', {
      PATH: '',
    }, 10000);
    assert.equal(result.status, 0);
  });
});

// ─── status-display-hook ─────────────────────────────────────────────────

describe('status-display-hook', () => {
  test('exits with code 3 (USER_MESSAGE_ONLY)', () => {
    const result = runHook('status-display-hook.js');
    assert.equal(result.status, 3, `Expected exit 3, got ${result.status}; stderr: ${result.stderr}`);
  });

  test('writes output to stderr (not stdout)', () => {
    const result = runHook('status-display-hook.js');
    // stdout should be empty (or whitespace only)
    assert.equal(result.stdout.trim(), '', `Unexpected stdout: ${result.stdout}`);
    // stderr should contain service names
    assert.ok(result.stderr.length > 0, 'Expected status output on stderr');
  });

  test('stderr mentions expected service names', () => {
    const result = runHook('status-display-hook.js');
    assert.ok(result.stderr.includes('temporal-server'), `stderr: ${result.stderr}`);
    assert.ok(result.stderr.includes('orchestrator-worker'), `stderr: ${result.stderr}`);
    assert.ok(result.stderr.includes('agent-worker'), `stderr: ${result.stderr}`);
  });

  test('stderr includes TAP header', () => {
    const result = runHook('status-display-hook.js');
    assert.ok(
      result.stderr.includes('Temporal Agent Platform'),
      `Expected header in stderr, got: ${result.stderr}`,
    );
  });
});

// ─── Hook output JSON schema ──────────────────────────────────────────────

describe('Hook output schema', () => {
  test('session-stop-hook output has only required "continue" key', () => {
    const result = runHook('session-stop-hook.js');
    const json = parseHookOutput(result.stdout);
    assert.equal(typeof json.continue, 'boolean');
  });

  test('session-start-hook output has "continue" and "suppressOutput"', () => {
    const result = runHook('session-start-hook.js', { PATH: '/usr/bin:/bin' }, 10000);
    const json = parseHookOutput(result.stdout);
    assert.equal(typeof json.continue, 'boolean');
    assert.equal(typeof json.suppressOutput, 'boolean');
  });
});
