// ── Workflow ──

export type WorkflowStatus = 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'TIMED_OUT' | 'UNKNOWN';

export interface WorkflowSummary {
  workflowId: string;
  status: WorkflowStatus;
  startTime: string;
  closeTime?: string;
  type?: string;
  workflowName?: string;
}

export interface WorkflowDetail {
  workflowId: string;
  status: WorkflowStatus;
  startTime: string;
  closeTime?: string;
  type?: string;
  workflowName?: string;
  state?: { iteration?: number; status?: string; currentStep?: string };
  stepOutputs: Record<string, string>;
}

export interface StepInfo {
  workflowId: string;
  step: string;
  status: WorkflowStatus;
  iteration: number;
  startTime: string;
  closeTime?: string;
}

// ── Templates ──

export interface WorkflowTemplate {
  name: string;
  description?: string;
  task?: string;
  loop: boolean;
  scheduleCron?: string;
}

// ── Services ──

export interface ServiceStatus {
  healthy: boolean;
  pid?: number;
}

// ── Schedules ──

export interface Schedule {
  scheduleId: string;
  cronExpressions: string[];
  nextActionTimes?: string[];
  paused: boolean;
  note?: string;
}

// ── Logs ──

export interface LogResponse {
  lines: string[];
}
