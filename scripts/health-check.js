#!/usr/bin/env node

/**
 * Health check utilities for TAP services.
 * Provides TCP port checks and PID-based process liveness checks.
 */

const { execSync } = require('child_process');
const net = require('net');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(require('os').homedir(), '.tap');
const PIDS_DIR = path.join(DATA_DIR, 'pids');

const _ensuredDirs = new Set();
function ensureDir(dir) {
  if (_ensuredDirs.has(dir)) return;
  fs.mkdirSync(dir, { recursive: true });
  _ensuredDirs.add(dir);
}

const _commandCache = new Map();
function findCommand(cmd) {
  if (_commandCache.has(cmd)) return _commandCache.get(cmd);
  try {
    const result = execSync(`which ${cmd} 2>/dev/null`, { encoding: 'utf8' }).trim();
    const resolved = result || null;
    _commandCache.set(cmd, resolved);
    return resolved;
  } catch {
    _commandCache.set(cmd, null);
    return null;
  }
}

function checkTcp(host, port, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(timeoutMs);
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('error', () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, host);
  });
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function pidFilePath(serviceName) {
  return path.join(PIDS_DIR, `${serviceName}.pid`);
}

function readPidFile(serviceName) {
  try {
    return JSON.parse(fs.readFileSync(pidFilePath(serviceName), 'utf8'));
  } catch {
    return null;
  }
}

function writePidFile(serviceName, info) {
  ensureDir(PIDS_DIR);
  fs.writeFileSync(pidFilePath(serviceName), JSON.stringify(info, null, 2));
}

function removePidFile(serviceName) {
  try {
    fs.unlinkSync(pidFilePath(serviceName));
  } catch {}
}

function isDockerAvailable() {
  try {
    execSync('docker version', { stdio: 'pipe', timeout: 5000 });
    return true;
  } catch { return false; }
}

function isDockerContainerRunning(containerName) {
  try {
    const out = execSync(
      `docker inspect --format '{{.State.Running}}' ${containerName}`,
      { stdio: 'pipe', encoding: 'utf8' },
    ).trim();
    return out === 'true';
  } catch { return false; }
}

async function isServiceHealthy(serviceName, port) {
  const info = readPidFile(serviceName);
  if (!info) return { healthy: false, reason: 'no-pid-file' };

  if (info.type === 'docker') {
    if (!isDockerContainerRunning(info.containerName)) {
      return { healthy: false, reason: 'container-not-running' };
    }
  } else {
    if (!info.pid || !isProcessAlive(info.pid)) {
      return { healthy: false, reason: 'process-dead' };
    }
  }

  if (port) {
    const tcpOk = await checkTcp('127.0.0.1', port);
    if (!tcpOk) return { healthy: false, reason: 'port-not-ready' };
  }
  return { healthy: true, pid: info.pid, containerName: info.containerName, startedAt: info.startedAt };
}

async function waitForPort(host, port, timeoutMs = 30000, intervalMs = 500) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await checkTcp(host, port, 1000)) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

async function waitForProcessSettle(pid, settleMs = 2000) {
  await new Promise((r) => setTimeout(r, settleMs));
  return isProcessAlive(pid);
}

module.exports = {
  DATA_DIR,
  PIDS_DIR,
  ensureDir,
  findCommand,
  checkTcp,
  isProcessAlive,
  isDockerAvailable,
  isDockerContainerRunning,
  readPidFile,
  writePidFile,
  removePidFile,
  isServiceHealthy,
  waitForPort,
  waitForProcessSettle,
};
