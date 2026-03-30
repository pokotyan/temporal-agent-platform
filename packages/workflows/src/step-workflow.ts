import type { StepConfig, StepContext, StepResult } from '@tap/shared';
import type { Duration } from '@temporalio/common';
import { proxyActivities } from '@temporalio/workflow';

// Activity interfaces (resolved at runtime by the worker)
interface AgentActivities {
  buildInstruction(step: StepConfig, task: string, context: StepContext): Promise<string>;

  executeAgent(params: {
    workflowId: string;
    stepName: string;
    agentConfig: string;
    instruction: string;
    sessionId?: string;
    edit?: boolean;
  }): Promise<{
    content: string;
    sessionId?: string;
    blocked: boolean;
  }>;

  generateReport(params: {
    agentConfig: string;
    sessionId?: string;
    reportConfig: { name: string; format: string };
    reportDir: string;
    sourceContent: string;
  }): Promise<string>;

  evaluateStatus(params: {
    agentConfig: string;
    sessionId?: string;
    rules: Array<{ condition: string; next: string; status?: string }>;
    stepName: string;
    responseContent: string;
  }): Promise<{ tag: string }>;
}

/**
 * Step Workflow — executes a single step through 3 phases.
 *
 * Phase 1: Main work (agent performs the task)
 * Phase 2: Report generation (optional, writes report files)
 * Phase 3: Status judgment (optional, determines transition tag)
 *
 * Each step is a Temporal Child Workflow, giving it:
 * - Independent execution history (easy debugging in Web UI)
 * - Independent retry/timeout semantics
 * - Ability to cancel without aborting parent
 */
export async function stepWorkflow(
  step: StepConfig,
  task: string,
  context: StepContext,
  workflowId: string,
): Promise<StepResult> {
  const acts = proxyActivities<AgentActivities>({
    startToCloseTimeout: (step.temporal?.startToCloseTimeout || '10m') as Duration,
    taskQueue: step.temporal?.taskQueue || 'agent-tasks',
    retry: {
      maximumAttempts: step.temporal?.retryPolicy?.maxAttempts || 2,
    },
  });

  // ── Phase 1: Main Work ──
  const instruction = await acts.buildInstruction(step, task, context);
  const phase1Result = await acts.executeAgent({
    workflowId,
    stepName: step.name,
    agentConfig: step.agent || 'planner',
    instruction,
    sessionId: context.agentSessions[step.agent || ''],
    edit: step.edit,
  });

  // Handle blocked state (agent needs user input)
  if (phase1Result.blocked) {
    return {
      output: phase1Result.content,
      agentSessionId: phase1Result.sessionId,
      status: 'blocked',
    };
  }

  // ── Phase 2: Report Generation (conditional) ──
  let reportPath: string | undefined;
  if (step.report) {
    reportPath = await acts.generateReport({
      agentConfig: step.agent || 'planner',
      sessionId: phase1Result.sessionId,
      reportConfig: step.report,
      reportDir: context.reportDir,
      sourceContent: phase1Result.content,
    });
  }

  // ── Phase 3: Status Judgment (conditional) ──
  let statusTag: string | undefined;
  if (step.rules && step.rules.length > 0) {
    try {
      const phase3Result = await acts.evaluateStatus({
        agentConfig: step.agent || 'planner',
        sessionId: phase1Result.sessionId,
        rules: step.rules,
        stepName: step.name,
        responseContent: phase1Result.content,
      });
      statusTag = phase3Result.tag;
    } catch {
      // Status evaluation failure is non-fatal; rule engine will use AI fallback
    }
  }

  return {
    output: phase1Result.content,
    agentSessionId: phase1Result.sessionId,
    reportPath,
    statusTag,
    status: 'complete',
  };
}
