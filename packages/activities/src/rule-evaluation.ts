import { DEFAULTS } from '@tap/shared';
import { runClaude } from './agent-execution';

/**
 * AI Judge — evaluates agent output against rule conditions.
 *
 * This is Stage 4 of the 5-stage rule evaluation cascade.
 * Called as a Temporal Activity because it's non-deterministic (LLM call).
 */
export async function evaluateRuleWithAI(params: {
  rules: Array<{ condition: string; next: string }>;
  responseContent: string;
}): Promise<{ next: string } | null> {
  const ruleOptions = params.rules
    .map((r, i) => `${i + 1}. Condition: "${r.condition}" → Go to: "${r.next}"`)
    .join('\n');

  // Truncate response content to avoid token limits
  const truncatedContent =
    params.responseContent.length > 4000
      ? `${params.responseContent.slice(0, 4000)}\n...(truncated)`
      : params.responseContent;

  const prompt = `You are a workflow router. Based on the agent's output below, determine which condition best matches.

## Agent Output
${truncatedContent}

## Available Transitions
${ruleOptions}

Respond with ONLY the number of the matching condition (e.g., "1" or "2"). If none match clearly, respond "none".`;

  const text = runClaude(prompt, { model: DEFAULTS.MODEL, maxTurns: 1 }).trim();

  if (text.toLowerCase() === 'none') {
    return null;
  }

  const index = parseInt(text, 10);
  if (Number.isNaN(index) || index < 1 || index > params.rules.length) {
    return null;
  }

  return { next: params.rules[index - 1].next };
}

/**
 * Evaluate a stop condition for the Ambient Agent.
 * Returns true if the condition is met (loop should stop).
 */
export async function evaluateCondition(
  conditionText: string,
  state: { lastResult: string; runCount: number },
): Promise<boolean> {
  const prompt = `Based on the following result, has this condition been met?

## Condition
"${conditionText}"

## Latest Result (Run #${state.runCount})
${state.lastResult.slice(0, 2000)}

Respond with ONLY "yes" or "no".`;

  const text = runClaude(prompt, { model: DEFAULTS.MODEL, maxTurns: 1 }).trim().toLowerCase();

  return text === 'yes';
}
