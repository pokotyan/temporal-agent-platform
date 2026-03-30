import type { StepConfig, StepContext, StepResult, SubStepStatus } from '@tap/shared';
import { startChild, workflowInfo } from '@temporalio/workflow';
import { extractTag } from './rule-engine';
import { stepWorkflow } from './step-workflow';

/**
 * Execute parallel sub-steps as concurrent Child Workflows.
 *
 * Each sub-step runs independently, and results are aggregated
 * with status tags for the parent's aggregate rule evaluation.
 */
export async function executeParallelSteps(
  step: StepConfig,
  task: string,
  context: StepContext,
  iteration: number,
): Promise<StepResult> {
  if (!step.parallel || step.parallel.length === 0) {
    return {
      output: '',
      status: 'failed',
      subStepStatuses: [],
    };
  }

  const wfId = workflowInfo().workflowId;

  // Launch all sub-steps as child workflows concurrently
  const childHandles = step.parallel.map((subStep) =>
    startChild(stepWorkflow, {
      args: [subStep, task, context, wfId],
      workflowId: `${wfId}-step-${step.name}-${subStep.name}-${iteration}`,
    }),
  );

  // Wait for all handles, then resolve results
  const handles = await Promise.all(childHandles);
  const subResults: StepResult[] = await Promise.all(handles.map((h) => h.result()));

  // Build aggregated result with sub-step statuses
  const subStepStatuses: SubStepStatus[] = subResults.map((result, i) => {
    const subStep = step.parallel![i];
    const status =
      result.statusTag || extractTag(result.output, subStep.name) || resolveStatusFromRules(result, subStep);
    return {
      name: subStep.name,
      status: status || 'unknown',
    };
  });

  const combinedOutput = subResults.map((r, i) => `### ${step.parallel![i].name}\n\n${r.output}`).join('\n\n---\n\n');

  return {
    output: combinedOutput,
    status: 'complete',
    subStepStatuses,
  };
}

/**
 * Try to resolve status from a sub-step's rules and its output
 */
function resolveStatusFromRules(result: StepResult, subStep: StepConfig): string | undefined {
  if (!subStep.rules) return undefined;
  // Match the first rule whose status field is set
  // (this is a simplified heuristic — full AI judge runs in the parent)
  for (const rule of subStep.rules) {
    if (rule.status && result.statusTag === rule.status) {
      return rule.status;
    }
  }
  return subStep.rules[0]?.status;
}
