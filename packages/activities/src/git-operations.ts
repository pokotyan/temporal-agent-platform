import { execSync } from 'node:child_process';

/**
 * Git operations for workflow execution.
 *
 * In K8s mode, these run inside sandbox pods.
 * In local dev mode, these run on the host.
 */

/**
 * Create a branch for the workflow task.
 */
export async function createBranch(params: {
  repoUrl: string;
  baseBranch: string;
  newBranch: string;
  workDir: string;
}): Promise<void> {
  const { workDir, baseBranch, newBranch } = params;

  execGit(['checkout', baseBranch], workDir);
  execGit(['pull', 'origin', baseBranch], workDir);
  execGit(['checkout', '-b', newBranch], workDir);
}

/**
 * Commit all changes with a descriptive message.
 */
export async function commitChanges(params: { workDir: string; message: string; author?: string }): Promise<string> {
  const { workDir, message, author } = params;

  execGit(['add', '-A'], workDir);

  const authorFlag = author ? ['--author', author] : ['--author', 'TAP Agent <tap-agent@localhost>'];

  execGit(['commit', '-m', message, ...authorFlag], workDir);

  // Return commit hash
  return execGit(['rev-parse', 'HEAD'], workDir).trim();
}

/**
 * Push changes to remote.
 */
export async function pushChanges(params: { workDir: string; branch: string; force?: boolean }): Promise<void> {
  const { workDir, branch, force } = params;
  const args = ['push', 'origin', branch];
  if (force) args.push('--force-with-lease');
  execGit(args, workDir);
}

/**
 * Get diff of current changes (staged + unstaged).
 */
export async function getDiff(params: { workDir: string; staged?: boolean }): Promise<string> {
  const { workDir, staged } = params;
  const args = ['diff'];
  if (staged) args.push('--cached');
  return execGit(args, workDir);
}

/**
 * Clone a repository.
 */
export async function cloneRepo(params: {
  repoUrl: string;
  branch: string;
  destDir: string;
  depth?: number;
}): Promise<void> {
  const { repoUrl, branch, destDir, depth } = params;
  const args = ['clone', '--branch', branch];
  if (depth) args.push('--depth', String(depth));
  args.push(repoUrl, destDir);
  execSync(`git ${args.join(' ')}`, { stdio: 'pipe' });
}

// ── Helper ──

function execGit(args: string[], cwd: string): string {
  try {
    return execSync(`git ${args.join(' ')}`, {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err: any) {
    throw new Error(`Git command failed: git ${args.join(' ')}\n${err.stderr || err.message}`);
  }
}
