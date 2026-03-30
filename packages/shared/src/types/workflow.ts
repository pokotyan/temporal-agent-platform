/**
 * Workflow configuration types — compatible with takt YAML format
 */

/** Rule condition for step transitions */
export interface RuleConfig {
  /** Condition text (matched against agent output or used for AI judgment) */
  condition: string;
  /** Next step name, or 'COMPLETE' / 'ABORT' */
  next: string;
  /** Status tag for parallel sub-step aggregation */
  status?: string;
}

/** Report generation configuration */
export interface ReportConfig {
  /** Output file name */
  name: string;
  /** Output format */
  format: 'markdown' | 'json' | 'text';
}

/** Temporal-specific step overrides */
export interface StepTemporalConfig {
  /** Task queue override for this step's activities */
  taskQueue?: string;
  /** Activity timeout for the main work phase */
  startToCloseTimeout?: string;
  /** Retry policy override */
  retryPolicy?: {
    maxAttempts?: number;
    backoffCoefficient?: number;
    initialInterval?: string;
    maxInterval?: string;
  };
}

/** A single workflow step */
export interface StepConfig {
  /** Unique step name */
  name: string;
  /** Agent name (references agent YAML in resources/agents/) */
  agent?: string;
  /** Claude Code Skill name — invoked via `claude -p "/{skill} {instruction}"` */
  skill?: string;
  /** Whether the agent can edit files */
  edit?: boolean;
  /** Permission mode: 'edit' | 'readonly' | 'full' */
  permissionMode?: 'edit' | 'readonly' | 'full';
  /** Model override (e.g., 'opus', 'sonnet') */
  model?: string;
  /** Instruction template with {task}, {previous_response}, etc. */
  instructionTemplate?: string;
  /** Whether to pass previous step's output to this step */
  passPreviousResponse?: boolean;
  /** Rules for determining next step */
  rules?: RuleConfig[];
  /** Report generation config */
  report?: ReportConfig;
  /** Parallel sub-steps (mutually exclusive with agent) */
  parallel?: StepConfig[];
  /** Temporal-specific overrides */
  temporal?: StepTemporalConfig;
}

/** Temporal-specific workflow configuration */
export interface WorkflowTemporalConfig {
  /** Default task queue for activities */
  taskQueue?: string;
  /** Overall workflow timeout */
  workflowExecutionTimeout?: string;
  /** Retry policy for the workflow */
  retryPolicy?: {
    maxAttempts?: number;
    backoffCoefficient?: number;
  };
  /** Cron schedule — when set, running this workflow creates a Temporal Schedule */
  schedule?: {
    cron: string;
    /** What to do if a previous run is still active when the cron fires */
    overlapPolicy?: 'skip' | 'cancel_other' | 'allow_all';
  };
}

/** Top-level workflow configuration */
export interface WorkflowConfig {
  /** Workflow name */
  name: string;
  /** Human-readable description */
  description?: string;
  /** The task this workflow performs — passed as {task} in instruction templates */
  task?: string;
  /** First step to execute */
  initialStep: string;
  /** Maximum loop iterations before auto-abort */
  maxIterations: number;
  /** Step definitions */
  steps: StepConfig[];
  /** Temporal-specific settings */
  temporal?: WorkflowTemporalConfig;
}
