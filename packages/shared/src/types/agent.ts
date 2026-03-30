/**
 * Agent configuration types
 */

/** Sandbox resource configuration */
export interface SandboxConfig {
  /** CPU request/limit (e.g., '500m', '2') */
  cpu?: string;
  /** Memory request/limit (e.g., '1Gi', '4Gi') */
  memory?: string;
  /** Execution timeout (e.g., '300s', '10m') */
  timeout?: string;
}

/** Agent persona configuration */
export interface AgentConfig {
  /** Agent name (identifier) */
  name: string;
  /** Human-readable description */
  description?: string;
  /** Path to prompt file (persona markdown) */
  promptFile?: string;
  /** Inline system prompt (alternative to promptFile) */
  systemPrompt?: string;
  /** Default model to use */
  model?: string;
  /** Allowed tools for Claude Code execution */
  allowedTools?: string[];
  /** Whether this agent requires file editing capability */
  requiresEdit?: boolean;
  /** Status tag patterns for rule matching */
  statusPatterns?: Record<string, string>;
  /** Sandbox resource configuration */
  sandbox?: SandboxConfig;
  /** Default instruction template */
  defaultInstruction?: string;
}
