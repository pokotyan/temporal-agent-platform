import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DEFAULTS } from '@tap/shared';

/**
 * Run Claude Code CLI in non-interactive mode.
 * Uses the user's ~/.claude.json config, so all MCP servers
 * (GitHub, Slack, etc.) and tool permissions are available.
 */
export function runClaude(
  prompt: string,
  options: { maxTurns?: number; model?: string; allowedTools?: string[] } = {},
): string {
  const args = ['-p', '--output-format', 'text', '--permission-mode', 'bypassPermissions'];

  if (options.model) {
    args.push('--model', options.model);
  }
  if (options.maxTurns) {
    args.push('--max-turns', String(options.maxTurns));
  }
  if (options.allowedTools && options.allowedTools.length > 0) {
    args.push('--allowedTools', ...options.allowedTools);
  }

  // Exclude ANTHROPIC_API_KEY so the CLI uses its own auth (Claude Max / OAuth).
  // An invalid key in the environment would override the CLI's built-in auth and cause failures.
  const { ANTHROPIC_API_KEY: _, ...cleanEnv } = process.env;

  const result = execFileSync('claude', args, {
    input: prompt,
    encoding: 'utf8',
    timeout: 10 * 60 * 1000, // 10 min
    maxBuffer: 10 * 1024 * 1024, // 10 MB
    env: { ...cleanEnv, ENABLE_TOOL_SEARCH: 'true' },
  });

  return result;
}

interface ExecuteAgentParams {
  workflowId: string;
  stepName: string;
  agentConfig: string;
  instruction: string;
  sessionId?: string;
  edit?: boolean;
}

interface AgentResult {
  content: string;
  sessionId?: string;
  blocked: boolean;
}

interface ExecutePromptParams {
  prompt: string;
  context: { lastResult: string; runCount: number };
  agentConfig?: string;
  model?: string;
}

/**
 * Execute an agent via Claude Code CLI.
 *
 * Uses `claude -p` so the agent has access to all MCP servers
 * and tools configured in ~/.claude.json (GitHub, Slack, etc.)
 */
export async function executeAgent(params: ExecuteAgentParams): Promise<AgentResult> {
  // No --allowedTools restriction: inherits ~/.claude/settings.json sandbox settings,
  // giving the same UX as running Claude Code locally (MCP, skills, etc. all available).
  const content = runClaude(params.instruction, {
    model: DEFAULTS.MODEL,
    maxTurns: 30,
  });

  const blocked = content.includes('[BLOCKED]') || content.includes('[NEEDS_INPUT]');

  return {
    content,
    sessionId: `${params.workflowId}-${params.stepName}`,
    blocked,
  };
}

/**
 * Execute a prompt for the Ambient Agent (Durable Loop).
 *
 * Simpler than executeAgent — just runs a prompt with context
 * from the previous iteration.
 */
export async function executePrompt(params: ExecutePromptParams): Promise<string> {
  const contextMessage = params.context.lastResult
    ? `\n\n## Previous Result (Run #${params.context.runCount - 1})\n${params.context.lastResult}`
    : '';

  return runClaude(`${params.prompt}${contextMessage}\n\n---\nThis is run #${params.context.runCount}.`, {
    model: params.model || DEFAULTS.MODEL,
    maxTurns: 10,
  });
}

/**
 * Generate a report from an agent's session output.
 * Phase 2 of step execution.
 */
export async function generateReport(params: {
  agentConfig: string;
  sessionId?: string;
  reportConfig: { name: string; format: string };
  reportDir: string;
  sourceContent: string;
}): Promise<string> {
  return runClaude(
    `Generate a ${params.reportConfig.format} report summarizing the following work:\n\n${params.sourceContent.slice(0, 4000)}`,
    { model: DEFAULTS.MODEL, maxTurns: 3 },
  );
}

/**
 * Evaluate step status for Phase 3 judgment.
 * Asks the AI to classify the output against available rules.
 */
export async function evaluateStatus(params: {
  agentConfig: string;
  sessionId?: string;
  rules: Array<{ condition: string; next: string; status?: string }>;
  stepName: string;
  responseContent: string;
}): Promise<{ tag: string }> {
  const ruleOptions = params.rules.map((r, i) => `${i + 1}. "${r.condition}" (tag: ${r.status || r.next})`).join('\n');

  // Status tags (e.g. [FIX:DONE]) appear at the END of responses. Use tail + head to avoid missing them.
  const content =
    params.responseContent.length > 4000
      ? `${params.responseContent.slice(0, 1500)}\n...\n${params.responseContent.slice(-2500)}`
      : params.responseContent;

  const tag = runClaude(
    `Based on the following work output, which condition best describes the outcome?\n\n## Work Output\n${content}\n\n## Options\n${ruleOptions}\n\nRespond with ONLY the exact tag value shown in parentheses (e.g., if the option shows "(tag: review)", respond with exactly: review).`,
    { model: DEFAULTS.MODEL, maxTurns: 1 },
  )
    .trim()
    .toLowerCase();

  return { tag };
}

/**
 * Save workflow output to a markdown file for browser viewing.
 * Files are stored at ~/.tap/outputs/{workflowId}.md
 * and served via http://localhost:8234/outputs/{workflowId}
 */
export async function saveOutput(params: {
  workflowId: string;
  workflowName: string;
  stepOutputs: Record<string, string>;
  finalStatus: string;
}): Promise<string> {
  const outputsDir = join(homedir(), '.tap', 'outputs');
  mkdirSync(outputsDir, { recursive: true });

  const lines = [
    `# ${params.workflowName}`,
    '',
    `**Workflow ID:** ${params.workflowId}`,
    `**Status:** ${params.finalStatus}`,
    `**Generated:** ${new Date().toISOString()}`,
    '',
  ];

  for (const [stepName, output] of Object.entries(params.stepOutputs)) {
    lines.push(`## Step: ${stepName}`, '', output, '', '---', '');
  }

  const filePath = join(outputsDir, `${params.workflowId}.md`);
  writeFileSync(filePath, lines.join('\n'), 'utf8');
  return filePath;
}

/**
 * Send a macOS notification via terminal-notifier.
 * Clicking the notification opens the workflow output in the browser.
 */
export async function sendNotification(params: {
  workflowId: string;
  workflowName: string;
  message: string;
}): Promise<void> {
  const url = `http://localhost:${process.env.TAP_UI_PORT || '8234'}/outputs/${params.workflowId}`;
  return new Promise<void>((resolve) => {
    execFile('terminal-notifier', ['-title', params.workflowName, '-message', params.message, '-open', url], () => {
      // Resolve regardless of success — notification is best-effort
      resolve();
    });
  });
}
