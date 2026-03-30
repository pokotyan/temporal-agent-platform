/**
 * Runtime execution types — workflow state and results
 */

/** Workflow execution status */
export type WorkflowStatus = 'running' | 'completed' | 'aborted' | 'blocked';

/** Workflow execution state (queryable via Temporal) */
export interface WorkflowState {
  /** Current execution status */
  status: WorkflowStatus;
  /** Current step being executed */
  currentStep: string;
  /** Global iteration counter */
  iteration: number;
  /** Accumulated step outputs keyed by step name */
  stepOutputs: Record<string, string>;
  /** Agent session IDs for context continuity */
  agentSessions: Record<string, string>;
  /** User inputs received via signals */
  userInputs: string[];
}

/** Result of a single step execution */
export interface StepResult {
  /** Main output content from the agent */
  output: string;
  /** Agent session ID for future continuity */
  agentSessionId?: string;
  /** Generated report file path */
  reportPath?: string;
  /** Status tag from Phase 3 judgment */
  statusTag?: string;
  /** Step completion status */
  status: 'complete' | 'blocked' | 'failed';
  /** Sub-step statuses (for parallel steps) */
  subStepStatuses?: SubStepStatus[];
  /** Git diff produced by the agent (if edit mode) */
  gitDiff?: string;
}

/** Status of a parallel sub-step */
export interface SubStepStatus {
  /** Sub-step name */
  name: string;
  /** Resolved status tag */
  status: string;
}

/** Overall workflow result */
export interface WorkflowResult {
  /** Final workflow state */
  state: WorkflowState;
  /** Output from the last executed step */
  finalOutput?: string;
}

/** Parameters for agent execution activity */
export interface AgentExecutionParams {
  /** Workflow ID for tracking */
  workflowId: string;
  /** Step name for tracking */
  stepName: string;
  /** Agent config name (references agents/*.yaml) */
  agentConfig: string;
  /** Fully composed instruction */
  instruction: string;
  /** Session ID for context continuity */
  sessionId?: string;
  /** Sandbox configuration override */
  sandboxConfig?: import('./agent').SandboxConfig;
  /** Working directory path */
  cwd?: string;
  /** Whether the agent can edit files */
  edit?: boolean;
  /** Allowed tools override */
  allowedTools?: string[];
  /** Git configuration for sandbox */
  gitConfig?: GitConfig;
}

/** Git configuration for sandbox pod */
export interface GitConfig {
  /** Repository URL to clone */
  repoUrl: string;
  /** Branch to work on */
  branch: string;
  /** GitHub token for authentication */
  token?: string;
}

/** Step execution context passed from piece workflow */
export interface StepContext {
  /** Previous step's output */
  previousResponse?: string;
  /** Most recent user input from a blocked step (available as {user_input} in templates) */
  lastUserInput?: string;
  /** Accumulated user inputs */
  userInputs: string[];
  /** Current iteration number */
  iteration?: number;
  /** Maximum iterations */
  maxIterations?: number;
  /** Git diff from previous steps */
  gitDiff?: string;
  /** Report directory path */
  reportDir: string;
  /** Active policies */
  policies: string[];
  /** Knowledge context */
  knowledge: string[];
  /** Agent session map */
  agentSessions: Record<string, string>;
}

/** Ambient agent (durable loop) configuration */
export interface AmbientConfig {
  /** Prompt to execute each iteration */
  prompt: string;
  /** Interval between executions (e.g., '5m', '1h') */
  interval: string;
  /** Condition for automatic stop (evaluated by AI) */
  stopCondition?: string;
  /** Maximum iterations (0 = unlimited) */
  maxIterations?: number;
  /** Agent config to use */
  agentConfig?: string;
  /** Model override */
  model?: string;
}
