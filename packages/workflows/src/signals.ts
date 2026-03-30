import type { WorkflowState } from '@tap/shared';
import { defineQuery, defineSignal } from '@temporalio/workflow';

// ── Signals (external → workflow) ──

/** Send user input to a blocked workflow */
export const userInputSignal = defineSignal<[string]>('userInput');

/** Cancel the current step */
export const cancelStepSignal = defineSignal('cancelStep');

/** Pause a running workflow (used by Durable Loop) */
export const pauseSignal = defineSignal('pause');

/** Resume a paused workflow */
export const resumeSignal = defineSignal('resume');

// ── Queries (external → workflow, read-only) ──

/** Get current workflow state */
export const statusQuery = defineQuery<WorkflowState>('status');

/** Get accumulated step outputs */
export const stepOutputsQuery = defineQuery<Record<string, string>>('stepOutputs');
