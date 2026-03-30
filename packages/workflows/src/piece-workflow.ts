import type { StepConfig, StepContext, StepResult, WorkflowConfig, WorkflowResult, WorkflowState } from '@tap/shared';
import { ABORT_STEP, COMPLETE_STEP } from '@tap/shared';
import { condition, proxyActivities, setHandler, startChild, upsertMemo, workflowInfo } from '@temporalio/workflow';
import { executeParallelSteps } from './parallel-step';
import { evaluateAggregateRules, extractTag, matchTagToRule } from './rule-engine';
import { cancelStepSignal, pauseSignal, resumeSignal, statusQuery, stepOutputsQuery, userInputSignal } from './signals';
import { stepWorkflow } from './step-workflow';

// AI Judge activity (non-deterministic, must be an activity)
interface JudgeActivities {
  evaluateRuleWithAI(params: {
    rules: Array<{ condition: string; next: string }>;
    responseContent: string;
  }): Promise<{ next: string } | null>;
}

/**
 * Piece Workflow — the main orchestrator.
 *
 * This is the top-level Temporal Workflow that:
 * 1. Iterates through steps based on rules
 * 2. Manages workflow state (queryable externally)
 * 3. Handles user input via signals
 * 4. Supports pause/resume for Durable Loop integration
 * 5. Coordinates parallel sub-steps via child workflows
 *
 * Equivalent to takt's WorkflowEngine.run()
 */
export async function pieceWorkflow(
  config: WorkflowConfig,
  task: string,
  _options: { workflowSessionId: string },
): Promise<WorkflowResult> {
  // Ensure memo is always set so the UI can group workflows by name.
  // This covers schedule-started workflows where the action may lack a memo.
  upsertMemo({ workflowName: config.name });

  // ── Initialize State ──
  const state: WorkflowState = {
    status: 'running',
    currentStep: config.initialStep,
    iteration: 0,
    stepOutputs: {},
    agentSessions: {},
    userInputs: [],
  };

  let paused = false;
  let pendingUserInput: string | undefined;
  let lastUserInput: string | undefined;

  // ── Register Signal Handlers ──
  setHandler(userInputSignal, (input: string) => {
    pendingUserInput = input;
    state.userInputs.push(input);
  });

  setHandler(pauseSignal, () => {
    paused = true;
  });

  setHandler(resumeSignal, () => {
    paused = false;
  });

  setHandler(cancelStepSignal, () => {
    // Cancel is handled by Temporal's built-in cancellation
  });

  // ── Register Query Handlers ──
  setHandler(statusQuery, () => state);

  setHandler(stepOutputsQuery, () => state.stepOutputs);

  // ── Main Execution Loop ──
  while (state.status === 'running' && (config.maxIterations === 0 || state.iteration < config.maxIterations)) {
    // Check pause
    if (paused) {
      await condition(() => !paused);
    }

    state.iteration++;
    const step = config.steps.find((s) => s.name === state.currentStep);

    if (!step) {
      state.status = 'aborted';
      break;
    }

    // Build step context
    const context = buildStepContext(state, step, config, lastUserInput);
    lastUserInput = undefined; // consumed

    // Execute step
    let stepResult: StepResult;

    if (step.parallel && step.parallel.length > 0) {
      // Parallel execution
      stepResult = await executeParallelSteps(step, task, context, state.iteration);
    } else {
      // Sequential step as child workflow
      const wfId = workflowInfo().workflowId;
      const childHandle = await startChild(stepWorkflow, {
        args: [step, task, context, wfId],
        workflowId: `${wfId}-step-${step.name}-${state.iteration}`,
      });
      stepResult = await childHandle.result();
    }

    // Store output
    state.stepOutputs[step.name] = stepResult.output;
    if (stepResult.agentSessionId) {
      state.agentSessions[step.agent || step.name] = stepResult.agentSessionId;
    }

    // Handle blocked state (needs user input)
    if (stepResult.status === 'blocked') {
      state.status = 'blocked';
      await condition(() => pendingUserInput !== undefined);
      state.status = 'running';
      // Store the agent's original output (the question) as the step output.
      // The user's answer is stored separately as lastUserInput for {user_input} template variable.
      lastUserInput = pendingUserInput!;
      pendingUserInput = undefined;
      // Fall through to rule evaluation to determine the next step
    }

    // ── Determine Next Step (5-stage rule evaluation) ──
    const nextStep = await determineNextStep(step, stepResult, state);

    if (nextStep === COMPLETE_STEP) {
      state.status = 'completed';
    } else if (nextStep === ABORT_STEP) {
      state.status = 'aborted';
    } else {
      state.currentStep = nextStep;
    }
  }

  // Max iterations exceeded (0 = unlimited)
  if (config.maxIterations !== 0 && state.iteration >= config.maxIterations && state.status === 'running') {
    state.status = 'aborted';
  }

  // Save output file and send notification (non-fatal)
  try {
    const postActs = proxyActivities<{
      saveOutput(params: {
        workflowId: string;
        workflowName: string;
        stepOutputs: Record<string, string>;
        finalStatus: string;
      }): Promise<string>;
      sendNotification(params: { workflowId: string; workflowName: string; message: string }): Promise<void>;
    }>({ startToCloseTimeout: '30 seconds', taskQueue: 'agent-tasks' });

    const wfId = workflowInfo().workflowId;
    await postActs.saveOutput({
      workflowId: wfId,
      workflowName: config.name,
      stepOutputs: state.stepOutputs,
      finalStatus: state.status,
    });
    await postActs.sendNotification({
      workflowId: wfId,
      workflowName: config.name,
      message: '完了しました',
    });
  } catch {
    // Post-workflow actions should not affect workflow result
  }

  return {
    state,
    finalOutput: state.stepOutputs[state.currentStep],
  };
}

