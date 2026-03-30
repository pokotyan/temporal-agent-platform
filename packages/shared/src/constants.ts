/**
 * Shared constants
 */

/** Special step transition targets */
export const COMPLETE_STEP = 'COMPLETE';
export const ABORT_STEP = 'ABORT';

/** Temporal task queue names */
export const TASK_QUEUES = {
  /** For workflow orchestration (lightweight) */
  ORCHESTRATOR: 'orchestrator',
  /** For agent activities (API calls) */
  AGENT: 'agent-tasks',
} as const;

/** Default configuration values */
export const DEFAULTS = {
  MAX_ITERATIONS: 15,
  AGENT_TIMEOUT: '10m',
  WORKFLOW_TIMEOUT: '1h',
  MODEL: 'claude-sonnet-4-20250514',
} as const;

/** Signal and query names */
export const SIGNALS = {
  USER_INPUT: 'userInput',
  CANCEL_STEP: 'cancelStep',
  PAUSE: 'pause',
  RESUME: 'resume',
} as const;

export const QUERIES = {
  STATUS: 'status',
  STEP_OUTPUTS: 'stepOutputs',
} as const;
