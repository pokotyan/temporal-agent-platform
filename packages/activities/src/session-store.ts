import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const SESSION_DIR = resolve(process.env.SESSION_DIR || '/tmp/tap-sessions');

interface SessionData {
  sessionId: string;
  agentName: string;
  messages: Array<{ role: string; content: string }>;
  createdAt: string;
  updatedAt: string;
}

/**
 * Simple file-based session store for agent context continuity.
 *
 * In K8s mode, this would be backed by a PersistentVolume or database.
 * For local dev, uses the filesystem.
 */

/**
 * Save session data for an agent.
 */
export async function saveSession(
  workflowId: string,
  agentName: string,
  sessionId: string,
  messages: Array<{ role: string; content: string }>,
): Promise<void> {
  const filePath = getSessionPath(workflowId, agentName);
  ensureDir(dirname(filePath));

  const data: SessionData = {
    sessionId,
    agentName,
    messages,
    createdAt: existsSync(filePath) ? JSON.parse(readFileSync(filePath, 'utf-8')).createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // Atomic write (write to temp, then rename)
  const tmpPath = `${filePath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(data, null, 2));
  const { renameSync } = require('node:fs');
  renameSync(tmpPath, filePath);
}

/**
 * Load session data for an agent.
 */
export async function loadSession(workflowId: string, agentName: string): Promise<SessionData | null> {
  const filePath = getSessionPath(workflowId, agentName);
  if (!existsSync(filePath)) return null;

  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Delete all sessions for a workflow.
 */
export async function cleanupSessions(workflowId: string): Promise<void> {
  const dirPath = resolve(SESSION_DIR, sanitizePath(workflowId));
  if (existsSync(dirPath)) {
    const { rmSync } = require('node:fs');
    rmSync(dirPath, { recursive: true, force: true });
  }
}

// ── Helpers ──

function getSessionPath(workflowId: string, agentName: string): string {
  return resolve(SESSION_DIR, sanitizePath(workflowId), `${sanitizePath(agentName)}.json`);
}

function sanitizePath(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function ensureDir(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}