/**
 * 5-stage rule evaluation cascade:
 * 1. Aggregate conditions (for parallel steps)
 * 2. Phase 3 status tag match
 * 3. Phase 1 output tag match
 * 4. AI judge (non-deterministic, via activity)
 * 5. ABORT fallback
 */
async function determineNextStep(step: StepConfig, result: StepResult, _state: WorkflowState): Promise<string> {
  const rules = step.rules;
  if (!rules || rules.length === 0) return COMPLETE_STEP;

  // Stage 1: Aggregate conditions (for parallel steps)
  if (step.parallel && result.subStepStatuses) {
    const match = evaluateAggregateRules(rules, result.subStepStatuses);
    if (match) return match.next;
  }

  // Stage 2: Phase 3 status tag match
  if (result.statusTag) {
    const match = matchTagToRule(rules, result.statusTag, step.name);
    if (match) return match.next;
  }

  // Stage 3: Phase 1 output tag match
  const phase1Tag = extractTag(result.output, step.name);
  if (phase1Tag) {
    const match = matchTagToRule(rules, phase1Tag, step.name);
    if (match) return match.next;
  }

  // Stage 4: AI judge (non-deterministic → activity)
  try {
    const acts = proxyActivities<JudgeActivities>({
      startToCloseTimeout: '2 minutes',
      taskQueue: 'agent-tasks',
    });
    const aiMatch = await acts.evaluateRuleWithAI({
      rules: rules.filter((r) => !r.condition.startsWith('all(') && !r.condition.startsWith('any(')),
      responseContent: result.output,
    });
    if (aiMatch) return aiMatch.next;
  } catch {
    // AI judge failure falls through to ABORT
  }

  // Stage 5: ABORT fallback
  return ABORT_STEP;
}

/**
 * Build execution context for a step
 */
function buildStepContext(
  state: WorkflowState,
  step: StepConfig,
  _config: WorkflowConfig,
  lastUserInput?: string,
): StepContext {
  // Get previous step's output if needed
  let previousResponse: string | undefined;
  if (step.passPreviousResponse) {
    // Find the most recent non-empty output
    const values = Object.values(state.stepOutputs);
    if (values.length > 0) {
      previousResponse = values[values.length - 1];
    }
  }

  return {
    previousResponse,
    lastUserInput,
    userInputs: [...state.userInputs],
    iteration: state.iteration,
    maxIterations: _config.maxIterations,
    reportDir: `/tmp/tap-reports/${workflowInfo().workflowId}`,
    policies: [],
    knowledge: [],
    agentSessions: state.agentSessions,
  };
}
