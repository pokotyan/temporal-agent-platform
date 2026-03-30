export interface StepRule {
  condition: string;
  next: string;
}

export interface StepNodeData extends Record<string, unknown> {
  label: string;
  agent: string;
  skill: string;
  edit: boolean;
  passPrev: boolean;
  instruction: string;
  rules: StepRule[];
}

export interface TerminalNodeData extends Record<string, unknown> {
  label: string;
  variant: 'start' | 'complete' | 'abort';
}

export interface ParallelSubStep {
  name: string;
  agent: string;
  skill: string;
  instruction: string;
  rules: StepRule[];
}

export interface ParallelNodeData extends Record<string, unknown> {
  label: string;
  subSteps: ParallelSubStep[];
  rules: StepRule[];
}
